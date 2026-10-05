import type { HttpClient } from '../lib/http.js';
import type { Logger } from '../lib/logger.js';
import type { Source } from '../db/schema.js';
import { normalizeHnHit, type AlgoliaHit } from './normalize.js';
import type { Poller, PollResult } from './types.js';
import { publicSearchJson } from './public-search.js';

/**
 * Hacker News via the Algolia search API — public, documented, no key.
 *
 * This poller is permanently read-only. There is no HN publish path anywhere
 * in Signal and there will not be one: Signal surfaces the thread and drafts
 * the comment, and you paste it yourself. That is a policy decision, not a
 * missing feature.
 */

const SEARCH_URL = 'https://hn.algolia.com/api/v1/search_by_date';

interface AlgoliaResponse {
  readonly hits?: AlgoliaHit[];
  readonly nbHits?: number;
}

export class HackerNewsPoller implements Poller {
  readonly kind = 'hn' as const;

  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
    private readonly options: {
      hitsPerPage?: number;
      minPoints?: number;
      /** Ask Algolia for recent items only, rather than filtering after. */
      maxAgeHours?: number;
    } = {},
  ) {}

  available(): { ready: boolean } {
    // No credentials needed.
    return { ready: true };
  }

  async poll(source: Source, signal?: AbortSignal): Promise<PollResult> {
    const url = new URL(SEARCH_URL);
    const research = source.discoveredVia === 'operations-research';
    url.searchParams.set('query', research ? JSON.stringify(source.identifier.replace(/"/g, '').trim()) : source.identifier);
    if (research) url.searchParams.set('advancedSyntax', 'true');
    url.searchParams.set('tags', '(story,comment)');
    url.searchParams.set('hitsPerPage', String(this.options.hitsPerPage ?? (research ? 100 : 50)));

    // Push the age cutoff into the query. The runner enforces it again, but
    // filtering server-side means we are not paging through years of archive
    // to find the last day of activity.
    const filters: string[] = [];
    if (this.options.minPoints != null) filters.push(`points>=${this.options.minPoints}`);
    const maxAgeHours = source.maxItemAgeHours ?? this.options.maxAgeHours;
    if (maxAgeHours != null) {
      const cutoff = Math.floor((Date.now() - maxAgeHours * 3_600_000) / 1000);
      filters.push(`created_at_i>${cutoff}`);
    }
    if (filters.length) url.searchParams.set('numericFilters', filters.join(','));

    const res = await publicSearchJson(this.http, url.toString(), signal) as AlgoliaResponse;
    if (!Array.isArray(res.hits)) throw new Error('Unexpected Hacker News search response');
    const hits = res.hits.slice(0, 100);

    const items: PollResult['items'] = [];
    const skipped: PollResult['skipped'] = [];

    for (const hit of hits) {
      const normalized = normalizeHnHit(hit);
      if ('skip' in normalized) {
        skipped.push({ externalId: hit.objectID ?? '?', reason: normalized.skip });
        continue;
      }
      items.push(normalized);
    }

    this.logger.debug('hn poll complete', {
      query: source.identifier,
      fetched: hits.length,
      kept: items.length,
      skipped: skipped.length,
    });

    return { items, skipped };
  }
}
