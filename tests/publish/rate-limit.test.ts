import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbHandle } from '../../src/core/db/client.js';
import {
  checkLimits,
  lastPublishedInCommunity,
  localDay,
  msUntilNextDay,
  promoRatio,
  repliesToday,
  type LimitInputs,
} from '../../src/core/publish/rate-limit.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import type { PublishLimits } from '../../src/core/config/schema.js';
import { insertCommunity, insertPublication, insertSource, testDb } from '../helpers/db.js';

/**
 * These limits are the last thing between an approved draft and a real
 * community, and every one of them exists because breaking it gets the
 * account banned. Worth testing to the point of tedium.
 */

const TZ = 'America/New_York';
// 2026-08-11T15:00:00Z is 11:00 in New York, comfortably mid-afternoon.
const NOON = Date.parse('2026-08-11T15:00:00.000Z');
const DAY = 86_400_000;

const LIMITS: PublishLimits = {
  maxRepliesPerPlatformPerDay: 3,
  communityCooldownDays: 7,
  selfPromoRatioMaxPct: 10,
  selfPromoRatioWindow: 30,
};

function inputs(over: Partial<LimitInputs> = {}): LimitInputs {
  return {
    platform: 'reddit',
    communityId: null,
    communityName: 'r/LocalLLaMA',
    promotional: true,
    timeZone: TZ,
    ...over,
  };
}

function check(verdict: ReturnType<typeof checkLimits>, rule: string) {
  const found = verdict.checks.find((c) => c.rule === rule);
  if (!found) throw new Error(`no check called ${rule}`);
  return found;
}

describe('localDay', () => {
  it('reports the calendar day in the configured zone, not UTC', () => {
    // 01:30 UTC is still the previous evening in New York.
    const lateUtc = Date.parse('2026-08-12T01:30:00.000Z');
    expect(localDay(lateUtc, 'UTC')).toBe('2026-08-12');
    expect(localDay(lateUtc, TZ)).toBe('2026-08-11');
  });
});

describe('msUntilNextDay', () => {
  it('is positive and under about a day', () => {
    const ms = msUntilNextDay(NOON, TZ);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(DAY);
  });

  it('lands on a moment that is actually the next local day', () => {
    const next = NOON + msUntilNextDay(NOON, TZ);
    expect(localDay(next, TZ)).not.toBe(localDay(NOON, TZ));
  });

  it('survives a DST transition without drifting a day', () => {
    // US DST ends 2026-11-01; that local day is 25 hours long.
    const beforeFallBack = Date.parse('2026-11-01T12:00:00.000Z');
    const next = beforeFallBack + msUntilNextDay(beforeFallBack, TZ);
    expect(localDay(next, TZ)).not.toBe(localDay(beforeFallBack, TZ));
  });
});

describe('repliesToday', () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  it('counts nothing on an empty database', () => {
    expect(repliesToday(handle.db, 'reddit', NOON, TZ)).toBe(0);
  });

  it('counts only today, in local time', () => {
    const source = insertSource(handle);
    const community = insertCommunity(handle);
    // Same local day, earlier.
    insertPublication(handle, {
      sourceId: source.id,
      communityId: community.id,
      publishedAt: NOON - 3_600_000,
      promotional: true,
    });
    // Yesterday.
    insertPublication(handle, {
      sourceId: source.id,
      communityId: community.id,
      publishedAt: NOON - 20 * 3_600_000,
      promotional: true,
    });

    expect(repliesToday(handle.db, 'reddit', NOON, TZ)).toBe(1);
  });

  it('counts per platform, not across all of them', () => {
    const reddit = insertSource(handle, { kind: 'reddit', identifier: 'a' });
    const community = insertCommunity(handle);
    insertPublication(handle, {
      sourceId: reddit.id,
      communityId: community.id,
      publishedAt: NOON - 60_000,
      promotional: true,
    });

    expect(repliesToday(handle.db, 'reddit', NOON, TZ)).toBe(1);
    expect(repliesToday(handle.db, 'hn', NOON, TZ)).toBe(0);
  });
});

