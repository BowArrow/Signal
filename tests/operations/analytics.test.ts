import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { ConnectionService, type CredentialVault } from '../../src/core/connections/service.js';
import { AnalyticsService } from '../../src/core/analytics/service.js';
import { analyticsDates } from '../../src/core/analytics/ga4.js';
import { analyticsTotals } from '../../src/shared/analytics.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { VideoPublishingService } from '../../src/core/video/publishing.js';
import { studioAction, studioView } from '../../src/core/studio/store.js';
import { marketingCash, products, settings } from '../../src/core/db/schema.js';

class Vault implements CredentialVault { data = new Map<string, string>(); available() { return true; } get(k: string) { return this.data.get(k); } set(k: string, v: string) { this.data.set(k, v); } delete(k: string) { this.data.delete(k); } }
let app: App; let service: AnalyticsService; let connection: ConnectionService; let vault: Vault;
let clock: ReturnType<typeof fixedClock>; let send: ReturnType<typeof vi.fn<typeof fetch>>;
let productId: string; let accountId: string; let body: Record<string, unknown>; let report: ReturnType<typeof fixture>;
const row = (campaign = '(not set)', values = ['100', '40', '6', '2', '49.5']) => ({ dimensionValues: [{ value: campaign }], metricValues: values.map(value => ({ value })) });
const fixture = () => ({ dimensionHeaders: [{ name: 'sessionManualCampaignName' }], metricHeaders: ['sessions', 'engagedSessions', 'keyEvents', 'ecommercePurchases', 'purchaseRevenue'].map(name => ({ name })), rows: [row()], rowCount: 1, metadata: { timeZone: 'America/Los_Angeles', currencyCode: 'USD' } as Record<string, unknown> });
beforeEach(async () => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); clock = fixedClock(Date.parse('2026-09-17T02:00:00Z')); app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger });
  vault = new Vault(); report = fixture(); body = {};
  send = vi.fn(async (url, init) => {
    const target = new URL(String(url)); expect(init?.redirect).toBe('error');
    if (target.pathname === '/v1beta/accountSummaries') return Response.json({ accountSummaries: [{ propertySummaries: [{ property: 'properties/1234', displayName: 'Business website' }] }] });
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer private_ga_token');
    if (target.hostname === 'analyticsadmin.googleapis.com' && target.pathname === '/v1beta/properties/1234') { expect(init?.method).toBe('GET'); return Response.json({ name: 'properties/1234', timeZone: 'America/Los_Angeles', currencyCode: 'USD' }); }
    if (target.hostname === 'analyticsdata.googleapis.com' && target.pathname === '/v1beta/properties/1234:runReport') {
      expect(init?.method).toBe('POST'); const request = JSON.parse(String(init?.body));
      if (request.metrics[0].name === 'eventCount') return Response.json({ dimensionHeaders: [{ name: 'sessionManualCampaignName' }, { name: 'eventName' }], metricHeaders: [{ name: 'eventCount' }], rowCount: 0, rows: [], metadata: { timeZone: 'America/Los_Angeles', currencyCode: 'USD' } });
      body = request; return Response.json(report);
    }
    throw new Error('Unexpected test endpoint');
  });
  connection = new ConnectionService(app, vault, undefined, send); app.connections = connection; productId = connection.view().products[0]!.id;
  await connection.connect({ productId, provider: 'ga4', label: 'Website analytics', credential: 'private_ga_token' }); accountId = connection.accounts()[0]!.id;
  service = new AnalyticsService(app); app.analytics = service;
});
afterEach(async () => { await service.stop(); app.close(); vi.unstubAllEnvs(); __setConfigForTests(null); });
const configure = () => service.configure(productId, { accountId, propertyId: '1234' });
it('matches video campaign traffic only to this business and a confirmed YouTube receipt', async () => {
  app.videoPublishing = new VideoPublishingService(app, vault, () => { throw new Error('No video file reads during analytics.'); });
  const other = connection.view().products[1]!.id;
  for (const [id, business, receipt] of [['own-video', productId, { id: 'confirmed' }], ['other-video', other, { id: 'confirmed' }], ['unconfirmed-video', productId, null]] as const) app.db.insert(settings).values({ key: 'video.youtube.job.' + id, value: { id, productId: business, receipt } }).run();
  report.rows = [row('own-video'), row('other-video'), row('unconfirmed-video')]; report.rowCount = 3;
  configure(); await service.sync(productId);
  expect(service.snapshot(productId)!.rows.find(r => r.campaignId === 'own-video')?.attribution).toBe('matched');
  expect(service.snapshot(productId)!.rows.find(r => r.attribution === 'unknown')?.sessions).toBe(200);
});
const campaign = (id = productId) => { studioAction(app, { type: 'campaign', productId: id, value: { title: 'Helpful product guide', channel: 'content', objective: 'Find trial users', audience: 'People comparing workflows', offer: 'Try the app', formats: ['article'] } }); return studioView(app).campaigns.find(c => c.productId === id)!.id; };

