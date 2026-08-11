import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { opportunities } from '../db/schema.js';
import { cleanText } from './normalize.js';
import type { Clock } from '../lib/clock.js';
import { systemClock } from '../lib/clock.js';
import type { Logger } from '../lib/logger.js';
import { RedditBlockedError, type RedditScrapeClient } from './reddit-scrape.js';

/**
 * Fills in post bodies that the listing page did not carry.
 *
 * Old Reddit lazy-loads selftext, so a scraped text post lands with a title
 * and nothing else. Fetching all of them during ingest would turn one request
 * per subreddit into twenty-six; instead each one becomes a queued job, paced
 * by the same per-host limiter and durable across restarts.
 *
 * Scoring ignores anything still marked needsBody, so a thread is never judged
 * on its title alone — it just waits a few minutes for its body to arrive.
 */

export const JOB_HYDRATE_BODY = 'reddit.hydrate-body';

export interface HydratePayload {
  readonly opportunityId: string;
  readonly permalink: string;
  readonly externalId: string;
}

export function isHydratePayload(value: unknown): value is HydratePayload {
  if (typeof value !== 'object' || value == null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['opportunityId'] === 'string' &&
    typeof v['permalink'] === 'string' &&
    typeof v['externalId'] === 'string'
  );
}

export async function hydrateBody(
  db: Db,
  client: RedditScrapeClient,
  payload: HydratePayload,
  logger: Logger,
  clock: Clock = systemClock,
): Promise<void> {
  const row = db
    .select()
    .from(opportunities)
    .where(eq(opportunities.id, payload.opportunityId))
    .get();

  // The opportunity may have been pruned, or already hydrated by a retry.
  if (!row || !row.needsBody) return;

  let body: string;
  try {
    body = await client.body(payload.permalink, payload.externalId);
  } catch (err) {
    if (err instanceof RedditBlockedError) {
      // Being refused is not a bug in this one job. Let it retry on the
      // queue's backoff rather than burning attempts in a tight loop.
      logger.warn('body hydration refused, will retry later', {
        opportunity: payload.opportunityId,
      });
    }
    throw err;
  }

  const cleaned = cleanText(body);

  db.update(opportunities)
    .set({
      body: cleaned.text,
      // Cleared either way. An empty body is a real answer — some text posts
      // are a title and nothing else — and leaving the flag set would park the
      // opportunity outside scoring forever.
      needsBody: false,
      updatedAt: clock.now(),
    })
    .where(eq(opportunities.id, payload.opportunityId))
    .run();

  logger.debug('body hydrated', {
    opportunity: payload.opportunityId,
    chars: cleaned.text.length,
  });
}

/** Opportunities still waiting on a body, oldest first. */
export function pendingBodies(db: Db, limit = 100): { id: string; url: string }[] {
  return db
    .select({ id: opportunities.id, url: opportunities.url })
    .from(opportunities)
    .where(and(eq(opportunities.needsBody, true), inArray(opportunities.status, ['new'])))
    .limit(limit)
    .all();
}
