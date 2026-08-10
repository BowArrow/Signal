import { describe, expect, it } from 'vitest';
import { validateDraft, type DraftContext } from '../../src/core/guardrails/validators.js';
import type { CommunityRule } from '../../src/core/db/schema.js';

const PRODUCTS = [{ key: 'lemonade', name: 'Lemonade' }];

function rule(overrides: Partial<CommunityRule> = {}): CommunityRule {
  return {
    id: 'r1',
    communityId: 'c1',
    rawRules: null,
    rawSidebar: null,
    sourceUrl: null,
    fetchedAt: 1_000,
    selfPromo: 'allowed_with_disclosure',
    selfPromoRatioMaxPct: null,
    flairRequired: false,
    flairValue: null,
    minAccountAgeDays: null,
    minKarma: null,
    notes: null,
    evidence: null,
    interpretedBy: 'test',
    confidence: 0.9,
    verified: true,
    lastReviewedAt: 1_000,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  } as CommunityRule;
}

/** A body long enough to clear the substance floor. */
const SUBSTANTIAL =
  'the arithmetic is weights plus kv cache plus whatever else is resident. ' +
  '13b at q4_k_m is about 7.9gb of weights, and a 4k context adds roughly 1.2gb ' +
  'on top of that, so you are at 9.1gb before the os and a browser window. ' +
  'on a 16gb machine that fits, but only just, and a long context pushes you into swap. ' +
  'measured on an m2 with ollama defaults at 4k context, for what it is worth.';

function context(overrides: Partial<DraftContext> = {}): DraftContext {
  return {
    body: SUBSTANTIAL,
    products: PRODUCTS,
    rule: rule(),
    communityName: 'r/LocalLLaMA',
    platform: 'reddit',
    ...overrides,
  };
}

function ruleOf(outcome: ReturnType<typeof validateDraft>, name: string): string | undefined {
  return outcome.results.find((r) => r.rule === name)?.state;
}

