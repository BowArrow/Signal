import { describe, expect, it } from 'vitest';
import { scoreRisk, type RiskInputs } from '../../src/core/scoring/risk.js';
import type { CommunityRule } from '../../src/core/db/schema.js';

function rule(overrides: Partial<CommunityRule> = {}): CommunityRule {
  return {
    id: 'r1',
    communityId: 'c1',
    rawRules: null,
    rawSidebar: null,
    sourceUrl: null,
    fetchedAt: 1_000,
    selfPromo: 'allowed',
    selfPromoRatioMaxPct: null,
    flairRequired: false,
    flairValue: null,
    minAccountAgeDays: null,
    minKarma: null,
    notes: null,
    evidence: null,
    interpretedBy: 'test',
    confidence: 1,
    verified: true,
    lastReviewedAt: 1_000,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  } as CommunityRule;
}

function inputs(overrides: Partial<RiskInputs> = {}): RiskInputs {
  return {
    rule: rule(),
    threadAgeMs: 0,
    daysSinceLastPostHere: null,
    selfPromoRatio: null,
    promotional: true,
    cooldownDays: 7,
    ratioCapPct: 10,
    maxThreadAgeHours: 72,
    ...overrides,
  };
}

function factorNames(result: ReturnType<typeof scoreRisk>): string[] {
  return result.factors.map((f) => f.name);
}

