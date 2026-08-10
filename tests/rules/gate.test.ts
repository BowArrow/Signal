import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbHandle } from '../../src/core/db/client.js';
import { communityRules } from '../../src/core/db/schema.js';
import {
  canDraftFor,
  isStale,
  markReviewed,
  refreshRules,
  RULES_STALE_AFTER_DAYS,
} from '../../src/core/rules/registry.js';
import { cautiousDefault } from '../../src/core/rules/interpret.js';
import { ScriptedLlmClient } from '../../src/core/llm/client.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import type { FetchedRules, RulesFetcher } from '../../src/core/rules/fetch.js';
import { insertCommunity, insertRule, testDb } from '../helpers/db.js';

const NOW = 1_700_000_000_000;

function fetcher(rules: Partial<FetchedRules> = {}, ready = true): RulesFetcher {
  return {
    platform: 'reddit',
    available: () => (ready ? { ready: true } : { ready: false, reason: 'no credentials' }),
    fetch: () =>
      Promise.resolve({
        rules: [{ shortName: 'No spam', description: 'Contribute before you promote.' }],
        sidebar: 'a place for local model people',
        sourceUrl: 'https://www.reddit.com/r/x/about/rules',
        subscribers: 1000,
        description: null,
        empty: false,
        ...rules,
      }),
  };
}

const READING = JSON.stringify({
  selfPromo: 'allowed_with_disclosure',
  selfPromoRatioMaxPct: 10,
  flairRequired: false,
  flairValue: null,
  minAccountAgeDays: null,
  minKarma: null,
  evidence: ['Contribute before you promote.'],
  confidence: 0.85,
  notes: null,
});

describe('canDraftFor — the gate', () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  it('refuses when there is no community at all', () => {
    const gate = canDraftFor(handle.db, null);
    expect(gate.allowed).toBe(false);
    if (gate.allowed) throw new Error('unreachable');
    expect(gate.status).toBe('rules_unknown');
  });

  it('refuses when the community has no rules record', () => {
    const community = insertCommunity(handle);
    const gate = canDraftFor(handle.db, community);
    expect(gate.allowed).toBe(false);
    if (gate.allowed) throw new Error('unreachable');
    expect(gate.status).toBe('rules_unknown');
    expect(gate.reason).toContain('no rules record');
  });

  it('allows once a rules record exists', () => {
    const community = insertCommunity(handle);
    insertRule(handle, community.id);
    expect(canDraftFor(handle.db, community).allowed).toBe(true);
  });

  it('refuses where self-promotion is forbidden', () => {
    const community = insertCommunity(handle);
    insertRule(handle, community.id, { selfPromo: 'forbidden' });
    const gate = canDraftFor(handle.db, community);
    expect(gate.allowed).toBe(false);
    if (gate.allowed) throw new Error('unreachable');
    expect(gate.status).toBe('expired');
  });

  it('refuses for a community I blocked by hand', () => {
    const community = insertCommunity(handle, {
      blockedAt: NOW,
      blockedReason: 'mods asked me to stop',
    });
    insertRule(handle, community.id);
    const gate = canDraftFor(handle.db, community);
    expect(gate.allowed).toBe(false);
    if (gate.allowed) throw new Error('unreachable');
    expect(gate.reason).toContain('mods asked me to stop');
  });

  it('allows an unverified reading, so discovery has something to review', () => {
    // Requiring a human sign-off before anything can be drafted would leave
    // nothing to sign off on. The unverified state raises risk and shows in
    // the queue instead, and approval is still explicit.
    const community = insertCommunity(handle);
    insertRule(handle, community.id, { verified: false, confidence: 0.4 });
    expect(canDraftFor(handle.db, community).allowed).toBe(true);
  });
});

describe('isStale', () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  it('is false for a fresh record', () => {
    const community = insertCommunity(handle);
    const rule = insertRule(handle, community.id, { fetchedAt: NOW });
    expect(isStale(rule, fixedClock(NOW))).toBe(false);
  });

  it('is true past the staleness window', () => {
    const community = insertCommunity(handle);
    const rule = insertRule(handle, community.id, { fetchedAt: NOW });
    const later = fixedClock(NOW + (RULES_STALE_AFTER_DAYS + 1) * 86_400_000);
    expect(isStale(rule, later)).toBe(true);
  });
});

