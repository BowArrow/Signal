import type { Logger } from '../lib/logger.js';
import type { Source } from '../db/schema.js';
import { normalizeRedditPost } from './normalize.js';
import type { Poller, PollResult } from './types.js';
import { isSelfPost, type RedditScrapeClient } from './reddit-scrape.js';

/**
 * Reddit pollers that read public HTML instead of the API.
 *
 * These stand in for RedditPoller and RedditSearchPoller when there are no API
 * credentials. Same output, same downstream path — only the transport differs.
 *
 * A source has to carry a named `ignoreRobotsTxt` exemption in config to be
 * polled this way. Without one the HttpClient refuses the request, so enabling
 * scraping is a deliberate per-source act rather than a side effect of not
 * having credentials.
 */

/** Marks items whose body still needs a separate fetch. */
export interface PollResultWithPending extends PollResult {
  /** externalIds of self posts whose selftext has not been fetched yet. */
  readonly pendingBodies: { readonly externalId: string; readonly permalink: string }[];
}

function collect(
  children: ReturnType<RedditScrapeClient['listing']> extends Promise<infer T> ? T : never,
  logger: Logger,
  label: string,
): PollResultWithPending {
  const items: PollResult['items'] = [];
  const skipped: PollResult['skipped'] = [];
  const pendingBodies: { externalId: string; permalink: string }[] = [];

  for (const child of children) {
    const normalized = normalizeRedditPost(child);
    if ('skip' in normalized) {
      skipped.push({ externalId: child.data.name ?? '?', reason: normalized.skip });
      continue;
    }
    items.push(normalized);

    // Only a text post has a body worth fetching. A link post genuinely has
    // none, so queuing a request for it would be pure waste.
    if (isSelfPost(child) && child.data.permalink) {
      pendingBodies.push({
        externalId: normalized.externalId,
        permalink: child.data.permalink,
      });
    }
  }

  logger.debug('reddit public poll complete', {
    source: label,
    kept: items.length,
    skipped: skipped.length,
    bodiesPending: pendingBodies.length,
  });

  return { items, skipped, pendingBodies };
}

export class RedditPublicPoller implements Poller {
  readonly kind = 'reddit' as const;

  constructor(
    private readonly client: RedditScrapeClient,
    private readonly logger: Logger,
    private readonly options: { limit?: number } = {},
  ) {}

  available(): { ready: boolean; reason?: string } {
    return this.client.available();
  }

  requiresRobotsExemption(): boolean {
    return true;
  }

  async poll(source: Source): Promise<PollResultWithPending> {
    const children = await this.client.listing(source.identifier, this.options.limit ?? 25);
    return collect(children, this.logger, source.displayName);
  }
}

export class RedditPublicSearchPoller implements Poller {
  readonly kind = 'reddit_search' as const;

  constructor(
    private readonly client: RedditScrapeClient,
    private readonly logger: Logger,
    private readonly options: { limit?: number } = {},
  ) {}

  available(): { ready: boolean; reason?: string } {
    return this.client.available();
  }

  requiresRobotsExemption(): boolean {
    return true;
  }

  async poll(source: Source): Promise<PollResultWithPending> {
    const children = await this.client.search(source.identifier, this.options.limit ?? 25);
    return collect(children, this.logger, source.displayName);
  }
}