describe('scoreRisk', () => {
  it('is near zero for a fresh thread in a permissive community', () => {
    expect(scoreRisk(inputs()).total).toBeCloseTo(0, 5);
  });

  it('always stays within 0 and 1', () => {
    const worst = scoreRisk(
      inputs({
        rule: rule({ selfPromo: 'forbidden', verified: false, confidence: 0, flairRequired: true }),
        threadAgeMs: 500 * 3_600_000,
        daysSinceLastPostHere: 0,
        selfPromoRatio: 0.9,
      }),
    );
    expect(worst.total).toBeLessThanOrEqual(1);
    expect(worst.total).toBeGreaterThanOrEqual(0);
  });

  it('pins at 1 when the community forbids promotion', () => {
    expect(scoreRisk(inputs({ rule: rule({ selfPromo: 'forbidden' }) })).total).toBe(1);
  });

  it('pins at 1 when there is no rules record at all', () => {
    const result = scoreRisk(inputs({ rule: null }));
    expect(result.total).toBe(1);
    expect(factorNames(result)).toContain('no_rules_record');
  });

  it('orders policies from permissive to restrictive', () => {
    const risk = (selfPromo: CommunityRule['selfPromo']): number =>
      scoreRisk(inputs({ rule: rule({ selfPromo }) })).total;

    expect(risk('allowed')).toBeLessThan(risk('allowed_with_disclosure'));
    expect(risk('allowed_with_disclosure')).toBeLessThan(risk('discouraged'));
    expect(risk('discouraged')).toBeLessThan(risk('designated_thread_only'));
    expect(risk('designated_thread_only')).toBeLessThan(risk('forbidden'));
  });

  it('charges nothing for community policy on a non-promotional reply', () => {
    // Answering a question without naming a product carries no self-promo
    // risk, whatever the community thinks about promotion.
    const result = scoreRisk(
      inputs({ rule: rule({ selfPromo: 'designated_thread_only' }), promotional: false }),
    );
    expect(factorNames(result)).not.toContain('self_promo_policy');
    expect(result.total).toBeCloseTo(0, 5);
  });

  it('adds risk for an unverified rules reading, scaled by its confidence', () => {
    const confident = scoreRisk(inputs({ rule: rule({ verified: false, confidence: 0.9 }) }));
    const unsure = scoreRisk(inputs({ rule: rule({ verified: false, confidence: 0.1 }) }));

    expect(factorNames(unsure)).toContain('unverified_rules');
    expect(unsure.total).toBeGreaterThan(confident.total);
  });

  it('adds nothing extra for a verified reading', () => {
    const result = scoreRisk(inputs({ rule: rule({ verified: true }) }));
    expect(factorNames(result)).not.toContain('unverified_rules');
  });

  it('grows with thread age, and accelerates', () => {
    const at = (hours: number): number => scoreRisk(inputs({ threadAgeMs: hours * 3_600_000 })).total;
    expect(at(1)).toBeLessThan(at(24));
    expect(at(24)).toBeLessThan(at(72));
    // Squared curve: the second half of the window costs more than the first.
    expect(at(72) - at(36)).toBeGreaterThan(at(36) - at(0));
  });

  it('ignores age when the post time is unknown', () => {
    const result = scoreRisk(inputs({ threadAgeMs: null }));
    expect(factorNames(result)).not.toContain('thread_age');
  });

  it('penalises posting again inside the cooldown', () => {
    const inside = scoreRisk(inputs({ daysSinceLastPostHere: 1, cooldownDays: 7 }));
    const outside = scoreRisk(inputs({ daysSinceLastPostHere: 30, cooldownDays: 7 }));

    expect(factorNames(inside)).toContain('cooldown');
    expect(factorNames(outside)).not.toContain('cooldown');
    expect(inside.total).toBeGreaterThan(outside.total);
  });

  it('penalises a fresher cooldown violation more than an older one', () => {
    const today = scoreRisk(inputs({ daysSinceLastPostHere: 0, cooldownDays: 7 })).total;
    const nearlyClear = scoreRisk(inputs({ daysSinceLastPostHere: 6, cooldownDays: 7 })).total;
    expect(today).toBeGreaterThan(nearlyClear);
  });

  it('charges no cooldown for a non-promotional reply', () => {
    const result = scoreRisk(inputs({ daysSinceLastPostHere: 0, promotional: false }));
    expect(factorNames(result)).not.toContain('cooldown');
  });

  it('pins at 1 when the self-promo ratio is over the cap', () => {
    const result = scoreRisk(inputs({ selfPromoRatio: 0.2, ratioCapPct: 10 }));
    expect(factorNames(result)).toContain('ratio_exceeded');
    expect(result.total).toBe(1);
  });

  it('warns before the ratio cap rather than only at it', () => {
    const clear = scoreRisk(inputs({ selfPromoRatio: 0.02, ratioCapPct: 10 }));
    const close = scoreRisk(inputs({ selfPromoRatio: 0.09, ratioCapPct: 10 }));

    expect(factorNames(clear)).not.toContain('ratio_near_cap');
    expect(factorNames(close)).toContain('ratio_near_cap');
    expect(close.total).toBeGreaterThan(clear.total);
  });

  it("respects the community's own cap when it is stricter than ours", () => {
    // Our config allows 10%, the community says 5%, and we are at 7%.
    const result = scoreRisk(
      inputs({ selfPromoRatio: 0.07, ratioCapPct: 10, rule: rule({ selfPromoRatioMaxPct: 5 }) }),
    );
    expect(factorNames(result)).toContain('ratio_exceeded');
  });

  it("does not adopt a community's looser cap over ours", () => {
    // They allow 50%, we allow 10%, we are at 20%. Ours wins.
    const result = scoreRisk(
      inputs({ selfPromoRatio: 0.2, ratioCapPct: 10, rule: rule({ selfPromoRatioMaxPct: 50 }) }),
    );
    expect(factorNames(result)).toContain('ratio_exceeded');
  });

  it('ignores the ratio when there is no history to compute it from', () => {
    const result = scoreRisk(inputs({ selfPromoRatio: null }));
    expect(factorNames(result).some((n) => n.startsWith('ratio'))).toBe(false);
  });

  it('combines factors sub-additively, so three mild risks are not certainty', () => {
    const combined = scoreRisk(
      inputs({
        rule: rule({ selfPromo: 'discouraged', flairRequired: true }),
        threadAgeMs: 40 * 3_600_000,
      }),
    );
    expect(combined.total).toBeGreaterThan(0.35);
    expect(combined.total).toBeLessThan(1);
  });

  it('is deterministic — the same inputs give the same number', () => {
    const args = inputs({ threadAgeMs: 12 * 3_600_000, selfPromoRatio: 0.05 });
    expect(scoreRisk(args).total).toBe(scoreRisk(args).total);
  });

  it('explains every factor it counted', () => {
    const result = scoreRisk(
      inputs({ rule: rule({ selfPromo: 'discouraged' }), daysSinceLastPostHere: 1 }),
    );
    for (const factor of result.factors) {
      expect(factor.why.length).toBeGreaterThan(0);
    }
  });
});
