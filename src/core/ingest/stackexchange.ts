import type { HttpClient } from '../lib/http.js';
import type { Logger } from '../lib/logger.js';
import type { Source } from '../db/schema.js';
import { cleanText, MAX_TITLE_CHARS } from './normalize.js';
import type { NormalizedItem, Poller, PollResult } from './types.js';

/**
 * Stack Exchange, across any of its sites.
 *
 * Documented, open API with no approval gate — the thing Reddit's is not.
 * It is also the densest source of the question this system is best at
 * answering: someone asking what actually fits in their VRAM, with a real
 * numeric answer available.
 *
 * The identifier is `site:query`, e.g. `superuser:ollama` or
 * `stackoverflow:local llm`. Sites are separate communities with separate
 * norms, which is exactly how the rules registry already models them.
 */

const API = 'https://api.stackexchange.com/2.3';

interface SeQuestion {
  readonly question_id?: number;
  readonly title?: string;
  /** HTML. Present only with `filter=withbody`; cleanText flattens it. */
  readonly body?: string;
  readonly link?: string;
  readonly creation_date?: number;
  readonly score?: number;
  readonly answer_count?: number;
  readonly is_answered?: boolean;
  readonly closed_date?: number;
  readonly tags?: string[];
  readonly owner?: { readonly display_name?: string; readonly user_type?: string };
}

interface SeResponse {
  readonly items?: SeQuestion[];
  readonly quota_remaining?: number;
  readonly error_message?: string;
}

export function parseIdentifier(identifier: string): { site: string; query: string } {
  const index = identifier.indexOf(':');
  if (index === -1) return { site: identifier.trim(), query: '' };
  return {
    site: identifier.slice(0, index).trim(),
    query: identifier.slice(index + 1).trim(),
  };
}

export function normalizeQuestion(
  question: SeQuestion,
  site: string,
): NormalizedItem | { skip: string } {
  if (!question.question_id) return { skip: 'no question_id' };
  if (question.closed_date) return { skip: 'closed' };

  // An answered question with an accepted solution is a graveyard: the asker
  // has moved on and a later reply helps nobody. This is the same judgement
  // the "thread already answered" rejection reason encodes.
  if (question.is_answered) return { skip: 'already has an accepted answer' };

  const title = cleanText(question.title ?? '', MAX_TITLE_CHARS);
  if (!title.text) return { skip: 'empty title' };

  // HTML, from `filter=withbody`. cleanText already flattens markup and keeps
  // link targets, so it arrives readable.
  const body = cleanText(question.body ?? '');

  return {
    externalId: String(question.question_id),
    url: question.link ?? `https://${site}.stackexchange.com/q/${question.question_id}`,
    community: { platform: 'stackexchange', name: site, displayName: siteLabel(site) },
    author: question.owner?.display_name ?? null,
    title: title.text,
    body: body.text,
    postedAt: question.creation_date != null ? question.creation_date * 1000 : null,
    commentCount: question.answer_count ?? null,
    platformScore: question.score ?? null,
    truncated: body.truncated || title.truncated,
    raw: question,
  };
}

/** Stack Exchange's own display names, for the ones worth naming properly. */
const SITE_LABELS: Record<string, string> = {
  stackoverflow: 'Stack Overflow',
  superuser: 'Super User',
  serverfault: 'Server Fault',
  askubuntu: 'Ask Ubuntu',
  unix: 'Unix & Linux',
  datascience: 'Data Science SE',
  ai: 'AI SE',
};

export function siteLabel(site: string): string {
  return SITE_LABELS[site] ?? `${site}.stackexchange.com`;
}

export class StackExchangePoller implements Poller {
  readonly kind = 'stackexchange' as const;

  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
    private readonly options: { pageSize?: number; maxAgeHours?: number; apiKey?: string } = {},
  ) {}

  available(): { ready: boolean } {
    // No key required. A key raises the daily quota from 300 to 10,000, which
    // only matters at a polling cadence far beyond this one.
    return { ready: true };
  }

  async poll(source: Source): Promise<PollResult> {
    const { site, query } = parseIdentifier(source.identifier);
    const url = new URL(`${API}/search/advanced`);

    url.searchParams.set('site', site);
    url.searchParams.set('order', 'desc');
    url.searchParams.set('sort', 'creation');
    url.searchParams.set('pagesize', String(this.options.pageSize ?? 30));
    // `withbody` is one of Stack Exchange's built-in named filters. The
    // default omits bodies entirely, which leaves the classifier judging a
    // question on its title — and, worse, does so silently.
    url.searchParams.set('filter', 'withbody');
    // Note: `q` is free text, not a boolean expression. "a OR b" matches
    // documents containing the word "or" and reliably returns nothing useful.
    if (query) url.searchParams.set('q', query);
    if (this.options.apiKey) url.searchParams.set('key', this.options.apiKey);

    // The source's own window wins. Passing the global 72h here would clamp
    // Stack Exchange at the API level no matter what the source asked for,
    // and an unanswered question three days old is not stale here.
    const ageWindow = source.maxItemAgeHours ?? this.options.maxAgeHours;
    if (ageWindow != null) {
      const from = Math.floor((Date.now() - ageWindow * 3_600_000) / 1000);
      url.searchParams.set('fromdate', String(from));
    }

    const res = await this.http.json<SeResponse>(url.toString(), { official: true });
    if (res.error_message) throw new Error(`stack exchange: ${res.error_message}`);

    const items: NormalizedItem[] = [];
    const skipped: PollResult['skipped'] = [];

    for (const question of res.items ?? []) {
      const normalized = normalizeQuestion(question, site);
      if ('skip' in normalized) {
        skipped.push({ externalId: String(question.question_id ?? '?'), reason: normalized.skip });
        continue;
      }
      items.push(normalized);
    }

    this.logger.debug('stack exchange poll complete', {
      site,
      query,
      kept: items.length,
      skipped: skipped.length,
      quota: res.quota_remaining,
    });

    // The daily quota is small without a key, and running out mid-week would
    // look like the source quietly dying.
    if (res.quota_remaining != null && res.quota_remaining < 50) {
      this.logger.warn('stack exchange quota running low', { remaining: res.quota_remaining });
    }

    return { items, skipped };
  }
}
