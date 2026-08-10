import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbHandle } from '../../src/core/db/client.js';
import {
  resolveScoring,
  setThreshold,
  setWeights,
  totalScore,
  weightsHash,
} from '../../src/core/scoring/weights.js';
import { statusFor } from '../../src/core/scoring/run.js';
import { settings } from '../../src/core/db/schema.js';
import { testDb } from '../helpers/db.js';

const DEFAULTS = {
  weights: { contribution: 0.4, intent: 0.25, fit: 0.25, risk: 0.1 },
  threshold: 0.55,
};

describe('totalScore', () => {
  it('returns 1 for a perfect contribution-led thread with no risk', () => {
    const total = totalScore(
      { contribution: 1, intent: 1, fit: 1, risk: 0 },
      DEFAULTS.weights,
    );
    expect(total).toBeCloseTo(1, 5);
  });

  it('returns 0 when every axis is 0', () => {
    expect(totalScore({ contribution: 0, intent: 0, fit: 0, risk: 0 }, DEFAULTS.weights)).toBe(0);
  });

  it('weights contribution most heavily', () => {
    const contributionOnly = totalScore(
      { contribution: 1, intent: 0, fit: 0, risk: 0 },
      DEFAULTS.weights,
    );
    const intentOnly = totalScore({ contribution: 0, intent: 1, fit: 0, risk: 0 }, DEFAULTS.weights);
    const fitOnly = totalScore({ contribution: 0, intent: 0, fit: 1, risk: 0 }, DEFAULTS.weights);

    expect(contributionOnly).toBeGreaterThan(intentOnly);
    expect(contributionOnly).toBeGreaterThan(fitOnly);
  });

  it('subtracts risk', () => {
    const safe = totalScore({ contribution: 1, intent: 1, fit: 1, risk: 0 }, DEFAULTS.weights);
    const risky = totalScore({ contribution: 1, intent: 1, fit: 1, risk: 1 }, DEFAULTS.weights);
    expect(risky).toBeLessThan(safe);
  });

  it('never goes below 0 even when risk dominates', () => {
    const total = totalScore(
      { contribution: 0.1, intent: 0, fit: 0, risk: 1 },
      { contribution: 0.4, intent: 0.25, fit: 0.25, risk: 1 },
    );
    expect(total).toBe(0);
  });

  it('keeps the threshold meaningful when every weight is scaled down', () => {
    // Normalising by the positive weight mass is what stops "turn all the
    // sliders down" from silently emptying the queue.
    const axes = { contribution: 0.8, intent: 0.6, fit: 0.6, risk: 0 };
    const big = totalScore(axes, { contribution: 0.8, intent: 0.5, fit: 0.5, risk: 0.2 });
    const small = totalScore(axes, { contribution: 0.4, intent: 0.25, fit: 0.25, risk: 0.1 });
    expect(big).toBeCloseTo(small, 5);
  });

  it('does not divide by zero when every positive weight is 0', () => {
    const total = totalScore(
      { contribution: 1, intent: 1, fit: 1, risk: 0 },
      { contribution: 0, intent: 0, fit: 0, risk: 1 },
    );
    expect(total).toBe(0);
  });
});

describe('weightsHash', () => {
  it('is stable for the same values', () => {
    expect(weightsHash(DEFAULTS.weights, 0.55)).toBe(weightsHash({ ...DEFAULTS.weights }, 0.55));
  });

  it('changes when a weight changes', () => {
    expect(weightsHash(DEFAULTS.weights, 0.55)).not.toBe(
      weightsHash({ ...DEFAULTS.weights, fit: 0.3 }, 0.55),
    );
  });

  it('changes when the threshold changes', () => {
    expect(weightsHash(DEFAULTS.weights, 0.55)).not.toBe(weightsHash(DEFAULTS.weights, 0.6));
  });

  it('ignores floating point noise below the rounding precision', () => {
    expect(weightsHash({ ...DEFAULTS.weights, fit: 0.25 }, 0.55)).toBe(
      weightsHash({ ...DEFAULTS.weights, fit: 0.2500001 }, 0.55),
    );
  });
});

describe('resolveScoring', () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  it('falls back to config when nothing is stored', () => {
    const resolved = resolveScoring(handle.db, DEFAULTS);
    expect(resolved.weights).toEqual(DEFAULTS.weights);
    expect(resolved.threshold).toBe(0.55);
  });

  it('lets a stored override win over config', () => {
    const override = { contribution: 0.5, intent: 0.2, fit: 0.2, risk: 0.1 };
    setWeights(handle.db, override, 1_000);
    setThreshold(handle.db, 0.7, 1_000);

    const resolved = resolveScoring(handle.db, DEFAULTS);
    expect(resolved.weights).toEqual(override);
    expect(resolved.threshold).toBe(0.7);
  });

  it('ignores a stored override that does not validate', () => {
    // A bad slider position must not stop the pipeline.
    handle.db
      .insert(settings)
      .values({ key: 'scoring.weights', value: { contribution: 5 }, updatedAt: 1_000 })
      .run();

    expect(resolveScoring(handle.db, DEFAULTS).weights).toEqual(DEFAULTS.weights);
  });

  it('ignores an out-of-range threshold override', () => {
    handle.db
      .insert(settings)
      .values({ key: 'scoring.threshold', value: 4, updatedAt: 1_000 })
      .run();

    expect(resolveScoring(handle.db, DEFAULTS).threshold).toBe(0.55);
  });

  it('rejects an override that demotes contribution below intent', () => {
    // The config refinement applies to runtime overrides too, so the rule
    // cannot be dodged through the dashboard.
    setWeights(
      handle.db,
      { contribution: 0.1, intent: 0.5, fit: 0.3, risk: 0.1 } as never,
      1_000,
    );
    expect(resolveScoring(handle.db, DEFAULTS).weights).toEqual(DEFAULTS.weights);
  });

  it('updates in place rather than accumulating rows', () => {
    setWeights(handle.db, DEFAULTS.weights, 1_000);
    setWeights(handle.db, { contribution: 0.6, intent: 0.2, fit: 0.1, risk: 0.1 }, 2_000);

    expect(handle.db.select().from(settings).all()).toHaveLength(1);
    expect(resolveScoring(handle.db, DEFAULTS).weights.contribution).toBe(0.6);
  });
});

describe('statusFor', () => {
  it('queues a high score in a community with rules', () => {
    expect(statusFor(0.8, 0.55, true, false)).toBe('scored');
  });

  it('expires anything below the threshold', () => {
    expect(statusFor(0.4, 0.55, true, false)).toBe('expired');
  });

  it('holds a high score at rules_unknown when there is no rules record', () => {
    // The rule the whole system rests on: a missing rules record beats a
    // good score, every time.
    expect(statusFor(0.99, 0.55, false, false)).toBe('rules_unknown');
  });

  it('expires a blocked community regardless of score', () => {
    expect(statusFor(0.99, 0.55, true, true)).toBe('expired');
  });

  it('treats a score exactly at the threshold as passing', () => {
    expect(statusFor(0.55, 0.55, true, false)).toBe('scored');
  });

  it('prefers expiry over rules_unknown for a low score', () => {
    // No point telling me to go research a community's rules for a thread
    // that would not clear the bar anyway.
    expect(statusFor(0.2, 0.55, false, false)).toBe('expired');
  });
});
