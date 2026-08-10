import type { RedditClient } from './reddit.js';
import type { Logger } from '../lib/logger.js';
import type { Source } from '../db/schema.js';
import { normalizeRedditPost, type RedditListingChild } from './normalize.js';
import type { Poller, PollResult } from './types.js';

/**
 * Site-wide Reddit search. This is the discovery half of the system.
 *
 * A configured subreddit poller can only ever find threads in places I already
 * thought of. This one searches all of Reddit for a phrase and surfaces
 * whatever comes back, from communities Signal has never seen. Each result
 * carries its own subreddit, so the rules gate applies per community and a
 * brand-new one is held at rules_unknown until its rules are fetched and read.
 *
 * The identifier of a `reddit_search` source is the query string. Reddit's
 * search supports its own operators (`self:yes`, `nsfw:no`, quoted phrases),
 * and those are passed through untouched.
 */

interface Listing {
  readonly data?: { readonly children?: RedditListingChild[]; readonly after?: string | null };
}

export interface RedditSearchOptions {
  readonly limit?: number;
  /** hour | day | week | month | year | all */
  readonly time?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
}

export class RedditSearchPoller implements Poller {
  readonly kind = 'reddit_search' as const;

  constructor(
    private readonly client: RedditClient | null,
    private readonly logger: Logger,
    private readonly options: RedditSearchOptions = {},
  ) {}

  available(): { ready: boolean; reason?: string } {
    if (this.client) return { ready: true };
    return {
      ready: false,
      reason: 'REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are not set — discovery is off',
    };
  }

  async poll(source: Source): Promise<PollResult> {
    if (!this.client) throw new Error('reddit search poller invoked without credentials');

    const listing = await this.client.get<Listing>('/search', {
      q: source.identifier,
      // Newest first: a thread is worth answering while it is still live, and
      // relevance ordering returns years-old classics.
      sort: 'new',
      t: this.options.time ?? 'week',
      limit: String(this.options.limit ?? 50),
      type: 'link',
      // Keep the crawl inside Reddit's own index rather than following out.
      include_over_18: 'off',
    });

    const children = listing.data?.children ?? [];
    const items: PollResult['items'] = [];
    const skipped: PollResult['skipped'] = [];

    for (const child of children) {
      if (child.kind !== 't3') {
        skipped.push({ externalId: child.data?.name ?? '?', reason: `unexpected kind ${child.kind}` });
        continue;
      }
      const normalized = normalizeRedditPost(child);
      if ('skip' in normalized) {
        skipped.push({ externalId: child.data?.name ?? '?', reason: normalized.skip });
        continue;
      }
      items.push(normalized);
    }

    const communities = new Set(items.map((i) => i.community?.name).filter(Boolean));
    this.logger.debug('reddit search complete', {
      query: source.identifier,
      fetched: children.length,
      kept: items.length,
      communities: communities.size,
    });

    return { items, skipped };
  }
}
