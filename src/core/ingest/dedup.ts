import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { opportunities, type Opportunity, type Source } from '../db/schema.js';
import { newId } from '../lib/id.js';
import type { Clock } from '../lib/clock.js';
import { systemClock } from '../lib/clock.js';
import { upsertCommunity } from '../communities/registry.js';
import type { NormalizedItem } from './types.js';

export interface PersistOutcome {
  readonly inserted: number;
  readonly updated: number;
  /** Seen before and nothing volatile changed. */
  readonly unchanged: number;
  readonly ids: string[];
  /** Communities met for the first time in this batch. */
  readonly newCommunities: string[];
}

/**
 * Statuses past which an opportunity is no longer ours to churn. Once I have
 * looked at something, a poller re-seeing it must not reset it — that would
 * put a rejected draft back in the queue every fifteen minutes.
 */
const TERMINAL_STATUSES = new Set(['approved', 'published', 'rejected']);

/**
 * Writes normalized items into the opportunities table, deduplicating on
 * (source_id, external_id).
 *
 * On a repeat sighting we refresh only the volatile facts — comment count,
 * platform score, and the body if it was edited — and leave status, scores and
 * discovery time alone. The unique index is the real guarantee; this function
 * is the polite path to it.
 */
export function persistItems(
  db: Db,
  source: Source,
  items: readonly NormalizedItem[],
  clock: Clock = systemClock,
  /**
   * External ids whose body still has to be fetched separately. Scraped Reddit
   * text posts arrive title-only; see hydrate.ts.
   */
  needsBody: ReadonlySet<string> = new Set(),
): PersistOutcome {
  const outcome = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    ids: [] as string[],
    newCommunities: [] as string[],
  };
  const now = clock.now();

  // Two pollers can hand us the same external id in one batch (an HN query
  // that overlaps another, a feed that repeats a guid). Collapse first so the
  // transaction does not fight the unique index.
  const deduped = new Map<string, NormalizedItem>();
  for (const item of items) {
    deduped.set(item.externalId, item);
  }

  db.transaction((tx) => {
    // Communities are resolved once per batch. A site-wide search routinely
    // returns fifty threads from twenty subreddits, and meeting one Signal
    // has never seen is the normal case for discovery, not an error.
    const communityIds = new Map<string, string>();
    const resolveCommunity = (item: NormalizedItem): string | null => {
      if (!item.community) return null;
      const key = `${item.community.platform}:${item.community.name.toLowerCase()}`;
      const cached = communityIds.get(key);
      if (cached) return cached;

      const community = upsertCommunity(tx as unknown as Db, item.community, clock);
      if (community.firstSeenAt === now) outcome.newCommunities.push(community.displayName);
      communityIds.set(key, community.id);
      return community.id;
    };

    for (const item of deduped.values()) {
      const communityId = resolveCommunity(item);

      const existing: Opportunity | undefined = tx
        .select()
        .from(opportunities)
        .where(and(eq(opportunities.sourceId, source.id), eq(opportunities.externalId, item.externalId)))
        .get();

      if (!existing) {
        const id = newId();
        tx.insert(opportunities)
          .values({
            id,
            sourceId: source.id,
            communityId,
            externalId: item.externalId,
            url: item.url,
            author: item.author,
            title: item.title,
            body: item.body,
            postedAt: item.postedAt,
            discoveredAt: now,
            commentCount: item.commentCount,
            platformScore: item.platformScore,
            needsBody: needsBody.has(item.externalId),
            status: 'new',
            raw: item.raw,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        outcome.inserted += 1;
        outcome.ids.push(id);
        continue;
      }

      outcome.ids.push(existing.id);

      if (TERMINAL_STATUSES.has(existing.status)) {
        outcome.unchanged += 1;
        continue;
      }

      const bodyChanged = existing.body !== item.body;
      const titleChanged = existing.title !== item.title;
      const countChanged = existing.commentCount !== item.commentCount;
      const scoreChanged = existing.platformScore !== item.platformScore;

      if (!bodyChanged && !titleChanged && !countChanged && !scoreChanged) {
        outcome.unchanged += 1;
        continue;
      }

      tx.update(opportunities)
        .set({
          title: item.title,
          body: item.body,
          commentCount: item.commentCount,
          platformScore: item.platformScore,
          // The author edited the post, so anything we concluded about it is
          // stale. Send it back for rescoring rather than trusting old axes.
          ...(bodyChanged || titleChanged
            ? { status: 'new' as const, scoredAt: null, scoreTotal: null }
            : {}),
          updatedAt: now,
        })
        .where(eq(opportunities.id, existing.id))
        .run();
      outcome.updated += 1;
    }
  });

  return outcome;
}
