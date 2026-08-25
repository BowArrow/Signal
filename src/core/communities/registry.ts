import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { communities, type Community, type SourceKindValue } from '../db/schema.js';
import { newId } from '../lib/id.js';
import type { Clock } from '../lib/clock.js';
import { systemClock } from '../lib/clock.js';

export interface CommunityRef {
  readonly platform: SourceKindValue;
  /** Canonical name on the platform. Case is normalized, not preserved. */
  readonly name: string;
  readonly displayName?: string;
  readonly url?: string;
}

/**
 * Reddit treats subreddit names case-insensitively, so "LocalLLaMA" and
 * "localllama" are one community. Store the lowercase key and keep the
 * prettier form in displayName.
 */
export function communityKey(platform: SourceKindValue, name: string): string {
  return `${platform}:${name.trim().toLowerCase()}`;
}

export function describeCommunity(platform: SourceKindValue, name: string): string {
  switch (platform) {
    case 'reddit':
      return `r/${name}`;
    case 'hn':
      return 'Hacker News';
    default:
      return name;
  }
}

export function communityUrl(platform: SourceKindValue, name: string): string | null {
  switch (platform) {
    case 'reddit':
      return `https://www.reddit.com/r/${name}/`;
    case 'hn':
      return 'https://news.ycombinator.com/';
    default:
      return null;
  }
}

/**
 * Finds or creates the community row. Called on every ingested item, because
 * a site-wide search is expected to turn up places Signal has never seen —
 * meeting a new community is the normal case, not an exception.
 *
 * A newly met community has no rules record, which is exactly what holds its
 * opportunities at rules_unknown until one is fetched and read.
 */
export function upsertCommunity(
  db: Db,
  ref: CommunityRef,
  clock: Clock = systemClock,
  /**
   * True when a source points at this community directly, rather than merely
   * turning it up in a search. Only ever upgrades: meeting r/LocalLLaMA once
   * in a search result must not un-monitor it.
   */
  monitored = false,
): Community {
  const name = ref.name.trim().toLowerCase();
  const existing = db
    .select()
    .from(communities)
    .where(and(eq(communities.platform, ref.platform), eq(communities.name, name)))
    .get();

  if (existing) {
    if (monitored && !existing.monitored) {
      db.update(communities)
        .set({ monitored: true, updatedAt: clock.now() })
        .where(eq(communities.id, existing.id))
        .run();
      return { ...existing, monitored: true };
    }
    return existing;
  }

  const row: Community = {
    id: newId(),
    platform: ref.platform,
    name,
    displayName: ref.displayName ?? describeCommunity(ref.platform, ref.name.trim()),
    url: ref.url ?? communityUrl(ref.platform, ref.name.trim()),
    description: null,
    subscribers: null,
    monitored,
    firstSeenAt: clock.now(),
    blockedAt: null,
    blockedReason: null,
    createdAt: clock.now(),
    updatedAt: clock.now(),
  };
  db.insert(communities).values(row).run();
  return row;
}

/**
 * Finds a community by whatever the user typed, across every platform.
 *
 * The CLI used to try reddit then hn, which quietly failed for a Stack
 * Exchange site or a GitHub repo. Accepts `r/LocalLLaMA`, `LocalLLaMA`,
 * `superuser`, `ollama/ollama`, or a display name.
 */
export function findCommunityAnywhere(db: Db, query: string): Community | undefined {
  const needle = query.trim().replace(/^r\//, '').toLowerCase();
  const rows = db.select().from(communities).all();
  return (
    rows.find((c) => c.name === needle) ??
    rows.find((c) => c.displayName.toLowerCase() === query.trim().toLowerCase()) ??
    rows.find((c) => c.displayName.toLowerCase().replace(/^r\//, '') === needle)
  );
}

export function findCommunity(
  db: Db,
  platform: SourceKindValue,
  name: string,
): Community | undefined {
  return db
    .select()
    .from(communities)
    .where(and(eq(communities.platform, platform), eq(communities.name, name.trim().toLowerCase())))
    .get();
}

/** A hard human "no". Nothing is ever drafted here again. */
export function blockCommunity(
  db: Db,
  communityId: string,
  reason: string,
  clock: Clock = systemClock,
): void {
  db.update(communities)
    .set({ blockedAt: clock.now(), blockedReason: reason, monitored: false, updatedAt: clock.now() })
    .where(eq(communities.id, communityId))
    .run();
}

export function unblockCommunity(db: Db, communityId: string, clock: Clock = systemClock): void {
  db.update(communities)
    .set({ blockedAt: null, blockedReason: null, updatedAt: clock.now() })
    .where(eq(communities.id, communityId))
    .run();
}
