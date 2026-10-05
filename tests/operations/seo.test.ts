import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { products } from '../../src/core/db/schema.js';
import { initializeMarketing } from '../../src/core/marketing/store.js';
import { SearchConsoleReader } from '../../src/core/seo/search-console.js';
import { SeoService } from '../../src/core/seo/service.js';
import { searchPropertyMatches } from '../../src/shared/seo.js';
import { acquisitionChannel } from '../../src/core/operations/acquisition-channels.js';
import type { OperationState } from '../../src/shared/operations.js';

let app: App, service: SeoService, productId: string;
const clock = fixedClock(Date.UTC(2026, 8, 27, 16));
const report = { startDate: '2026-08-28', endDate: '2026-09-24', rows: [{ query: 'compare client reports', page: 'https://siplemona.de/', clicks: 1, impressions: 20, ctr: 0.05, position: 12 }], limitations: ['Top rows only.'] };
let read: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null);
  app = createApp({ databaseUrl: ':memory:', logger: silentLogger, clock }); initializeMarketing(app);
  productId = app.db.select().from(products).where(eq(products.key, 'lemonade')).get()!.id;
  read = vi.fn(async () => report);
  app.connections = { accounts: () => [{ id: 'search', productId, provider: 'search-console', status: 'verified' }, { id: 'site', productId, provider: 'signal-blog', status: 'verified' }, { id: 'social', productId, provider: 'x', status: 'verified', grantedScopes: ['tweet.write'] }], searchRead: read } as unknown as NonNullable<App['connections']>;
  service = new SeoService(app);
});
afterEach(async () => { await service.stop(); app.close(); vi.unstubAllEnvs(); __setConfigForTests(null); });

it('only accepts a covering domain or same-origin root property', () => {
  expect(searchPropertyMatches('sc-domain:siplemona.de', 'https://siplemona.de')).toBe(true);
  expect(searchPropertyMatches('sc-domain:siplemona.de', 'https://docs.siplemona.de')).toBe(true);
  for (const site of ['sc-domain:other.de', 'https://other.de/', 'https://siplemona.de/blog/', 'https://siplemona.de/?x=1', 'http://siplemona.de/', 'https://secret@siplemona.de/']) expect(searchPropertyMatches(site, 'https://siplemona.de')).toBe(false);
  expect(searchPropertyMatches('sc-domain:siplemona.de', 'https://notsiplemona.de')).toBe(false);
});
it('reads final data at a fixed endpoint with exact-origin filtering and a dated window', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ rows: report.rows.map(({ query, page, ...metrics }) => ({ keys: [query, page], ...metrics })) }));
  const reader = new SearchConsoleReader('secret', fetcher, new AbortController().signal, () => {});
  const result = await reader.report('sc-domain:siplemona.de', 'https://siplemona.de', clock.now());
  expect(result).toMatchObject({ startDate: report.startDate, endDate: report.endDate, rows: report.rows });
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe('https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Asiplemona.de/searchAnalytics/query');
  expect(init?.redirect).toBe('error');
  expect(JSON.parse(String(init?.body))).toMatchObject({ dataState: 'final', rowLimit: 1000, dimensionFilterGroups: [{ filters: [{ expression: '^https://siplemona\\.de/' }] }] });
  expect(JSON.stringify(result)).not.toContain('secret');
});
it('rejects cross-host and malformed returned metrics', async () => {
  for (const override of [{ keys: ['compare reports', 'https://other.de/'] }, { ctr: 2 }, { impressions: -1 }]) {
    const reader = new SearchConsoleReader('secret', async () => Response.json({ rows: [{ keys: ['compare reports', 'https://siplemona.de/'], clicks: 1, impressions: 20, ctr: 0.05, position: 12, ...override }] }), new AbortController().signal, () => {});
    await expect(reader.report('sc-domain:siplemona.de', 'https://siplemona.de', clock.now())).rejects.toThrow();
  }
});
it('never reads after access has been revoked', async () => {
  const transport = vi.fn<typeof fetch>();
  const reader = new SearchConsoleReader('secret', transport, new AbortController().signal, () => { throw Error('revoked'); });
  await expect(reader.report('sc-domain:siplemona.de', 'https://siplemona.de', clock.now())).rejects.toThrow('revoked'); expect(transport).not.toHaveBeenCalled();
});
it('keeps search queries product-scoped and stops topic use after failed sync', async () => {
  expect(() => service.configure(productId, { accountId: 'other', siteUrl: 'sc-domain:siplemona.de' })).toThrow();
  service.configure(productId, { accountId: 'search', siteUrl: 'sc-domain:siplemona.de' });
  await service.sync(productId);
  expect(service.context(productId).fresh).toBe(true);
  expect(service.findings(productId)).toMatchObject([{ kind: 'search-console', query: 'compare client reports', url: 'https://siplemona.de/' }]);
  read.mockRejectedValueOnce(Error('provider unavailable'));
  await service.sync(productId);
  expect(service.context(productId).snapshot?.rows).toEqual(report.rows);
  expect(service.context(productId).fresh).toBe(false); expect(service.findings(productId)).toEqual([]);
});
it('empty observations are distinct from missing data and never invent a topic', async () => {
  read.mockResolvedValueOnce({ ...report, rows: [] });
  service.configure(productId, { accountId: 'search', siteUrl: 'sc-domain:siplemona.de' }); await service.sync(productId);
  expect(service.context(productId).detail).toContain('does not prove'); expect(service.findings(productId)).toEqual([]);
});
it('search-intent findings can only choose website publication, never a social account', async () => {
  service.configure(productId, { accountId: 'search', siteUrl: 'sc-domain:siplemona.de' }); await service.sync(productId);
  const state = { productId, mode: 'acquisition', accountIds: ['social'], ownedAudience: true, testChannels: false, dailyLimit: 3 } as OperationState;
  expect(acquisitionChannel(app, state, service.findings(productId))).toBeUndefined();
  state.accountIds.push('site'); expect(acquisitionChannel(app, state, service.findings(productId))?.route.account.id).toBe('site');
});
it('removing the source also removes the old report and candidates', async () => {
  service.configure(productId, { accountId: 'search', siteUrl: 'sc-domain:siplemona.de' }); await service.sync(productId);
  service.remove(productId); expect(service.view().snapshots).toEqual([]); expect(service.findings(productId)).toEqual([]);
});