it('replaces funnel observations without duplicates and hides other business campaign names', async () => {
  const own = campaign(), other = campaign(connection.view().products[1]!.id), base = send.getMockImplementation()!;
  let unavailable = false;
  send.mockImplementation(async (url, init) => {
    if (init?.body && JSON.parse(String(init.body)).metrics?.[0]?.name === 'eventCount') {
      if (unavailable) return new Response('', { status: 503 });
      return Response.json({ dimensionHeaders: [{ name: 'sessionManualCampaignName' }, { name: 'eventName' }], metricHeaders: [{ name: 'eventCount' }], rowCount: 2,
        rows: [own, other].map(value => ({ dimensionValues: [{ value }, { value: 'sign_up' }], metricValues: [{ value: '2' }] })), metadata: { timeZone: 'America/Los_Angeles', currencyCode: 'USD' } });
    }
    return base(url, init);
  });
  configure(); await service.sync(productId); await service.sync(productId);
  expect(service.snapshot(productId)!.funnel?.rows).toEqual([{ campaignId: own, attribution: 'matched', event: 'sign_up', count: 2 }, { campaignId: null, attribution: 'unknown', event: 'sign_up', count: 2 }]);
  expect(JSON.stringify(service.snapshot(productId))).not.toContain(other);
  unavailable = true; await service.sync(productId);
  expect(service.snapshot(productId)!.funnel).toMatchObject({ status: 'unavailable', rows: [] });
  expect(service.snapshot(productId)!.rows.length).toBeGreaterThan(0);
  expect(app.db.select().from(marketingCash).all()).toHaveLength(0);
});

