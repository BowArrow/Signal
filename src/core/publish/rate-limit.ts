import { and, desc, eq, gte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { publications, type SourceKindValue } from '../db/schema.js';
import type { Clock } from '../lib/clock.js';
import { systemClock } from '../lib/clock.js';
import type { PublishLimits } from '../config/schema.js';

/**
 * The limits that decide whether an approved draft may actually go out.
 *
 * Enforced here rather than in the interface, because the interface is not
 * where correctness lives: a draft can be approved from the dashboard, the
 * CLI, or a future keyboard shortcut, and all three have to hit the same wall.
 *
 * Everything is a pure read over publications plus an injected clock, so the
 * rules that keep the account alive can be tested exhaustively without
 * sleeping or publishing anything.
 */

export interface LimitCheck {
  readonly rule: string;
  readonly passed: boolean;
  readonly message: string;
  /** When this limit will next allow a post, if it is currently blocking. */
  readonly clearsAt?: number;
}

export interface LimitVerdict {
  readonly allowed: boolean;
  readonly checks: LimitCheck[];
  readonly blockedBy: LimitCheck | null;
}

/**
 * Calendar day in the configured timezone, as YYYY-MM-DD.
 *
 * Deliberately not "the last 24 hours". The limit is a daily cap, and a rolling
 * window would let six replies at 23:00 be followed by six more at 00:01 while
 * technically never exceeding anything.
 */
export function localDay(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}

/**
 * Milliseconds until the next local midnight.
 *
 * Steps forward to find the rollover rather than adding 86_400_000, which is
 * wrong on the two days a year that are 23 or 25 hours long.
 */
export function msUntilNextDay(at: number, timeZone: string): number {
  const today = localDay(at, timeZone);

  // Coarse pass: find the first hour boundary that lands on the next day.
  let rolloverHour = -1;
  for (let hours = 1; hours <= 48; hours += 1) {
    if (localDay(at + hours * 3_600_000, timeZone) !== today) {
      rolloverHour = hours;
      break;
    }
  }
  if (rolloverHour === -1) return 86_400_000;

  // Fine pass: walk forward through the hour before it to find the first
  // minute that is actually tomorrow. Searching backwards from the boundary
  // finds a minute that is still today, which is the opposite of the answer.
  const hourBefore = at + (rolloverHour - 1) * 3_600_000;
  for (let minutes = 1; minutes <= 60; minutes += 1) {
    const candidate = hourBefore + minutes * 60_000;
    if (localDay(candidate, timeZone) !== today) return candidate - at;
  }
  return rolloverHour * 3_600_000;
}

export function repliesToday(
  db: Db,
  platform: SourceKindValue,
  at: number,
  timeZone: string,
): number {
  const today = localDay(at, timeZone);
  // Read a generous window then filter by local day, rather than trying to
  // express a timezone-aware date boundary in SQL.
  const since = at - 48 * 3_600_000;
  return db
    .select({ publishedAt: publications.publishedAt })
    .from(publications)
    .where(and(eq(publications.platform, platform), gte(publications.publishedAt, since)))
    .all()
    .filter((row) => localDay(row.publishedAt, timeZone) === today).length;
}

export function lastPublishedInCommunity(db: Db, communityId: string): number | null {
  const row = db
    .select({ publishedAt: publications.publishedAt })
    .from(publications)
    .where(eq(publications.communityId, communityId))
    .orderBy(desc(publications.publishedAt))
    .limit(1)
    .get();
  return row?.publishedAt ?? null;
}

export interface RatioSnapshot {
  readonly promotional: number;
  readonly total: number;
  readonly ratio: number | null;
  /**
   * True when the denominator counts only what Signal published, so it
   * understates activity a person also does by hand. Surfaced rather than
   * buried: the number errs toward caution, but it is not the whole truth.
   */
  readonly signalOnly: boolean;
}

export function promoRatio(db: Db, communityId: string, window: number): RatioSnapshot {
  const rows = db
    .select({ promotional: publications.promotional })
    .from(publications)
    .where(eq(publications.communityId, communityId))
    .orderBy(desc(publications.publishedAt))
    .limit(window)
    .all();

  if (rows.length === 0) {
    return { promotional: 0, total: 0, ratio: null, signalOnly: true };
  }
  const promotional = rows.filter((r) => r.promotional).length;
  return {
    promotional,
    total: rows.length,
    ratio: promotional / rows.length,
    signalOnly: true,
  };
}

export interface LimitInputs {
  readonly platform: SourceKindValue;
  readonly communityId: string | null;
  readonly communityName: string;
  /** Whether the draft about to go out names a product. */
  readonly promotional: boolean;
  /** The community's own stated cap, when it published one. */
  readonly communityRatioCapPct?: number | null | undefined;
  readonly timeZone: string;
}

/**
 * The whole publish gate, in one pass.
 *
 * Runs every check rather than stopping at the first failure, so the queue can
 * show all of them at once — being told about the daily cap, fixing it
 * tomorrow, and then discovering the cooldown is a worse experience than
 * seeing both now.
 */
export function checkLimits(
  db: Db,
  limits: PublishLimits,
  inputs: LimitInputs,
  clock: Clock = systemClock,
): LimitVerdict {
  const now = clock.now();
  const checks: LimitCheck[] = [];

  // — Daily cap, per platform —
  const today = repliesToday(db, inputs.platform, now, inputs.timeZone);
  const dailyPassed = today < limits.maxRepliesPerPlatformPerDay;
  checks.push({
    rule: 'daily_cap',
    passed: dailyPassed,
    message: dailyPassed
      ? `${today} of ${limits.maxRepliesPerPlatformPerDay} ${inputs.platform} replies used today`
      : `daily cap reached: ${today} of ${limits.maxRepliesPerPlatformPerDay} ${inputs.platform} replies already published today`,
    ...(dailyPassed ? {} : { clearsAt: now + msUntilNextDay(now, inputs.timeZone) }),
  });

  // — Cooldown, per community —
  const last = inputs.communityId ? lastPublishedInCommunity(db, inputs.communityId) : null;
  if (last == null) {
    checks.push({
      rule: 'cooldown',
      passed: true,
      message: `nothing published in ${inputs.communityName} before`,
    });
  } else {
    const elapsedDays = (now - last) / 86_400_000;
    const cooldownPassed = elapsedDays >= limits.communityCooldownDays;
    checks.push({
      rule: 'cooldown',
      passed: cooldownPassed,
      message: cooldownPassed
        ? `last posted in ${inputs.communityName} ${Math.floor(elapsedDays)}d ago, cooldown is ${limits.communityCooldownDays}d`
        : `cooldown: last posted in ${inputs.communityName} ${Math.floor(elapsedDays)}d ago, minimum is ${limits.communityCooldownDays}d`,
      ...(cooldownPassed
        ? {}
        : { clearsAt: last + limits.communityCooldownDays * 86_400_000 }),
    });
  }

  // — Self-promo ratio, per community —
  // Only applies to a promotional reply. A purely technical answer improves
  // the ratio rather than spending it, which is exactly the behaviour the
  // whole system is meant to encourage.
  if (!inputs.promotional) {
    checks.push({
      rule: 'promo_ratio',
      passed: true,
      message: 'not promotional — this reply improves the ratio rather than spending it',
    });
  } else if (!inputs.communityId) {
    checks.push({
      rule: 'promo_ratio',
      passed: true,
      message: 'no community attached, so no ratio to check',
    });
  } else {
    const snapshot = promoRatio(db, inputs.communityId, limits.selfPromoRatioWindow);
    // The community's own cap wins when it is stricter than ours; ours wins
    // when theirs is looser. Never adopt a looser limit than we set ourselves.
    const capPct = Math.min(
      limits.selfPromoRatioMaxPct,
      inputs.communityRatioCapPct ?? limits.selfPromoRatioMaxPct,
    );
    const cap = capPct / 100;

    // Including the reply about to go out. Checking the ratio before adding it
    // would let every single post sit just under the line.
    const projected = (snapshot.promotional + 1) / (snapshot.total + 1);
    const ratioPassed = projected <= cap;

    checks.push({
      rule: 'promo_ratio',
      passed: ratioPassed,
      message: ratioPassed
        ? `self-promo would be ${(projected * 100).toFixed(0)}% of the last ${snapshot.total + 1} in ${inputs.communityName}, cap is ${capPct}%`
        : `self-promo ratio: this would make ${snapshot.promotional + 1} of ${snapshot.total + 1} posts in ${inputs.communityName} promotional (${(projected * 100).toFixed(0)}%), over the ${capPct}% cap`,
    });
  }

  const blockedBy = checks.find((c) => !c.passed) ?? null;
  return { allowed: blockedBy == null, checks, blockedBy };
}
