import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { scoringWeightsSchema, type ScoringWeights } from '../config/schema.js';

export const WEIGHTS_KEY = 'scoring.weights';
export const THRESHOLD_KEY = 'scoring.threshold';

export interface ResolvedScoring {
  readonly weights: ScoringWeights;
  readonly threshold: number;
  /** Identifies this weight set, so a stale cached total is detectable. */
  readonly hash: string;
}

/**
 * Weights and threshold come from signal.config.ts, and a row in `settings`
 * overrides them. That is how the dashboard's sliders work without editing a
 * committed file, and why config is the floor rather than the law.
 *
 * An invalid stored override is ignored rather than fatal — a bad slider
 * position should not stop ingestion.
 */
export function resolveScoring(
  db: Db,
  fallback: { weights: ScoringWeights; threshold: number },
): ResolvedScoring {
  const weights = readOverride(db, WEIGHTS_KEY, fallback.weights, (value) => {
    const parsed = scoringWeightsSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  });

  const threshold = readOverride(db, THRESHOLD_KEY, fallback.threshold, (value) =>
    typeof value === 'number' && value >= 0 && value <= 1 ? value : null,
  );

  return { weights, threshold, hash: weightsHash(weights, threshold) };
}

function readOverride<T>(db: Db, key: string, fallback: T, parse: (value: unknown) => T | null): T {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return fallback;
  return parse(row.value) ?? fallback;
}

export function setWeights(db: Db, weights: ScoringWeights, now: number): void {
  upsert(db, WEIGHTS_KEY, weights, now);
}

export function setThreshold(db: Db, threshold: number, now: number): void {
  upsert(db, THRESHOLD_KEY, threshold, now);
}

function upsert(db: Db, key: string, value: unknown, now: number): void {
  db.insert(settings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } })
    .run();
}

/**
 * A short, stable fingerprint of the weight set. Stored alongside each
 * cached total so that changing a weight makes every existing total
 * identifiably stale instead of quietly wrong.
 */
export function weightsHash(weights: ScoringWeights, threshold: number): string {
  const canonical = JSON.stringify({
    c: round(weights.contribution),
    i: round(weights.intent),
    f: round(weights.fit),
    r: round(weights.risk),
    t: round(threshold),
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export interface Axes {
  readonly contribution: number;
  readonly intent: number;
  readonly fit: number;
  readonly risk: number;
}

/**
 * Weighted sum, with risk subtracting. Normalized by the positive weight mass
 * so that the threshold keeps meaning the same thing when weights are retuned
 * — otherwise dragging every slider down would quietly empty the queue.
 */
export function totalScore(axes: Axes, weights: ScoringWeights): number {
  const positiveMass = weights.contribution + weights.intent + weights.fit;
  if (positiveMass === 0) return 0;

  const positive =
    axes.contribution * weights.contribution +
    axes.intent * weights.intent +
    axes.fit * weights.fit;

  const total = (positive - axes.risk * weights.risk) / positiveMass;
  return Math.min(1, Math.max(0, total));
}
