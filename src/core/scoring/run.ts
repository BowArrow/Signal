import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  communities,
  opportunities,
  products,
  publications,
  type Community,
  type Opportunity,
  type OpportunityStatus,
} from '../db/schema.js';
import type { Clock } from '../lib/clock.js';
import { systemClock } from '../lib/clock.js';
import type { Logger } from '../lib/logger.js';
import type { LlmClient } from '../llm/client.js';
import { getRule } from '../rules/registry.js';
import { classify } from './classify.js';
import { scoreRisk, threadAgeMs } from './risk.js';
import { resolveScoring, totalScore, type ResolvedScoring } from './weights.js';

export interface ScoreOptions {
  readonly limit?: number;
  /** Rescore everything, not just what is unscored or stale. */
  readonly all?: boolean;
  readonly clock?: Clock;
  readonly dryRun?: boolean;
}

export interface ScoredOne {
  readonly id: string;
  readonly title: string;
  readonly community: string;
  readonly axes: { contribution: number; intent: number; fit: number; risk: number };
  readonly total: number;
  readonly status: OpportunityStatus;
  readonly product: string | null;
  readonly rationale: string;
}

export interface ScoreReport {
  readonly scored: ScoredOne[];
  readonly failed: { readonly id: string; readonly error: string }[];
  readonly counts: Record<string, number>;
  readonly threshold: number;
  readonly durationMs: number;
}

/**
 * How much of my recent activity in a community was promotional.
 *
 * Honest caveat, surfaced rather than buried: this only counts publications
 * Signal knows about. If I comment in a community by hand, Signal cannot see
 * it, so the denominator is too small and the ratio reads worse than reality.
 * Reading my real comment history from the Reddit API is the fix and it lands
 * with publishing in Phase 3. Until then the number is conservative, which is
 * the right direction to be wrong in.
 */
export function selfPromoRatio(db: Db, communityId: string, window: number): number | null {
  const rows = db
    .select({ promotional: publications.promotional })
    .from(publications)
    .where(eq(publications.communityId, communityId))
    .orderBy(desc(publications.publishedAt))
    .limit(window)
    .all();

  if (rows.length === 0) return null;
  const promotional = rows.filter((r) => r.promotional).length;
  return promotional / rows.length;
}

export function daysSinceLastPost(
  db: Db,
  communityId: string,
  now: number,
): number | null {
  const last = db
    .select({ publishedAt: publications.publishedAt })
    .from(publications)
    .where(eq(publications.communityId, communityId))
    .orderBy(desc(publications.publishedAt))
    .limit(1)
    .get();
  if (!last) return null;
  return Math.floor((now - last.publishedAt) / 86_400_000);
}

/** Statuses that scoring is allowed to touch. Anything resolved is left alone. */
const SCORABLE: OpportunityStatus[] = ['new', 'scored', 'rules_unknown', 'expired'];

/**
 * Decides the status a scored opportunity lands in.
 *
 * Order matters and is deliberate. A missing rules record beats a high score:
 * no matter how good the thread looks, nothing is drafted for a community
 * whose rules we have not read.
 */
export function statusFor(
  total: number,
  threshold: number,
  hasRule: boolean,
  blocked: boolean,
): OpportunityStatus {
  if (blocked) return 'expired';
  if (total < threshold) return 'expired';
  if (!hasRule) return 'rules_unknown';
  return 'scored';
}

