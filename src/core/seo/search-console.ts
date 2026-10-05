import { z } from 'zod';
import { boundedJson } from '../connections/network.js';
import { analyticsLocalDate } from '../analytics/ga4.js';
import { searchPropertyMatches, type SearchReport } from '../../shared/seo.js';

const responseSchema = z.object({ rows: z.array(z.object({ keys: z.tuple([z.string().max(500), z.string().url().max(2000)]), clicks: z.number().finite().nonnegative(), impressions: z.number().finite().nonnegative(), ctr: z.number().min(0).max(1), position: z.number().finite().nonnegative() })).max(1000).default([]) });
export class SearchConsoleReader {
  constructor(private readonly token: string, private readonly transport: typeof fetch, private readonly signal: AbortSignal, private readonly allowed: () => void) {}
  async report(siteUrl: string, origin: string, now: number): Promise<SearchReport> {
    if (!searchPropertyMatches(siteUrl, origin)) throw new Error('Choose a Search Console property covering this product website.');
    const today = Date.parse(analyticsLocalDate(now, 'America/Los_Angeles') + 'T00:00:00Z');
    const date = (days: number) => new Date(today - days * 86400000).toISOString().slice(0, 10);
    // Completed 28-day window, excluding the newest three days for reporting delay.
    const startDate = date(30), endDate = date(3);
    this.signal.throwIfAborted(); this.allowed();
    const data = responseSchema.parse(await boundedJson(await this.transport(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([this.signal, AbortSignal.timeout(20000)]),
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ startDate, endDate, dimensions: ['query', 'page'], type: 'web', dataState: 'final', rowLimit: 1000,
        dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'includingRegex', expression: '^' + (new URL(origin).origin + '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }] }] }),
    })));
    this.signal.throwIfAborted(); this.allowed();
    const rows = data.rows.map(({ keys, ...metrics }) => ({ query: keys[0], page: keys[1], ...metrics }));
    if (rows.some(row => new URL(row.page).origin !== new URL(origin).origin)) throw new Error('Search report contains another website.');
    return { startDate, endDate, rows, limitations: ['Top query/page rows only; anonymized queries and other rows may be omitted. Do not sum these rows as site totals.', 'Impressions measure this website appearing in Google, not market-wide search volume. Average position varies by search and is not a fixed rank.', ...(rows.length === 1000 ? ['The 1,000-row reporting limit was reached.'] : [])] };
  }
}
