import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { DbHandle } from '../../src/core/db/client.js';
import { opportunities } from '../../src/core/db/schema.js';
import { runScoring, selfPromoRatio, daysSinceLastPost } from '../../src/core/scoring/run.js';
import { ScriptedLlmClient, extractJson } from '../../src/core/llm/client.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import {
  insertCommunity,
  insertOpportunity,
  insertProduct,
  insertPublication,
  insertRule,
  insertSource,
  testDb,
} from '../helpers/db.js';

const NOW = 1_700_000_000_000;

const CONFIG = {
  classifierModel: 'test-model',
  weights: { contribution: 0.4, intent: 0.25, fit: 0.25, risk: 0.1 },
  threshold: 0.55,
  maxThreadAgeHours: 72,
  cooldownDays: 7,
  ratioCapPct: 10,
  ratioWindow: 30,
};

function verdict(over: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    contribution: 0.9,
    intent: 0.85,
    fit: 0.8,
    product: 'lemonade',
    rationale: 'a specific sizing question with a numeric answer',
    ...over,
  });
}

describe('runScoring', () => {
  let handle: DbHandle;

  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  it('scores an opportunity and queues it when the community has rules', async () => {
    const source = insertSource(handle);
    const community = insertCommunity(handle);
    insertRule(handle, community.id);
    insertProduct(handle);
    const opp = insertOpportunity(handle, source.id, {
      communityId: community.id,
      postedAt: NOW - 3_600_000,
    });

    const llm = new ScriptedLlmClient([verdict()]);
    const report = await runScoring(handle.db, llm, CONFIG, silentLogger, {
      clock: fixedClock(NOW),
    });

    expect(report.scored).toHaveLength(1);
    expect(report.scored[0]?.status).toBe('scored');

    const row = handle.db.select().from(opportunities).where(eq(opportunities.id, opp.id)).get();
    expect(row?.status).toBe('scored');
    expect(row?.scoreContribution).toBe(0.9);
    expect(row?.scoreTotal).toBeGreaterThan(0.55);
    expect(row?.scoreWeightsHash).not.toBeNull();
    expect(row?.scoreRationale).toContain('sizing question');
  });

  it('holds a high scorer at rules_unknown when the community has no rules', async () => {
    const source = insertSource(handle);
    const community = insertCommunity(handle);
    insertProduct(handle);
    insertOpportunity(handle, source.id, { communityId: community.id, postedAt: NOW });

    const llm = new ScriptedLlmClient([verdict()]);
    const report = await runScoring(handle.db, llm, CONFIG, silentLogger, {
      clock: fixedClock(NOW),
    });

    // The classifier said this is excellent; the missing rules record wins.
    expect(report.scored[0]?.status).toBe('rules_unknown');
    expect(report.scored[0]?.axes.risk).toBe(1);
  });

  it('expires anything below the threshold', async () => {
    const source = insertSource(handle);
    const community = insertCommunity(handle);
    insertRule(handle, community.id);
    insertProduct(handle);
    insertOpportunity(handle, source.id, { communityId: community.id, postedAt: NOW });

    const llm = new ScriptedLlmClient([
      verdict({ contribution: 0.1, intent: 0.1, fit: 0.1, product: null }),
    ]);
    const report = await runScoring(handle.db, llm, CONFIG, silentLogger, {
      clock: fixedClock(NOW),
    });

    expect(report.scored[0]?.status).toBe('expired');
    expect(report.scored[0]?.product).toBeNull();
  });

  it('expires everything in a blocked community', async () => {
    const source = insertSource(handle);
    const community = insertCommunity(handle, { blockedAt: NOW - 1000, blockedReason: 'banned' });
    insertRule(handle, community.id);
    insertProduct(handle);
    insertOpportunity(handle, source.id, { communityId: community.id, postedAt: NOW });

    const llm = new ScriptedLlmClient([verdict()]);
    const report = await runScoring(handle.db, llm, CONFIG, silentLogger, {
      clock: fixedClock(NOW),
    });

    expect(report.scored[0]?.status).toBe('expired');
  });

  it('records no product when the classifier names one that does not exist', async () => {
    const source = insertSource(handle);
    const community = insertCommunity(handle);
    insertRule(handle, community.id);
    insertProduct(handle);
    const opp = insertOpportunity(handle, source.id, { communityId: community.id, postedAt: NOW });

    const llm = new ScriptedLlmClient([verdict({ product: 'a-product-that-does-not-exist' })]);
    await runScoring(handle.db, llm, CONFIG, silentLogger, { clock: fixedClock(NOW) });

    const row = handle.db.select().from(opportunities).where(eq(opportunities.id, opp.id)).get();
    expect(row?.matchedProductId).toBeNull();
  });

  it('keeps going when one opportunity fails to classify', async () => {
    const source = insertSource(handle);
    const community = insertCommunity(handle);
    insertRule(handle, community.id);
    insertProduct(handle);
    insertOpportunity(handle, source.id, { communityId: community.id, externalId: 'a' });
    insertOpportunity(handle, source.id, { communityId: community.id, externalId: 'b' });

    const llm = new ScriptedLlmClient(['not json at all', verdict()]);
    const report = await runScoring(handle.db, llm, CONFIG, silentLogger, {
      clock: fixedClock(NOW),
    });

    expect(report.failed).toHaveLength(1);
    expect(report.scored).toHaveLength(1);
  });

  it('rejects a classification with an out-of-range axis', async () => {
    const source = insertSource(handle);
    const community = insertCommunity(handle);
    insertRule(handle, community.id);
    insertProduct(handle);
    insertOpportunity(handle, source.id, { communityId: community.id });

    const llm = new ScriptedLlmClient([verdict({ contribution: 7 })]);
    const report = await runScoring(handle.db, llm, CONFIG, silentLogger, {
      clock: fixedClock(NOW),
    });

    expect(report.failed).toHaveLength(1);
    expect(report.scored).toHaveLength(0);
  });

  it('writes nothing on a dry run', async () => {
    const source = insertSource(handle);
    const community = insertCommunity(handle);
    insertRule(handle, community.id);
    insertProduct(handle);
    const opp = insertOpportunity(handle, source.id, { communityId: community.id });

    const llm = new ScriptedLlmClient([verdict()]);
    const report = await runScoring(handle.db, llm, CONFIG, silentLogger, {
      dryRun: true,
      clock: fixedClock(NOW),
    });

    expect(report.scored).toHaveLength(1);
    const row = handle.db.select().from(opportunities).where(eq(opportunities.id, opp.id)).get();
    expect(row?.status).toBe('new');
    expect(row?.scoreTotal).toBeNull();
  });

  it('does not rescore an opportunity whose weight set has not changed', async () => {
    const source = insertSource(handle);
    const community = insertCommunity(handle);
    insertRule(handle, community.id);
    insertProduct(handle);
    insertOpportunity(handle, source.id, { communityId: community.id });

    const llm = new ScriptedLlmClient([verdict()]);
    await runScoring(handle.db, llm, CONFIG, silentLogger, { clock: fixedClock(NOW) });

    // A second pass with only one scripted response would throw if it tried
    // to classify again.
    const second = await runScoring(handle.db, llm, CONFIG, silentLogger, {
      clock: fixedClock(NOW),
    });
    expect(second.scored).toHaveLength(0);
  });

  it('rescores when the weights change', async () => {
    const source = insertSource(handle);
    const community = insertCommunity(handle);
    insertRule(handle, community.id);
    insertProduct(handle);
    insertOpportunity(handle, source.id, { communityId: community.id });

    const llm = new ScriptedLlmClient([verdict(), verdict()]);
    await runScoring(handle.db, llm, CONFIG, silentLogger, { clock: fixedClock(NOW) });

    const retuned = { ...CONFIG, weights: { contribution: 0.7, intent: 0.1, fit: 0.1, risk: 0.1 } };
    const second = await runScoring(handle.db, llm, retuned, silentLogger, {
      clock: fixedClock(NOW),
    });

    expect(second.scored).toHaveLength(1);
  });

  it('never touches an opportunity that was already approved or rejected', async () => {
    const source = insertSource(handle);
    const community = insertCommunity(handle);
    insertRule(handle, community.id);
    insertProduct(handle);
    insertOpportunity(handle, source.id, { communityId: community.id, status: 'rejected' });

    const llm = new ScriptedLlmClient([verdict()]);
    const report = await runScoring(handle.db, llm, CONFIG, silentLogger, {
      clock: fixedClock(NOW),
    });

    expect(report.scored).toHaveLength(0);
  });

  it('refuses to run with no products seeded', async () => {
    const source = insertSource(handle);
    insertOpportunity(handle, source.id);

    await expect(
      runScoring(handle.db, new ScriptedLlmClient([]), CONFIG, silentLogger, {
        clock: fixedClock(NOW),
      }),
    ).rejects.toThrow(/no enabled products/);
  });

  it('sends the community name to the classifier', async () => {
    const source = insertSource(handle);
    const community = insertCommunity(handle, { displayName: 'r/selfhosted' });
    insertRule(handle, community.id);
    insertProduct(handle);
    insertOpportunity(handle, source.id, { communityId: community.id });

    const llm = new ScriptedLlmClient([verdict()]);
    await runScoring(handle.db, llm, CONFIG, silentLogger, { clock: fixedClock(NOW) });

    expect(llm.calls[0]?.prompt).toContain('r/selfhosted');
    // Triage must be repeatable, so it runs at temperature 0.
    expect(llm.calls[0]?.temperature).toBe(0);
  });
});

