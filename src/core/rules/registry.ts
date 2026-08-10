import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { communityRules, type Community, type CommunityRule } from '../db/schema.js';
import { newId } from '../lib/id.js';
import type { Clock } from '../lib/clock.js';
import { systemClock } from '../lib/clock.js';
import type { Logger } from '../lib/logger.js';
import type { LlmClient } from '../llm/client.js';
import { interpretRules, type Interpretation } from './interpret.js';
import type { RulesFetcher } from './fetch.js';

/** After this long, a rules record is treated as stale and re-fetched. */
export const RULES_STALE_AFTER_DAYS = 60;

export function getRule(db: Db, communityId: string): CommunityRule | undefined {
  return db.select().from(communityRules).where(eq(communityRules.communityId, communityId)).get();
}

export type DraftGate =
  | { readonly allowed: true; readonly rule: CommunityRule }
  | { readonly allowed: false; readonly reason: string; readonly status: 'rules_unknown' | 'expired' };

/**
 * The gate every opportunity passes before a draft is generated.
 *
 * The rule the whole system rests on: no rules record, no draft. Not a warning,
 * not a lower score — nothing is generated at all. Guessing a community's
 * self-promo policy is how you get banned from it, and the cost of waiting for
 * a rules fetch is a few minutes.
 */
export function canDraftFor(
  db: Db,
  community: Community | null,
  clock: Clock = systemClock,
): DraftGate {
  if (!community) {
    return {
      allowed: false,
      status: 'rules_unknown',
      reason: 'the opportunity has no community attached, so no rules can apply',
    };
  }

  if (community.blockedAt != null) {
    return {
      allowed: false,
      status: 'expired',
      reason: `${community.displayName} is blocked: ${community.blockedReason ?? 'no reason recorded'}`,
    };
  }

  const rule = getRule(db, community.id);
  if (!rule) {
    return {
      allowed: false,
      status: 'rules_unknown',
      reason: `no rules record for ${community.displayName} — fetch and review its rules first`,
    };
  }

  if (rule.selfPromo === 'forbidden') {
    return {
      allowed: false,
      status: 'expired',
      reason: `${community.displayName} forbids self-promotion`,
    };
  }

  // Deliberately not blocking on `verified: false`. Requiring a human to sign
  // off before anything can even be drafted would make discovery useless —
  // there would be nothing to review. An unverified reading raises the risk
  // score and is shown in the queue instead, and every draft still needs an
  // explicit approve before it goes anywhere.
  void clock;
  return { allowed: true, rule };
}

export function isStale(rule: CommunityRule, clock: Clock = systemClock): boolean {
  const at = rule.fetchedAt ?? rule.updatedAt;
  return clock.now() - at > RULES_STALE_AFTER_DAYS * 86_400_000;
}

export interface RefreshOutcome {
  readonly community: string;
  readonly status: 'written' | 'skipped' | 'error';
  readonly detail?: string;
  readonly interpretation?: Interpretation;
}

/**
 * Fetch a community's rules, read them, and store both halves.
 *
 * Always writes `verified: false`. A human confirming the reading is a
 * separate, deliberate act — see markReviewed. Re-running this on an already
 * verified record resets it to unverified, which is correct: the source text
 * changed, so the old sign-off no longer applies to it.
 */
export async function refreshRules(
  db: Db,
  community: Community,
  fetcher: RulesFetcher,
  llm: LlmClient,
  model: string,
  logger: Logger,
  clock: Clock = systemClock,
): Promise<RefreshOutcome> {
  const readiness = fetcher.available();
  if (!readiness.ready) {
    return { community: community.displayName, status: 'skipped', detail: readiness.reason ?? 'unavailable' };
  }

  let fetched;
  try {
    fetched = await fetcher.fetch(community);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error('rules fetch failed', { community: community.displayName, detail });
    return { community: community.displayName, status: 'error', detail };
  }

  const { interpretation, interpretedBy } = await interpretRules(
    llm,
    model,
    community,
    fetched,
    logger,
  );

  const now = clock.now();
  const existing = getRule(db, community.id);
  const row = {
    communityId: community.id,
    rawRules: fetched.rules,
    rawSidebar: fetched.sidebar,
    sourceUrl: fetched.sourceUrl,
    fetchedAt: now,
    selfPromo: interpretation.selfPromo,
    selfPromoRatioMaxPct: interpretation.selfPromoRatioMaxPct,
    flairRequired: interpretation.flairRequired,
    flairValue: interpretation.flairValue,
    minAccountAgeDays: interpretation.minAccountAgeDays,
    minKarma: interpretation.minKarma,
    notes: interpretation.notes,
    evidence: interpretation.evidence,
    interpretedBy,
    confidence: interpretation.confidence,
    verified: false,
    updatedAt: now,
  };

  if (existing) {
    db.update(communityRules).set(row).where(eq(communityRules.id, existing.id)).run();
  } else {
    db.insert(communityRules).values({ id: newId(), ...row, createdAt: now }).run();
  }

  logger.info('rules recorded', {
    community: community.displayName,
    policy: interpretation.selfPromo,
    confidence: interpretation.confidence,
    evidence: interpretation.evidence.length,
    verified: false,
  });

  return { community: community.displayName, status: 'written', interpretation };
}

/** A human has read the evidence and agrees. The only way `verified` is set. */
export function markReviewed(
  db: Db,
  communityId: string,
  overrides: Partial<Pick<CommunityRule, 'selfPromo' | 'selfPromoRatioMaxPct' | 'flairRequired' | 'flairValue' | 'notes'>> = {},
  clock: Clock = systemClock,
): void {
  const now = clock.now();
  db.update(communityRules)
    .set({
      ...overrides,
      verified: true,
      lastReviewedAt: now,
      // A human decision replaces the model's, and carries full confidence.
      ...(Object.keys(overrides).length > 0 ? { interpretedBy: 'human', confidence: 1 } : {}),
      updatedAt: now,
    })
    .where(eq(communityRules.communityId, communityId))
    .run();
}