describe('checkLimits — daily cap', () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  function publishToday(n: number) {
    const source = insertSource(handle);
    const community = insertCommunity(handle, { name: 'other' });
    for (let i = 0; i < n; i += 1) {
      insertPublication(handle, {
        sourceId: source.id,
        communityId: community.id,
        publishedAt: NOON - (i + 1) * 60_000,
        promotional: false,
      });
    }
  }

  it('allows a reply under the cap', () => {
    publishToday(2);
    const verdict = checkLimits(handle.db, LIMITS, inputs(), fixedClock(NOON));
    expect(check(verdict, 'daily_cap').passed).toBe(true);
  });

  it('blocks once the cap is reached', () => {
    publishToday(3);
    const verdict = checkLimits(handle.db, LIMITS, inputs(), fixedClock(NOON));
    expect(verdict.allowed).toBe(false);
    expect(check(verdict, 'daily_cap').passed).toBe(false);
    expect(verdict.blockedBy?.rule).toBe('daily_cap');
  });

  it('is a calendar cap, not a rolling window', () => {
    // Three at 23:00 local must not be followed by three more at 00:01.
    const lastNight = Date.parse('2026-08-11T03:30:00.000Z'); // 23:30 on the 10th, NY
    const source = insertSource(handle);
    const community = insertCommunity(handle, { name: 'other' });
    for (let i = 0; i < 3; i += 1) {
      insertPublication(handle, {
        sourceId: source.id,
        communityId: community.id,
        publishedAt: lastNight - i * 60_000,
        promotional: false,
      });
    }

    // Just after local midnight: a new day, so the cap resets. That is the
    // intended behaviour of a daily cap, and the reason it is stated in local
    // time rather than as "the last 24 hours".
    const justAfterMidnight = Date.parse('2026-08-11T04:05:00.000Z');
    const verdict = checkLimits(handle.db, LIMITS, inputs(), fixedClock(justAfterMidnight));
    expect(check(verdict, 'daily_cap').passed).toBe(true);

    // And within the same evening it is still blocked.
    const sameEvening = lastNight + 60_000;
    expect(
      check(checkLimits(handle.db, LIMITS, inputs(), fixedClock(sameEvening)), 'daily_cap').passed,
    ).toBe(false);
  });

  it('says when the cap clears', () => {
    publishToday(3);
    const verdict = checkLimits(handle.db, LIMITS, inputs(), fixedClock(NOON));
    const clearsAt = check(verdict, 'daily_cap').clearsAt;
    expect(clearsAt).toBeDefined();
    expect(localDay(clearsAt as number, TZ)).not.toBe(localDay(NOON, TZ));
  });
});

describe('checkLimits — cooldown', () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  it('passes when nothing was ever published there', () => {
    const community = insertCommunity(handle);
    const verdict = checkLimits(
      handle.db,
      LIMITS,
      inputs({ communityId: community.id }),
      fixedClock(NOON),
    );
    expect(check(verdict, 'cooldown').passed).toBe(true);
  });

  it('blocks inside the cooldown window', () => {
    const source = insertSource(handle);
    const community = insertCommunity(handle);
    insertPublication(handle, {
      sourceId: source.id,
      communityId: community.id,
      publishedAt: NOON - 2 * DAY,
      promotional: true,
    });

    const verdict = checkLimits(
      handle.db,
      LIMITS,
      inputs({ communityId: community.id }),
      fixedClock(NOON),
    );
    expect(check(verdict, 'cooldown').passed).toBe(false);
    expect(check(verdict, 'cooldown').clearsAt).toBe(NOON - 2 * DAY + 7 * DAY);
  });

  it('passes once the cooldown has elapsed', () => {
    const source = insertSource(handle);
    const community = insertCommunity(handle);
    insertPublication(handle, {
      sourceId: source.id,
      communityId: community.id,
      publishedAt: NOON - 8 * DAY,
      promotional: true,
    });

    expect(
      check(
        checkLimits(handle.db, LIMITS, inputs({ communityId: community.id }), fixedClock(NOON)),
        'cooldown',
      ).passed,
    ).toBe(true);
  });

  it('passes exactly on the boundary', () => {
    const source = insertSource(handle);
    const community = insertCommunity(handle);
    insertPublication(handle, {
      sourceId: source.id,
      communityId: community.id,
      publishedAt: NOON - 7 * DAY,
      promotional: true,
    });

    expect(
      check(
        checkLimits(handle.db, LIMITS, inputs({ communityId: community.id }), fixedClock(NOON)),
        'cooldown',
      ).passed,
    ).toBe(true);
  });

  it('is per community, not global', () => {
    const source = insertSource(handle);
    const here = insertCommunity(handle, { name: 'here' });
    const elsewhere = insertCommunity(handle, { name: 'elsewhere' });
    insertPublication(handle, {
      sourceId: source.id,
      communityId: elsewhere.id,
      publishedAt: NOON - 60_000,
      promotional: true,
    });

    expect(
      check(
        checkLimits(handle.db, LIMITS, inputs({ communityId: here.id }), fixedClock(NOON)),
        'cooldown',
      ).passed,
    ).toBe(true);
  });

  it('measures from the most recent publication', () => {
    const source = insertSource(handle);
    const community = insertCommunity(handle);
    insertPublication(handle, {
      sourceId: source.id,
      communityId: community.id,
      publishedAt: NOON - 30 * DAY,
      promotional: true,
    });
    insertPublication(handle, {
      sourceId: source.id,
      communityId: community.id,
      publishedAt: NOON - DAY,
      promotional: true,
    });

    expect(lastPublishedInCommunity(handle.db, community.id)).toBe(NOON - DAY);
  });
});