export async function runScoring(
  db: Db,
  llm: LlmClient,
  config: {
    classifierModel: string;
    weights: ResolvedScoring['weights'];
    threshold: number;
    maxThreadAgeHours: number;
    cooldownDays: number;
    ratioCapPct: number;
    ratioWindow: number;
  },
  logger: Logger,
  options: ScoreOptions = {},
): Promise<ScoreReport> {
  const clock = options.clock ?? systemClock;
  const started = clock.now();
  const scoring = resolveScoring(db, { weights: config.weights, threshold: config.threshold });

  const productRows = db.select().from(products).where(eq(products.enabled, true)).all();
  if (productRows.length === 0) {
    throw new Error('no enabled products — run `pnpm signal db seed` first');
  }

  const pending = selectPending(db, scoring, options);
  const scored: ScoredOne[] = [];
  const failed: { id: string; error: string }[] = [];
  const counts: Record<string, number> = {};

  for (const row of pending) {
    const community = row.communityId
      ? db.select().from(communities).where(eq(communities.id, row.communityId)).get() ?? null
      : null;

    try {
      const one = await scoreOne(db, llm, config, scoring, row, community, productRows, logger, clock);
      scored.push(one);
      counts[one.status] = (counts[one.status] ?? 0) + 1;

      if (!options.dryRun) {
        db.update(opportunities)
          .set({
            scoreContribution: one.axes.contribution,
            scoreIntent: one.axes.intent,
            scoreFit: one.axes.fit,
            scoreRisk: one.axes.risk,
            scoreTotal: one.total,
            scoreWeightsHash: scoring.hash,
            scoredAt: clock.now(),
            matchedProductId: productRows.find((p) => p.key === one.product)?.id ?? null,
            scoreRationale: one.rationale,
            status: one.status,
            statusReason: statusReason(one, scoring.threshold),
            updatedAt: clock.now(),
          })
          .where(eq(opportunities.id, row.id))
          .run();
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('scoring failed', { opportunity: row.id, error });
      failed.push({ id: row.id, error });
    }
  }

  return {
    scored,
    failed,
    counts,
    threshold: scoring.threshold,
    durationMs: clock.now() - started,
  };
}

function statusReason(one: ScoredOne, threshold: number): string {
  switch (one.status) {
    case 'expired':
      return `total ${one.total.toFixed(2)} is below the ${threshold.toFixed(2)} threshold`;
    case 'rules_unknown':
      return `scored ${one.total.toFixed(2)} but ${one.community} has no rules record`;
    default:
      return `total ${one.total.toFixed(2)}, above the ${threshold.toFixed(2)} threshold`;
  }
}

function selectPending(db: Db, scoring: ResolvedScoring, options: ScoreOptions): Opportunity[] {
  const limit = options.limit ?? 50;

  const base = db.select().from(opportunities);
  const rows = options.all
    ? base.where(inArray(opportunities.status, SCORABLE)).limit(limit).all()
    : base
        .where(
          and(
            inArray(opportunities.status, SCORABLE),
            or(
              isNull(opportunities.scoredAt),
              // A weight change makes every cached total stale. Rescoring is
              // free for risk and cheap for the rest, and a stale total in the
              // queue is worse than a small bill.
              sql`${opportunities.scoreWeightsHash} is null or ${opportunities.scoreWeightsHash} <> ${scoring.hash}`,
            ),
          ),
        )
        .limit(limit)
        .all();

  return rows;
}

async function scoreOne(
  db: Db,
  llm: LlmClient,
  config: Parameters<typeof runScoring>[2],
  scoring: ResolvedScoring,
  row: Opportunity,
  community: Community | null,
  productRows: Parameters<typeof classify>[4],
  logger: Logger,
  clock: Clock,
): Promise<ScoredOne> {
  const now = clock.now();
  const communityName = community?.displayName ?? 'unknown community';
  const rule = community ? getRule(db, community.id) ?? null : null;

  const { classification, promptVersion } = await classify(
    llm,
    config.classifierModel,
    row,
    communityName,
    productRows,
    logger,
    now,
  );
  void promptVersion;

  const risk = scoreRisk({
    rule,
    threadAgeMs: threadAgeMs(row, now),
    daysSinceLastPostHere: community ? daysSinceLastPost(db, community.id, now) : null,
    selfPromoRatio: community ? selfPromoRatio(db, community.id, config.ratioWindow) : null,
    // At scoring time we do not know whether the eventual draft will name a
    // product, so assume it will. Assuming otherwise would under-report risk.
    promotional: true,
    cooldownDays: config.cooldownDays,
    ratioCapPct: config.ratioCapPct,
    maxThreadAgeHours: config.maxThreadAgeHours,
  });

  const axes = {
    contribution: classification.contribution,
    intent: classification.intent,
    fit: classification.fit,
    risk: risk.total,
  };
  const total = totalScore(axes, scoring.weights);
  const status = statusFor(total, scoring.threshold, rule != null, community?.blockedAt != null);

  return {
    id: row.id,
    title: row.title,
    community: communityName,
    axes,
    total,
    status,
    product: classification.product,
    rationale: [classification.rationale, ...risk.factors.map((f) => f.why)]
      .filter(Boolean)
      .join(' · '),
  };
}
