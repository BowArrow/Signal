import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbHandle } from '../../src/core/db/client.js';
import { drafts, opportunities, type CommunityRule } from '../../src/core/db/schema.js';
import { describeNorms, productInstruction } from '../../src/core/draft/generate.js';
import { runDrafting } from '../../src/core/draft/run.js';
import { ScriptedLlmClient } from '../../src/core/llm/client.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { loadPrompt, loadVoice, renderTemplate } from '../../src/core/prompts/loader.js';
import {
  insertCommunity,
  insertOpportunity,
  insertProduct,
  insertRule,
  insertSource,
  testDb,
} from '../helpers/db.js';

const NOW = 1_700_000_000_000;
const CONFIG = { draftModel: 'test-model', maxOutputTokens: 2000 };

const SUBSTANTIAL =
  'the arithmetic is weights plus kv cache plus whatever else is resident. ' +
  '13b at q4_k_m is about 7.9gb of weights, and a 4k context adds roughly 1.2gb, ' +
  'so you are at 9.1gb before the os and a browser. on a 16gb machine that fits, ' +
  'but only just, and a long context pushes you into swap territory quickly.';

function reply(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ body: SUBSTANTIAL, mentionsProduct: false, omitReason: null, ...over });
}

function rule(overrides: Partial<CommunityRule> = {}): CommunityRule {
  return {
    id: 'r1',
    communityId: 'c1',
    selfPromo: 'allowed_with_disclosure',
    selfPromoRatioMaxPct: null,
    flairRequired: false,
    flairValue: null,
    notes: null,
    verified: true,
    confidence: 1,
    ...overrides,
  } as CommunityRule;
}

describe('prompt loader', () => {
  it('renders placeholders', () => {
    expect(renderTemplate('hello {{name}}', { name: 'world' })).toBe('hello world');
  });

  it('throws rather than shipping an unfilled placeholder', () => {
    // A hole here becomes literal "{{product}}" in a real Reddit comment.
    expect(() => renderTemplate('hello {{missing}}', {})).toThrow(/missing/);
  });

  it('names every missing value at once', () => {
    expect(() => renderTemplate('{{a}} {{b}}', {})).toThrow(/a, b/);
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('{{ name }}', { name: 'x' })).toBe('x');
  });

  it('loads the real prompts that ship with the repo', () => {
    for (const name of ['classify', 'reply', 'interpret-rules']) {
      const prompt = loadPrompt(name, 1);
      expect(prompt.version).toBe(`${name}.v1`);
      expect(prompt.template.length).toBeGreaterThan(200);
    }
  });

  it('throws for a prompt version that does not exist', () => {
    expect(() => loadPrompt('reply', 99)).toThrow(/does not exist/);
  });

  it('does not count the shipped template placeholders as real voice samples', () => {
    // voice.md ships with five empty "paste a real post here" blocks. Counting
    // those as samples would hide the warning that the file is still a stub.
    const voice = loadVoice();
    expect(voice.sampleCount).toBe(0);
    expect(voice.hasSamples).toBe(false);
  });

  it('includes the banned phrase list in the reply prompt', () => {
    const template = loadPrompt('reply', 1).template;
    expect(template).toContain('game-changing');
    expect(template).toContain('No em-dashes');
  });
});

describe('describeNorms', () => {
  const community = { displayName: 'r/LocalLLaMA' } as never;

  it('says the rules are unknown when there is no record', () => {
    expect(describeNorms(community, null)).toContain('unknown');
  });

  it('tells the model not to promote where it is forbidden', () => {
    expect(describeNorms(community, rule({ selfPromo: 'forbidden' }))).toContain('do not mention');
  });

  it('passes the stated ratio cap through', () => {
    expect(describeNorms(community, rule({ selfPromoRatioMaxPct: 10 }))).toContain('10%');
  });

  it('includes the reviewer notes', () => {
    expect(describeNorms(community, rule({ notes: 'mods are strict on tuesdays' }))).toContain(
      'tuesdays',
    );
  });
});