describe('checkLimits — self-promo ratio', () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  /** n publications in one community, `promo` of them promotional. */
  function history(communityId: string, n: number, promo: number) {
    const source = insertSource(handle);
    for (let i = 0; i < n; i += 1) {
      insertPublication(handle, {
        sourceId: source.id,
        communityId,
        // Well outside the cooldown, so only the ratio is under test.
        publishedAt: NOON - (100 + i) * DAY,
        promotional: i < promo,
      });
    }
  }

  it('does not apply to a non-promotional reply', () => {
    const community = insertCommunity(handle);
    history(community.id, 10, 10);

    const verdict = checkLimits(
      handle.db,
      LIMITS,
      inputs({ communityId: community.id, promotional: false }),
      fixedClock(NOON),
    );
    expect(check(verdict, 'promo_ratio').passed).toBe(true);
    expect(check(verdict, 'promo_ratio').message).toContain('improves the ratio');
  });

  it('counts the reply about to go out', () => {
    // 19 posts, 1 promotional. Adding one more promotional makes 2/20 = 10%,
    // exactly the cap. Checking before adding would have said 5% and let a
    // steady stream of posts each sit just under the line.
    const community = insertCommunity(handle);
    history(community.id, 19, 1);

    const verdict = checkLimits(
      handle.db,
      LIMITS,
      inputs({ communityId: community.id }),
      fixedClock(NOON),
    );
    expect(check(verdict, 'promo_ratio').passed).toBe(true);
    expect(check(verdict, 'promo_ratio').message).toContain('10%');
  });

  it('blocks when the projected ratio exceeds the cap', () => {
    // 9 posts, 1 promotional. One more makes 2/10 = 20%, over 10%.
    const community = insertCommunity(handle);
    history(community.id, 9, 1);

    const verdict = checkLimits(
      handle.db,
      LIMITS,
      inputs({ communityId: community.id }),
      fixedClock(NOON),
    );
    expect(check(verdict, 'promo_ratio').passed).toBe(false);
    expect(verdict.allowed).toBe(false);
  });

  it('blocks the very first post if it would be promotional and the cap is tight', () => {
    // No history: 1/1 = 100%, over any sane cap. Correct — the first thing
    // said in a community should not be an advert.
    const community = insertCommunity(handle);
    const verdict = checkLimits(
      handle.db,
      LIMITS,
      inputs({ communityId: community.id }),
      fixedClock(NOON),
    );
    expect(check(verdict, 'promo_ratio').passed).toBe(false);
  });

  it("respects the community's own cap when it is stricter", () => {
    const community = insertCommunity(handle);
    history(community.id, 19, 0); // 1/20 = 5%, fine under our 10%

    const verdict = checkLimits(
      handle.db,
      LIMITS,
      inputs({ communityId: community.id, communityRatioCapPct: 4 }),
      fixedClock(NOON),
    );
    expect(check(verdict, 'promo_ratio').passed).toBe(false);
    expect(check(verdict, 'promo_ratio').message).toContain('4%');
  });

  it("does not adopt the community's cap when it is looser than ours", () => {
    const community = insertCommunity(handle);
    history(community.id, 9, 1); // would be 20%

    const verdict = checkLimits(
      handle.db,
      LIMITS,
      inputs({ communityId: community.id, communityRatioCapPct: 50 }),
      fixedClock(NOON),
    );
    expect(check(verdict, 'promo_ratio').passed).toBe(false);
  });

  it('only looks at the most recent window', () => {
    const community = insertCommunity(handle);
    history(community.id, 40, 40);
    const snapshot = promoRatio(handle.db, community.id, 5);
    expect(snapshot.total).toBe(5);
  });

  it('flags that the denominator only counts what Signal published', () => {
    // Comments written by hand are invisible here, so the ratio reads worse
    // than reality. Erring toward caution is right, but it should be visible.
    const community = insertCommunity(handle);
    history(community.id, 3, 1);
    expect(promoRatio(handle.db, community.id, 30).signalOnly).toBe(true);
  });
});

describe('checkLimits — overall', () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = testDb();
  });
  afterEach(() => handle.close());

  it('allows a clean first non-promotional reply', () => {
    const community = insertCommunity(handle);
    const verdict = checkLimits(
      handle.db,
      LIMITS,
      inputs({ communityId: community.id, promotional: false }),
      fixedClock(NOON),
    );
    expect(verdict.allowed).toBe(true);
    expect(verdict.blockedBy).toBeNull();
  });

  it('reports every failing limit, not just the first', () => {
    // Daily cap reached and inside the cooldown at once.
    const source = insertSource(handle);
    const community = insertCommunity(handle);
    for (let i = 0; i < 3; i += 1) {
      insertPublication(handle, {
        sourceId: source.id,
        communityId: community.id,
        publishedAt: NOON - (i + 1) * 60_000,
        promotional: false,
      });
    }

    const verdict = checkLimits(
      handle.db,
      LIMITS,
      inputs({ communityId: community.id }),
      fixedClock(NOON),
    );
    const failed = verdict.checks.filter((c) => !c.passed).map((c) => c.rule);
    expect(failed).toContain('daily_cap');
    expect(failed).toContain('cooldown');
  });

  it('always returns all three checks', () => {
    const verdict = checkLimits(handle.db, LIMITS, inputs(), fixedClock(NOON));
    expect(verdict.checks.map((c) => c.rule).sort()).toEqual([
      'cooldown',
      'daily_cap',
      'promo_ratio',
    ]);
  });
});