describe('validateDraft', () => {
  it('passes a substantial reply with no product mention', () => {
    const outcome = validateDraft(context());
    expect(outcome.blocked).toBe(false);
    expect(outcome.productMentioned).toBe(false);
    expect(outcome.blockReason).toBeNull();
  });

  it('blocks a product named without a disclosure', () => {
    const outcome = validateDraft(context({ body: `${SUBSTANTIAL}\n\nLemonade does this.` }));
    expect(outcome.blocked).toBe(true);
    expect(ruleOf(outcome, 'disclosure')).toBe('block');
    expect(outcome.blockReason).toContain('disclosure');
  });

  it('passes a product named with a disclosure', () => {
    const outcome = validateDraft(
      context({ body: `${SUBSTANTIAL}\n\ni build Lemonade, which does this. disclosure: my product.` }),
    );
    expect(outcome.blocked).toBe(false);
    expect(outcome.productMentioned).toBe(true);
    expect(outcome.disclosurePresent).toBe(true);
  });

  it('blocks when the community has no rules record', () => {
    const outcome = validateDraft(context({ rule: null }));
    expect(outcome.blocked).toBe(true);
    expect(ruleOf(outcome, 'community_rules')).toBe('block');
  });

  it('blocks a product mention where self-promo is forbidden', () => {
    const outcome = validateDraft(
      context({
        rule: rule({ selfPromo: 'forbidden' }),
        body: `${SUBSTANTIAL}\n\ni build Lemonade. disclosure: my product.`,
      }),
    );
    expect(outcome.blocked).toBe(true);
  });

  it('allows a purely technical reply even where self-promo is forbidden', () => {
    // Contributing without promoting is always fine, and this is the case the
    // whole system is built around.
    const outcome = validateDraft(context({ rule: rule({ selfPromo: 'forbidden' }) }));
    expect(outcome.blocked).toBe(false);
  });

  it('warns rather than blocks on a designated-thread community', () => {
    const outcome = validateDraft(
      context({
        rule: rule({ selfPromo: 'designated_thread_only' }),
        body: `${SUBSTANTIAL}\n\ni build Lemonade. disclosure: my product.`,
      }),
    );
    expect(outcome.blocked).toBe(false);
    expect(ruleOf(outcome, 'community_rules')).toBe('warn');
  });

  it('warns when the rules were never confirmed by a human', () => {
    const outcome = validateDraft(context({ rule: rule({ verified: false, confidence: 0.4 }) }));
    expect(outcome.blocked).toBe(false);
    expect(ruleOf(outcome, 'community_rules')).toBe('warn');
    expect(outcome.results.find((r) => r.rule === 'community_rules')?.message).toContain('0.40');
  });

  it.each([
    'this will supercharge your setup',
    'a game-changing approach',
    'unlock the secrets of quantization',
    'a seamless experience',
    'hope this helps',
  ])('blocks marketing register: %s', (phrase) => {
    const outcome = validateDraft(context({ body: `${SUBSTANTIAL} ${phrase}` }));
    expect(outcome.blocked).toBe(true);
    expect(ruleOf(outcome, 'register')).toBe('block');
  });

  it('blocks em-dashes', () => {
    const outcome = validateDraft(context({ body: `${SUBSTANTIAL} and — this is the tell — it shows` }));
    expect(outcome.blocked).toBe(true);
    expect(ruleOf(outcome, 'em_dash')).toBe('block');
  });

  it('allows hyphens and en-dashes', () => {
    const outcome = validateDraft(context({ body: `${SUBSTANTIAL} q4_k_m is well-tested, 4–8gb` }));
    expect(ruleOf(outcome, 'em_dash')).toBe('pass');
  });

  it('blocks a one-line reply that is really just an advert', () => {
    const outcome = validateDraft({
      ...context(),
      body: 'try Lemonade, i build it. disclosure: my product.',
    });
    expect(outcome.blocked).toBe(true);
    expect(ruleOf(outcome, 'substance')).toBe('block');
  });

  it('blocks an empty draft', () => {
    const outcome = validateDraft(context({ body: '' }));
    expect(outcome.blocked).toBe(true);
  });

  it('blocks an unrendered placeholder that escaped the prompt', () => {
    const outcome = validateDraft(context({ body: `${SUBSTANTIAL} see {{product}} for more` }));
    expect(outcome.blocked).toBe(true);
    expect(ruleOf(outcome, 'placeholder')).toBe('block');
  });

  it('blocks a draft over the length cap', () => {
    const outcome = validateDraft(context({ body: 'a'.repeat(200), maxChars: 100 }));
    expect(outcome.blocked).toBe(true);
    expect(ruleOf(outcome, 'length')).toBe('block');
  });

  it('warns that Hacker News is draft-only', () => {
    const outcome = validateDraft(context({ platform: 'hn' }));
    expect(ruleOf(outcome, 'platform')).toBe('warn');
    expect(outcome.blocked).toBe(false);
  });

  it('warns when flair is required, because Signal cannot set it', () => {
    const outcome = validateDraft(
      context({ rule: rule({ flairRequired: true, flairValue: 'Need Help' }) }),
    );
    expect(ruleOf(outcome, 'flair')).toBe('warn');
    expect(outcome.results.find((r) => r.rule === 'flair')?.message).toContain('Need Help');
  });

  it('reports the first blocking message as the block reason', () => {
    const outcome = validateDraft(context({ rule: null, body: 'Lemonade' }));
    expect(outcome.blockReason).not.toBeNull();
    expect(outcome.blocked).toBe(true);
  });

  it('accumulates several blocks rather than stopping at the first', () => {
    const outcome = validateDraft(
      context({ rule: null, body: 'Lemonade — supercharge your workflow' }),
    );
    const blocks = outcome.results.filter((r) => r.state === 'block');
    expect(blocks.length).toBeGreaterThanOrEqual(3);
  });
});