describe('refreshRules', () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  it('stores the verbatim rules alongside the reading', async () => {
    const community = insertCommunity(handle);
    const llm = new ScriptedLlmClient([READING]);

    const outcome = await refreshRules(
      handle.db,
      community,
      fetcher(),
      llm,
      'test-model',
      silentLogger,
      fixedClock(NOW),
    );

    expect(outcome.status).toBe('written');
    const row = handle.db.select().from(communityRules).get();
    expect(row?.selfPromo).toBe('allowed_with_disclosure');
    // The evidence is the point: a claim you cannot trace is a guess.
    expect(row?.rawRules?.[0]?.description).toBe('Contribute before you promote.');
    expect(row?.evidence).toEqual(['Contribute before you promote.']);
    expect(row?.sourceUrl).toContain('about/rules');
  });

  it('always writes unverified, whatever the model claims', async () => {
    const community = insertCommunity(handle);
    const llm = new ScriptedLlmClient([READING]);

    await refreshRules(handle.db, community, fetcher(), llm, 'm', silentLogger, fixedClock(NOW));

    expect(handle.db.select().from(communityRules).get()?.verified).toBe(false);
  });

  it('resets a previously verified record, because the source text changed', async () => {
    const community = insertCommunity(handle);
    insertRule(handle, community.id, { verified: true });
    const llm = new ScriptedLlmClient([READING]);

    await refreshRules(handle.db, community, fetcher(), llm, 'm', silentLogger, fixedClock(NOW));

    const rows = handle.db.select().from(communityRules).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verified).toBe(false);
  });

  it('falls back to discouraged when the model call fails', async () => {
    const community = insertCommunity(handle);
    const llm = new ScriptedLlmClient([]);

    await refreshRules(handle.db, community, fetcher(), llm, 'm', silentLogger, fixedClock(NOW));

    const row = handle.db.select().from(communityRules).get();
    expect(row?.selfPromo).toBe('discouraged');
    expect(row?.confidence).toBe(0);
    expect(row?.interpretedBy).toBe('fallback');
  });

  it('falls back when the model returns something unparseable', async () => {
    const community = insertCommunity(handle);
    const llm = new ScriptedLlmClient(['I would rather not answer that']);

    await refreshRules(handle.db, community, fetcher(), llm, 'm', silentLogger, fixedClock(NOW));

    expect(handle.db.select().from(communityRules).get()?.selfPromo).toBe('discouraged');
  });

  it('demotes a permissive reading that quotes no evidence', async () => {
    // "Promotion is allowed" with nothing to back it is the shape a
    // hallucination takes, and acting on it is how you get banned.
    const community = insertCommunity(handle);
    const llm = new ScriptedLlmClient([
      JSON.stringify({
        selfPromo: 'allowed',
        selfPromoRatioMaxPct: null,
        flairRequired: false,
        flairValue: null,
        minAccountAgeDays: null,
        minKarma: null,
        evidence: [],
        confidence: 0.95,
        notes: null,
      }),
    ]);

    await refreshRules(handle.db, community, fetcher(), llm, 'm', silentLogger, fixedClock(NOW));

    const row = handle.db.select().from(communityRules).get();
    expect(row?.selfPromo).toBe('discouraged');
    expect(row?.confidence).toBeLessThanOrEqual(0.3);
    expect(row?.notes).toContain('demoted');
  });

  it('keeps a restrictive reading even with no evidence', () => {
    // Demotion only applies to permissive claims. Being cautious without a
    // quote is fine; being permissive without one is not.
    expect(cautiousDefault('anything').selfPromo).toBe('discouraged');
  });

  it('does not call the model when the community publishes no rules', async () => {
    const community = insertCommunity(handle);
    const llm = new ScriptedLlmClient([]);

    await refreshRules(
      handle.db,
      community,
      fetcher({ rules: [], sidebar: null, empty: true }),
      llm,
      'm',
      silentLogger,
      fixedClock(NOW),
    );

    expect(llm.calls).toHaveLength(0);
    expect(handle.db.select().from(communityRules).get()?.selfPromo).toBe('discouraged');
  });

  it('skips without writing when the fetcher has no credentials', async () => {
    const community = insertCommunity(handle);
    const outcome = await refreshRules(
      handle.db,
      community,
      fetcher({}, false),
      new ScriptedLlmClient([]),
      'm',
      silentLogger,
      fixedClock(NOW),
    );

    expect(outcome.status).toBe('skipped');
    expect(handle.db.select().from(communityRules).all()).toHaveLength(0);
  });

  it('reports an error without writing when the fetch throws', async () => {
    const community = insertCommunity(handle);
    const broken: RulesFetcher = {
      platform: 'reddit',
      available: () => ({ ready: true }),
      fetch: () => Promise.reject(new Error('403 Forbidden')),
    };

    const outcome = await refreshRules(
      handle.db,
      community,
      broken,
      new ScriptedLlmClient([]),
      'm',
      silentLogger,
      fixedClock(NOW),
    );

    expect(outcome.status).toBe('error');
    expect(outcome.detail).toContain('403');
    expect(handle.db.select().from(communityRules).all()).toHaveLength(0);
  });
});

describe('markReviewed', () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  it('is the only thing that sets verified', () => {
    const community = insertCommunity(handle);
    insertRule(handle, community.id, { verified: false });

    markReviewed(handle.db, community.id, {}, fixedClock(NOW));

    const row = handle.db.select().from(communityRules).get();
    expect(row?.verified).toBe(true);
    expect(row?.lastReviewedAt).toBe(NOW);
  });

  it('records a human correction at full confidence', () => {
    const community = insertCommunity(handle);
    insertRule(handle, community.id, { selfPromo: 'allowed', confidence: 0.4, verified: false });

    markReviewed(handle.db, community.id, { selfPromo: 'forbidden' }, fixedClock(NOW));

    const row = handle.db.select().from(communityRules).get();
    expect(row?.selfPromo).toBe('forbidden');
    expect(row?.interpretedBy).toBe('human');
    expect(row?.confidence).toBe(1);
  });
});
