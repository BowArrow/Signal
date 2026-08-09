import { XMLParser } from 'fast-xml-parser';
import type { HttpClient } from '../lib/http.js';
import type { Logger } from '../lib/logger.js';
import type { Source } from '../db/schema.js';
import { normalizeRssEntry, type RssEntry } from './normalize.js';
import type { Poller, PollResult } from './types.js';

/**
 * RSS and Atom. This is the one poller that hits arbitrary third-party hosts
 * rather than a documented API, so it goes through the robots.txt check and
 * the per-host rate limiter like any other crawler would.
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  // Feeds are wildly inconsistent about whether a single item is an array.
  isArray: (name) => name === 'item' || name === 'entry',
});

interface ParsedFeed {
  rss?: { channel?: { item?: RssEntry[]; title?: string } };
  feed?: { entry?: RssEntry[]; title?: string };
}

export function parseFeed(xml: string): RssEntry[] {
  const parsed = parser.parse(xml) as ParsedFeed;
  return parsed.rss?.channel?.item ?? parsed.feed?.entry ?? [];
}

export class RssPoller implements Poller {
  readonly kind = 'rss' as const;

  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {}

  available(): { ready: boolean } {
    return { ready: true };
  }

  async poll(source: Source): Promise<PollResult> {
    const xml = await this.http.text(source.identifier, {
      headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    });

    const entries = parseFeed(xml);
    const items: PollResult['items'] = [];
    const skipped: PollResult['skipped'] = [];

    for (const entry of entries) {
      const normalized = normalizeRssEntry(entry, source.identifier);
      if ('skip' in normalized) {
        skipped.push({ externalId: '?', reason: normalized.skip });
        continue;
      }
      items.push(normalized);
    }

    this.logger.debug('rss poll complete', {
      feed: source.identifier,
      fetched: entries.length,
      kept: items.length,
      skipped: skipped.length,
    });

    return { items, skipped };
  }
}