describe('selfPromoRatio', () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  it('is null with no publication history', () => {
    const community = insertCommunity(handle);
    expect(selfPromoRatio(handle.db, community.id, 30)).toBeNull();
  });

  it('counts the promotional share', () => {
    const source = insertSource(handle);
    const community = insertCommunity(handle);
    for (let i = 0; i < 4; i += 1) {
      insertPublication(handle, {
        sourceId: source.id,
        communityId: community.id,
        publishedAt: NOW - i * 86_400_000,
        promotional: i === 0,
      });
    }
    expect(selfPromoRatio(handle.db, community.id, 30)).toBe(0.25);
  });

  it('only looks at the most recent window', () => {
    const source = insertSource(handle);
    const community = insertCommunity(handle);
    // Two recent promotional, then eight older non-promotional.
    for (let i = 0; i < 10; i += 1) {
      insertPublication(handle, {
        sourceId: source.id,
        communityId: community.id,
        publishedAt: NOW - i * 86_400_000,
        promotional: i < 2,
      });
    }
    expect(selfPromoRatio(handle.db, community.id, 2)).toBe(1);
    expect(selfPromoRatio(handle.db, community.id, 10)).toBe(0.2);
  });

  it('ignores publications in other communities', () => {
    const source = insertSource(handle);
    const here = insertCommunity(handle, { name: 'here' });
    const elsewhere = insertCommunity(handle, { name: 'elsewhere' });

    insertPublication(handle, {
      sourceId: source.id,
      communityId: elsewhere.id,
      publishedAt: NOW,
      promotional: true,
    });

    expect(selfPromoRatio(handle.db, here.id, 30)).toBeNull();
  });
});

describe('daysSinceLastPost', () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  it('is null when I have never posted there', () => {
    const community = insertCommunity(handle);
    expect(daysSinceLastPost(handle.db, community.id, NOW)).toBeNull();
  });

  it('measures from the most recent publication', () => {
    const source = insertSource(handle);
    const community = insertCommunity(handle);
    insertPublication(handle, {
      sourceId: source.id,
      communityId: community.id,
      publishedAt: NOW - 9 * 86_400_000,
      promotional: true,
    });
    insertPublication(handle, {
      sourceId: source.id,
      communityId: community.id,
      publishedAt: NOW - 3 * 86_400_000,
      promotional: true,
    });

    expect(daysSinceLastPost(handle.db, community.id, NOW)).toBe(3);
  });
});

describe('extractJson', () => {
  it('parses bare JSON', () => {
    expect(extractJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses JSON inside a markdown fence', () => {
    expect(extractJson<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('parses JSON with a preamble the model added anyway', () => {
    expect(extractJson<{ a: number }>('Here is the JSON:\n{"a":1}\nHope that helps!')).toEqual({
      a: 1,
    });
  });

  it('throws on something that is not JSON at all', () => {
    expect(() => extractJson('I would rather not')).toThrow(/parseable JSON/);
  });
});