it('reads a fixed-host calendar window and keeps analytics out of cash accounting', async () => {
  configure(); await service.sync(productId);
  expect(service.states()[0]!.status).toBe('current');
  expect(body).toMatchObject({ dateRanges: [{ startDate: '2026-08-17', endDate: '2026-09-15' }], dimensionFilter: { filter: { fieldName: 'hostName', stringFilter: { matchType: 'EXACT', value: 'siplemona.de' } } }, limit: '10000', currencyCode: 'USD' });
  expect(analyticsTotals(service.snapshot(productId)!.rows)).toMatchObject({ sessions: 100, ecommercePurchases: 2, purchaseRevenue: 49.5 });
  expect(app.db.select().from(marketingCash).all()).toHaveLength(0); expect(service.context(productId).stale).toBe(false);
  expect(JSON.stringify(service.view())).not.toContain('private_ga_token');
});
it('matches only campaigns owned by this business and groups unknown text without retaining it', async () => {
  const own = campaign(); const other = campaign(connection.view().products[1]!.id);
  report.rows = [row(own), row(other), row('buyer@example.com private_ga_token'), row('(not set)')]; report.rowCount = 4;
  configure(); await service.sync(productId); const rows = service.snapshot(productId)!.rows;
  expect(rows.find(r => r.campaignId === own)?.attribution).toBe('matched'); expect(rows.find(r => r.attribution === 'unknown')?.sessions).toBe(200);
  expect(rows.find(r => r.attribution === 'none')?.sessions).toBe(100);
  const output = JSON.stringify(service.context(productId)); expect(output).not.toContain(other); expect(output).not.toContain('buyer@example.com'); expect(output).not.toContain('private_ga_token');
});
it('replaces overlapping snapshots instead of accumulating results and survives service recreation', async () => {
  configure(); await service.sync(productId); report.rows = [row('(not set)', ['50', '20', '1', '0', '-4.5'])]; await service.sync(productId);
  expect(new AnalyticsService(app).snapshot(productId)!.rows[0]).toMatchObject({ sessions: 50, purchaseRevenue: -4.5 });
});
it.each([
  ['subjectToThresholding', true], ['dataLossFromOtherRow', true], ['samplingMetadatas', [{}]], ['dataTruncationReasons', [{}]], ['emptyReason', 'private_ga_token'],
])('shows a reporting limitation for %s without reflecting provider text', async (key, value) => {
  report.metadata[key] = value; configure(); await service.sync(productId);
  expect(service.states()[0]!.status).toBe('limited'); expect(service.snapshot(productId)!.limitations).toHaveLength(1); expect(JSON.stringify(service.view())).not.toContain('private_ga_token');
});
it('accepts a genuinely empty report but does not call missing reports zero', async () => {
  configure(); expect(service.context(productId).snapshot).toBeNull(); report.rows = []; report.rowCount = 0; await service.sync(productId);
  expect(service.states()[0]!.status).toBe('current'); expect(service.snapshot(productId)!.rows).toEqual([]);
});
it.each(['capacity', 'columns', 'restricted', 'timezone', 'currency', 'metric', 'duplicate'])('preserves the previous report when %s validation fails', async fault => {
  configure(); await service.sync(productId); const before = service.snapshot(productId);
  if (fault === 'capacity') report.rowCount = 10001;
  if (fault === 'columns') report.metricHeaders[0]!.name = 'totalUsers';
  if (fault === 'restricted') report.metadata['schemaRestrictionResponse'] = { activeMetricRestrictions: [{ metricName: 'purchaseRevenue' }] };
  if (fault === 'timezone') report.metadata['timeZone'] = 'UTC';
  if (fault === 'currency') report.metadata['currencyCode'] = 'JPY';
  if (fault === 'metric') report.rows[0]!.metricValues[0]!.value = 'NaN';
  if (fault === 'duplicate') { report.rows.push(row()); report.rowCount = 2; }
  await service.sync(productId); expect(service.states()[0]!.status).toBe('attention'); expect(service.snapshot(productId)).toEqual(before);
});
it('discards an old read after source changes or removal', async () => {
  configure(); let enter!: () => void; let release!: () => void; const started = new Promise<void>(r => { enter = r; }); const original = send.getMockImplementation()!;
  send.mockImplementation(async (url, init) => { if (String(url).includes(':runReport')) { enter(); await new Promise<void>(r => { release = r; }); } return original(url, init); });
  const pending = service.sync(productId); await started; service.remove(productId); configure(); release(); await pending;
  expect(service.snapshot(productId)).toBeUndefined(); expect(service.states()[0]!.status).toBe('idle');
  service.remove(productId); expect(service.states()).toEqual([]);
});
it('rejects account crossover and invalid property identifiers before requesting a report', () => {
  expect(() => service.configure(connection.view().products[1]!.id, { accountId, propertyId: '1234' })).toThrow('business');
  for (const propertyId of ['G-123', '../1234', '1234?token=foo', '0', '1234/other']) expect(() => service.configure(productId, { accountId, propertyId })).toThrow();
});
it('marks disconnected evidence stale and prevents future reads', async () => {
  configure(); await service.sync(productId); const previous = service.snapshot(productId); connection.disconnect(productId, accountId); send.mockClear(); await service.sync(productId);
  expect(send).not.toHaveBeenCalled(); expect(service.context(productId)).toMatchObject({ stale: true, sourceAvailable: false }); expect(service.snapshot(productId)).toEqual(previous);
});
it('requires reconfiguration when the business website hostname changes', async () => {
  configure(); await service.sync(productId); app.db.update(products).set({ utmBase: 'https://another.example' }).where(eq(products.id, productId)).run(); send.mockClear();
  await service.sync(productId); expect(send).not.toHaveBeenCalled(); expect(service.context(productId).stale).toBe(true);
});
it('serializes reads and auto-syncs only running operations on an hourly schedule', async () => {
  configure(); send.mockClear(); await service.tick(); expect(send).not.toHaveBeenCalled();
  app.operations = new OperationsService(app); const state = app.operations.state(productId); vi.spyOn(app.operations, 'state').mockReturnValue({ ...state, running: true });
  await Promise.all([service.tick(), service.sync(productId)]); await service.tick(); expect(send.mock.calls.filter(([u]) => String(u).includes(':runReport'))).toHaveLength(2);
  clock.advance(3600000); await service.tick(); expect(send.mock.calls.filter(([u]) => String(u).includes(':runReport'))).toHaveLength(4);
  clock.advance(37 * 3600000); expect(service.context(productId).stale).toBe(true);
});
it('blocks offline reads and sanitizes failure details', async () => {
  configure(); send.mockRejectedValue(new Error('private_ga_token private visitor')); await service.sync(productId); expect(JSON.stringify(service.view())).not.toContain('private visitor');
  const old = app.env.SIGNAL_OFFLINE; app.env.SIGNAL_OFFLINE = '1'; send.mockClear(); await service.tick(); await expect(service.sync(productId)).rejects.toThrow('offline'); expect(send).not.toHaveBeenCalled(); app.env.SIGNAL_OFFLINE = old;
});
it('refreshes expired credentials in the main process', async () => {
  configure(); const account = connection.accounts()[0]!;
  app.db.update(settings).set({ value: { ...account, expiresAt: clock.now() - 1 } }).where(eq(settings.key, `connections.account.${accountId}`)).run();
  vault.set(`account.${accountId}`, JSON.stringify({ accessToken: 'old', refreshToken: 'private_refresh', clientId: 'client' }));
  const original = send.getMockImplementation()!; send.mockImplementation(async (url, init) => String(url) === 'https://oauth2.googleapis.com/token' ? Response.json({ access_token: 'private_ga_token', expires_in: 3600 }) : original(url, init));
  await service.sync(productId); expect(service.states()[0]!.status).toBe('current'); expect(JSON.stringify(service.view())).not.toContain('private_refresh');
});
it('uses property calendar dates across DST and year boundaries', () => {
  expect(analyticsDates(Date.parse('2026-03-09T06:00:00Z'), 'America/Los_Angeles')).toEqual({ startDate: '2026-02-06', endDate: '2026-03-07' });
  expect(analyticsDates(Date.parse('2026-01-01T15:00:00Z'), 'Asia/Tokyo')).toEqual({ startDate: '2025-12-03', endDate: '2026-01-01' });
});
it('restarts an interrupted snapshot immediately after relaunch', async () => {
  configure(); const state = service.states()[0]!;
  app.db.update(settings).set({ value: { ...state, status: 'syncing', lastAttemptAt: clock.now() } }).where(eq(settings.key, `analytics.config.${productId}`)).run();
  app.operations = new OperationsService(app); const operation = app.operations.state(productId); vi.spyOn(app.operations, 'state').mockReturnValue({ ...operation, running: true });
  await new AnalyticsService(app).tick(); expect(service.states()[0]!.status).toBe('current');
});
it('does not commit a report after disconnect during an in-flight request', async () => {
  configure(); let enter!: () => void; let release!: () => void; const started = new Promise<void>(r => { enter = r; }); const original = send.getMockImplementation()!;
  send.mockImplementation(async (url, init) => { if (String(url).includes(':runReport')) { enter(); await new Promise<void>(r => { release = r; }); } return original(url, init); });
  const pending = service.sync(productId); await started; connection.disconnect(productId, accountId); release(); await pending;
  expect(service.snapshot(productId)).toBeUndefined(); expect(service.states()[0]!.status).toBe('attention');
});
