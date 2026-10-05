import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from '../../src/core/app.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { settings, studioLeads } from '../../src/core/db/schema.js';
import { ConnectionService } from '../../src/core/connections/service.js';
import { SalesService } from '../../src/core/sales/service.js';
import { ProspectService } from '../../src/core/sales/prospects.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { RevenueService } from '../../src/core/revenue/service.js';
import type { ConnectedAccount } from '../../src/shared/connections.js';
import type { ProspectConfig } from '../../src/shared/prospects.js';
import { WebsiteProspectReader } from '../../src/core/sales/website-prospects.js';

const token = 'synthetic-website-credential';
const hash = (email: string) => createHash('sha256').update(email).digest('hex');
describe('website requests into the sales pipeline', () => {
  let app: App, service: ProspectService, productId: string, otherId: string, clock: ReturnType<typeof fixedClock>;
  let transport: ReturnType<typeof vi.fn<typeof fetch>>, rows: ReturnType<typeof record>[], latest: ReturnType<typeof record> | null;
  let config: ProspectConfig; let badPage: boolean;
  const record = (seq = 1, email = 'buyer@example.test') => ({ id: hash(email), email, name: 'Interested buyer', goal: 'Find a specific document in a folder', campaign: 'visitor-campaign', status: 'subscribed', verified: true, consentVersion: 'website-help-2026-09-17', consentText: 'Email me product guidance and promotional follow-ups from Lemonade, including personal messages from its AI assistant. I can opt out at any time by replying stop or returning to this page.', source: 'https://siplemona.de/get-started', optedAt: new Date(clock.now() - 1000).toISOString(), changedAt: new Date(clock.now()).toISOString(), seq });
  const put = (key: string, value: unknown) => app.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
  const leads = () => app.db.select().from(studioLeads).all();
  const sync = () => service.sync(productId, false, 'signal-blog');
  const check = () => service.assertContact(productId, 'buyer@example.test', new AbortController().signal);
  beforeEach(async () => {
    vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); clock = fixedClock(1789700000000); app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger });
    rows = [record()]; latest = rows[0]!; badPage = false;
    transport = vi.fn(async (input, init) => {
      const u = new URL(String(input)); expect(init?.method).toBe('GET'); expect(init?.redirect).toBe('error');
      expect(u.origin).toBe('https://siplemona.de'); expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + token);
      if (u.pathname.endsWith('/meta')) return Response.json({ product: 'lemonade', id: 'website', name: 'Lemonade website requests', signupUrl: 'https://siplemona.de/get-started', consentVersion: 'website-help-2026-09-17' });
      if (u.pathname.endsWith('/changes')) {
        const after = Number(u.searchParams.get('after')), head = Number(u.searchParams.get('head') ?? rows.at(-1)?.seq ?? 0);
        const records = rows.filter(r => r.seq > after && r.seq <= head).slice(0, 100), cursor = records.at(-1)?.seq ?? after;
        return Response.json({ product: badPage ? 'cinegen' : 'lemonade', records, cursor, head, hasMore: cursor < head });
      }
      if (u.pathname.endsWith('/contacts/' + hash('buyer@example.test'))) return latest ? Response.json({ product: 'lemonade', contact: latest }) : new Response(null, { status: 404 });
      throw new Error('Unexpected request');
    });
    app.connections = new ConnectionService(app, { available: () => true, get: () => JSON.stringify({ accessToken: token }), set: () => {}, delete: () => {} }, undefined, transport);
    [productId, otherId] = app.connections.view().products.map(p => p.id) as [string, string];
    const account: ConnectedAccount = { id: 'website', productId, provider: 'signal-blog', label: 'Lemonade website', site: 'https://siplemona.de', identity: 'Lemonade', username: '', status: 'verified', detail: '', createdAt: clock.now(), checkedAt: clock.now(), expiresAt: null, refreshable: false, grantedScopes: [] }; put('connections.account.website', account);
    app.sales = new SalesService(app); app.operations = new OperationsService(app); app.revenue = new RevenueService(app); service = new ProspectService(app); app.prospects = service;
    config = { provider: 'signal-blog', accountId: 'website', listId: 'website', marketingPermissionId: '', businessConfirmed: true, enabled: true };
    await service.configure(productId, config); transport.mockClear();
  });
  afterEach(async () => { await service.stop(); app.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); __setConfigForTests(null); });
  it('runs on authorization and imports a verified opt-in with its task without asserting campaign attribution', async () => {
    await service.tick(); expect(transport).not.toHaveBeenCalled(); app.operations!.run(productId); await service.tick();
    expect(leads()).toHaveLength(1); expect(leads()[0]!.value).toMatchObject({ permission: 'opted-in', stage: 'discovered', campaignId: '' });
    expect(leads()[0]!.value.notes).toContain('specific document'); expect(service.source(productId, 'signal-blog')?.websiteCursor).toBe(1);
    await sync(); expect(leads()).toHaveLength(1); expect(JSON.stringify(service.view())).not.toContain(token);
  });
  it('continues a fixed snapshot across restart, then reads later changes', async () => {
    rows = Array.from({ length: 101 }, (_, i) => record(i + 1, `buyer${i}@example.test`)); await sync();
    expect(leads()).toHaveLength(100); expect(service.source(productId, 'signal-blog')).toMatchObject({ websiteCursor: 100, websiteHead: 101, status: 'partial' });
    rows.push(record(102, 'later@example.test')); service = new ProspectService(app); app.prospects = service; await sync(); expect(leads()).toHaveLength(101);
    await sync(); expect(leads()).toHaveLength(102); expect(service.source(productId, 'signal-blog')).toMatchObject({ websiteCursor: 102, websiteHead: null, status: 'current' });
  });
  it.each(['unverified', 'old-consent', 'changed-consent', 'bad-page', 'history-gap', 'wrong-contact'])('does not import an invalid record or page: %s', async reason => {
    if (reason === 'unverified') rows[0]!.verified = false;
    if (reason === 'old-consent') rows[0]!.consentVersion = 'old';
    if (reason === 'changed-consent') rows[0]!.consentText = 'I only want a transactional receipt for an order.';
    if (reason === 'bad-page') badPage = true;
    if (reason === 'history-gap') rows[0]!.seq = 2;
    if (reason === 'wrong-contact') rows[0]!.email = 'other@example.test';
    await sync(); expect(leads()).toHaveLength(0);
  });
  it('applies opt-out changes and never automatically clears a suppression on re-enrollment', async () => {
    await sync(); rows.push({ ...record(2), status: 'unsubscribed' }); await sync(); expect(app.sales!.view().suppressions).toHaveLength(1);
    rows.push(record(3)); latest = rows[2]!; await sync(); await expect(check()).rejects.toThrow(); expect(leads()).toHaveLength(1);
  });
  it.each(['opt-out', 'missing', 'unverified', 'disable'])('holds linked delivery on the current source state: %s', async reason => {
    await sync(); await check();
    if (reason === 'opt-out') latest = { ...latest!, status: 'unsubscribed' };
    if (reason === 'missing') latest = null;
    if (reason === 'unverified') latest!.verified = false;
    if (reason === 'disable') await service.configure(productId, { ...config, enabled: false });
    await expect(check()).rejects.toThrow();
  });
  it('uses known purchases when importing', async () => {
    vi.spyOn(app.revenue!, 'purchaseForContact').mockReturnValue({} as NonNullable<ReturnType<RevenueService['purchaseForContact']>>); await sync(); expect(leads()[0]!.value.stage).toBe('customer');
  });
  it('supports a separate Mailchimp source and requires both linked permissions', async () => {
    await sync(); put(`prospects.source.${productId}`, { ...service.source(productId, 'signal-blog'), provider: 'mailchimp', accountId: 'mailchimp', listId: 'audience' });
    put('prospects.member.' + createHash('sha256').update(`${productId}:buyer@example.test`).digest('hex'), { productId, email: 'buyer@example.test', accountId: 'mailchimp', listId: 'audience', status: 'subscribed', observedAt: clock.now() });
    vi.spyOn(app.connections!, 'mailchimpReader').mockResolvedValue({ contact: async () => null } as unknown as Awaited<ReturnType<ConnectionService['mailchimpReader']>>);
    expect(service.sources()).toHaveLength(2); await expect(check()).rejects.toThrow('consent');
    await service.configure(productId, { ...config, enabled: false }); expect(service.source(productId)?.enabled).toBe(true);
  });
  it('rejects a different business connection', async () => { await expect(service.configure(otherId, config)).rejects.toThrow('business'); });
  it('does not save a late page after Pause', async () => {
    const original = transport.getMockImplementation()!; transport.mockImplementation(async (...args) => { const result = await original(...args); if (String(args[0]).includes('/changes')) service.pause(productId); return result; });
    await sync(); expect(leads()).toHaveLength(0); expect(service.source(productId, 'signal-blog')?.websiteCursor).toBe(0);
  });
  it('rejects credential reflection and arbitrary origins', async () => {
    expect(() => new WebsiteProspectReader('https://other.example', 'lemonade', token, transport, new AbortController().signal, () => {})).toThrow();
    transport.mockResolvedValue(Response.json({ product: 'lemonade', secret: token })); await expect(check()).resolves.toBeUndefined();
    await sync(); expect(leads()).toHaveLength(0); expect(service.source(productId, 'signal-blog')?.status).toBe('attention');
  });
});