describe('productInstruction', () => {
  const product = { name: 'Lemonade' } as never;

  it('forbids a mention when no product matched', () => {
    expect(productInstruction(rule(), null)).toContain('mention nothing');
  });

  it('forbids a mention where promotion is not allowed', () => {
    expect(productInstruction(rule({ selfPromo: 'forbidden' }), product)).toContain('Do NOT mention');
    expect(productInstruction(rule({ selfPromo: 'designated_thread_only' }), product)).toContain(
      'Do NOT mention',
    );
  });

  it('forbids a mention when there is no rules record', () => {
    expect(productInstruction(null, product)).toContain('Do NOT mention');
  });

  it('offers the omit option explicitly where promotion is allowed', () => {
    // The spec requires the prompt to carry an explicit "omit the product"
    // option rather than leaving it implied.
    const instruction = productInstruction(rule(), product);
    expect(instruction).toContain('omit it entirely');
    expect(instruction).toContain('Omitting is a good outcome');
  });

  it('requires the disclosure wording where a mention is allowed', () => {
    expect(productInstruction(rule(), product)).toContain('disclosure');
  });
});

describe('runDrafting', () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  function scored(overrides: Record<string, unknown> = {}) {
    const source = insertSource(handle);
    const community = insertCommunity(handle);
    const product = insertProduct(handle);
    const opportunity = insertOpportunity(handle, source.id, {
      communityId: community.id,
      status: 'scored',
      matchedProductId: product.id,
      postedAt: NOW,
      ...overrides,
    });
    return { source, community, product, opportunity };
  }

  it('queues a clean draft', async () => {
    const { community } = scored();
    insertRule(handle, community.id);

    const report = await runDrafting(
      handle.db,
      new ScriptedLlmClient([reply()]),
      CONFIG,
      silentLogger,
      { clock: fixedClock(NOW) },
    );

    expect(report.drafted).toHaveLength(1);
    expect(report.drafted[0]?.blocked).toBe(false);
    expect(handle.db.select().from(opportunities).get()?.status).toBe('queued');
    expect(handle.db.select().from(drafts).get()?.status).toBe('pending');
  });

  it('refuses to draft when the community has no rules record', async () => {
    scored();

    const llm = new ScriptedLlmClient([]);
    const report = await runDrafting(handle.db, llm, CONFIG, silentLogger, {
      clock: fixedClock(NOW),
    });

    // No model call at all: the gate runs before any money is spent.
    expect(llm.calls).toHaveLength(0);
    expect(report.skipped).toHaveLength(1);
    expect(handle.db.select().from(opportunities).get()?.status).toBe('rules_unknown');
  });

  it('keeps a blocked draft but does not queue it', async () => {
    const { community } = scored();
    insertRule(handle, community.id);

    const report = await runDrafting(
      handle.db,
      new ScriptedLlmClient([
        reply({ body: `${SUBSTANTIAL} Lemonade solves this.`, mentionsProduct: true }),
      ]),
      CONFIG,
      silentLogger,
      { clock: fixedClock(NOW) },
    );

    expect(report.drafted[0]?.blocked).toBe(true);
    expect(report.drafted[0]?.blockReason).toContain('disclosure');

    // The draft survives, because the pattern in what gets blocked is what
    // tells me the prompt needs fixing.
    const draft = handle.db.select().from(drafts).get();
    expect(draft).toBeDefined();
    expect(draft?.blocked).toBe(true);
    expect(handle.db.select().from(opportunities).get()?.status).toBe('drafted');
  });

  it('records no product on a draft that omitted it', async () => {
    const { community } = scored();
    insertRule(handle, community.id);

    await runDrafting(
      handle.db,
      new ScriptedLlmClient([reply({ mentionsProduct: false, omitReason: 'would be a stretch' })]),
      CONFIG,
      silentLogger,
      { clock: fixedClock(NOW) },
    );

    // Attaching a product to a draft that never mentions it would corrupt
    // attribution and the digest.
    expect(handle.db.select().from(drafts).get()?.productId).toBeNull();
  });

  it('attaches the product when the draft does mention it', async () => {
    const { community, product } = scored();
    insertRule(handle, community.id);

    await runDrafting(
      handle.db,
      new ScriptedLlmClient([
        reply({
          body: `${SUBSTANTIAL}\n\ni build Lemonade, which does this. disclosure: my product.`,
          mentionsProduct: true,
        }),
      ]),
      CONFIG,
      silentLogger,
      { clock: fixedClock(NOW) },
    );

    expect(handle.db.select().from(drafts).get()?.productId).toBe(product.id);
  });

  it('appends a regeneration note without displacing the rules above it', async () => {
    const { community } = scored();
    insertRule(handle, community.id);

    const llm = new ScriptedLlmClient([reply()]);
    await runDrafting(handle.db, llm, CONFIG, silentLogger, {
      regenerateNote: 'drop the product entirely',
      clock: fixedClock(NOW),
    });

    const prompt = llm.calls[0]?.prompt ?? '';
    expect(prompt).toContain('drop the product entirely');
    // The note lands after the rules, so it cannot restructure them.
    expect(prompt.indexOf('Never write these')).toBeLessThan(
      prompt.indexOf('drop the product entirely'),
    );
    expect(handle.db.select().from(drafts).get()?.regenerateNote).toBe('drop the product entirely');
  });

  it('writes nothing on a dry run', async () => {
    const { community } = scored();
    insertRule(handle, community.id);

    const report = await runDrafting(
      handle.db,
      new ScriptedLlmClient([reply()]),
      CONFIG,
      silentLogger,
      { dryRun: true, clock: fixedClock(NOW) },
    );

    expect(report.drafted).toHaveLength(1);
    expect(handle.db.select().from(drafts).all()).toHaveLength(0);
    expect(handle.db.select().from(opportunities).get()?.status).toBe('scored');
  });

  it('only drafts opportunities that reached the scored status', async () => {
    const { community } = scored({ status: 'new' });
    insertRule(handle, community.id);

    const report = await runDrafting(
      handle.db,
      new ScriptedLlmClient([]),
      CONFIG,
      silentLogger,
      { clock: fixedClock(NOW) },
    );

    expect(report.drafted).toHaveLength(0);
  });

  it('records a failure without taking the batch down', async () => {
    const { community, source, product } = scored();
    insertRule(handle, community.id);
    insertOpportunity(handle, source.id, {
      communityId: community.id,
      status: 'scored',
      matchedProductId: product.id,
      externalId: 'second',
    });

    const report = await runDrafting(
      handle.db,
      new ScriptedLlmClient(['not json', reply()]),
      CONFIG,
      silentLogger,
      { clock: fixedClock(NOW) },
    );

    expect(report.failed).toHaveLength(1);
    expect(report.drafted).toHaveLength(1);
  });

  it('drafts a single opportunity by id when asked', async () => {
    const { community, opportunity } = scored({ status: 'new' });
    insertRule(handle, community.id);

    const report = await runDrafting(
      handle.db,
      new ScriptedLlmClient([reply()]),
      CONFIG,
      silentLogger,
      { only: opportunity.id, clock: fixedClock(NOW) },
    );

    expect(report.drafted).toHaveLength(1);
  });

  it('passes the voice file into the prompt', async () => {
    const { community } = scored();
    insertRule(handle, community.id);

    const llm = new ScriptedLlmClient([reply()]);
    await runDrafting(handle.db, llm, CONFIG, silentLogger, { clock: fixedClock(NOW) });

    expect(llm.calls[0]?.prompt).toContain('Voice calibration');
  });

  it('checks every product for disclosure, not only the matched one', async () => {
    const { community } = scored();
    insertRule(handle, community.id);
    insertProduct(handle, { key: 'cinegen', name: 'CineGen' });

    const report = await runDrafting(
      handle.db,
      new ScriptedLlmClient([
        reply({ body: `${SUBSTANTIAL} for video there is always CineGen.` }),
      ]),
      CONFIG,
      silentLogger,
      { clock: fixedClock(NOW) },
    );

    expect(report.drafted[0]?.blocked).toBe(true);
  });
});
