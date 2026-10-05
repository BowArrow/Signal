import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { ConnectionService } from '../../src/core/connections/service.js';
import { ProspectService } from '../../src/core/sales/prospects.js';
import { SalesService } from '../../src/core/sales/service.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { RevenueService } from '../../src/core/revenue/service.js';
import { settings, studioLeads } from '../../src/core/db/schema.js';
import type { ConnectedAccount } from '../../src/shared/connections.js';
import type { ProspectConfig } from '../../src/shared/prospects.js';

describe('automatic Mailchimp prospect ingestion', () => {
  let app: App; let service: ProspectService; let productId: string; let secondId: string; let clock: ReturnType<typeof fixedClock>;
  let transport: ReturnType<typeof vi.fn<typeof fetch>>; let pages: unknown[][]; let latest: unknown; let total: number; let config: ProspectConfig;
  const token = 'fixture-mailchimp-key-us21';
  const put = (key: string, value: unknown) => app.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
  const member = (email = 'buyer@example.test', overrides: Record<string, unknown> = {}) => ({ id: createHash('md5').update(email.toLowerCase()).digest('hex'), email_address: email, full_name: 'Interested buyer', list_id: 'audience1', status: 'subscribed', consents_to_one_to_one_messaging: true, timestamp_opt: new Date(clock.now() - 60000).toISOString(), last_changed: new Date(clock.now() - 1000).toISOString(), marketing_permissions: [], ...overrides });
  const leads = () => app.db.select().from(studioLeads).all();
  const run = () => put(`operations.policy.${productId}`, { ...app.operations!.state(productId), running: true });
  const check = () => service.assertContact(productId, 'buyer@example.test', new AbortController().signal);
  beforeEach(async () => {
    vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); clock = fixedClock(1789700000000); app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger });
    transport = vi.fn(async (input, init) => {
      const url = new URL(String(input)); expect(url.origin).toBe('https://us21.api.mailchimp.com'); expect(init?.method).toBe('GET'); expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('authorization')).toBe(`Basic ${Buffer.from(`signal:${token}`).toString('base64')}`);
      if (url.pathname === '/3.0/lists') return Response.json({ lists: [{ id: 'audience1', name: 'Lemonade signups' }], total_items: 1 });
      if (url.pathname === '/3.0/lists/audience1') return Response.json({ id: 'audience1', name: 'Lemonade signups' });
      if (url.pathname === '/3.0/lists/audience1/members') return Response.json({ members: pages[Number(url.searchParams.get('offset')) / 100] ?? [], total_items: total });
      if (url.pathname.startsWith('/3.0/lists/audience1/members/')) return latest === null ? new Response(null, { status: 404 }) : Response.json(latest);
      throw new Error('Unexpected request');
    });
    app.connections = new ConnectionService(app, { available: () => true, get: () => JSON.stringify({ accessToken: token }), set: () => {}, delete: () => {} }, undefined, transport);
    [productId, secondId] = app.connections.view().products.map(p => p.id) as [string, string];
    const account: ConnectedAccount = { id: 'mailchimp', provider: 'mailchimp', productId, label: 'Marketing audience', identity: 'Lemonade', username: '', site: '', status: 'verified', detail: '', checkedAt: clock.now(), createdAt: clock.now(), expiresAt: null, refreshable: false, grantedScopes: [] }; put('connections.account.mailchimp', account);
    app.sales = new SalesService(app); app.operations = new OperationsService(app); app.revenue = new RevenueService(app); service = new ProspectService(app); app.prospects = service;
    config = { accountId: 'mailchimp', listId: 'audience1', enabled: true, businessConfirmed: true, marketingPermissionId: '' };
    pages = [[member()]]; latest = member(); total = 1; await service.configure(productId, config); transport.mockClear();
  });
  afterEach(async () => { await service.stop(); vi.restoreAllMocks(); vi.unstubAllEnvs(); app.close(); __setConfigForTests(null); });
  it('loads audiences through the verified product-scoped connection', async () => {
    expect(await service.catalog(productId, 'mailchimp')).toEqual([{ id: 'audience1', name: 'Lemonade signups' }]);
    await expect(service.catalog(secondId, 'mailchimp')).rejects.toThrow('business');
  });
  it('runs only when authorized and imports one opted-in lead without duplicates', async () => {
    await service.tick(); expect(transport).not.toHaveBeenCalled(); run(); await service.tick();
    expect(leads()).toHaveLength(1); expect(leads()[0]!.value).toMatchObject({ permission: 'opted-in', stage: 'discovered', source: 'Mailchimp: Lemonade signups (audience1)' });
    expect(service.source(productId)).toMatchObject({ status: 'current', added: 1, scanned: 1 });
    await service.sync(productId); expect(leads()).toHaveLength(1); expect(service.source(productId)?.added).toBe(0);
    expect(JSON.stringify(service.view())).not.toContain(token);
  });
  it.each([
    { status: 'pending' }, { status: 'transactional' }, { status: 'archived' }, { consents_to_one_to_one_messaging: false },
    { marketing_permissions: [{ marketing_permission_id: 'email', enabled: true }] },
  ])('does not infer permission from an ineligible subscriber: %j', async overrides => {
    pages = [[member(undefined, overrides)]]; await service.sync(productId); expect(leads()).toHaveLength(0);
  });
  it('admits a pending subscriber once explicit eligible consent appears', async () => {
    pages = [[member(undefined, { status: 'pending' })]]; await service.sync(productId); expect(leads()).toHaveLength(0);
    pages = [[member()]]; await service.sync(productId); expect(leads()).toHaveLength(1);
  });
  it('requires exactly the selected marketing permission to be enabled', async () => {
    await service.configure(productId, { ...config, marketingPermissionId: 'email' });
    pages = [[member(undefined, { marketing_permissions: [{ marketing_permission_id: 'sms', enabled: true }, { marketing_permission_id: 'email', enabled: false }] })]];
    await service.sync(productId); expect(leads()).toHaveLength(0);
    pages = [[member(undefined, { marketing_permissions: [{ marketing_permission_id: 'email', enabled: true }] })]];
    await service.sync(productId); expect(leads()).toHaveLength(1);
  });
  it('applies unsubscribes and never reverses existing suppression', async () => {
    await service.sync(productId); pages = [[member(undefined, { status: 'unsubscribed' })]]; await service.sync(productId);
    expect(leads()[0]!.value.permission).toBe('do-not-contact'); expect(app.sales!.isSuppressed(productId, 'buyer@example.test')).toBe(true);
    pages = [[member()]]; await service.sync(productId); expect(leads()[0]!.value.permission).toBe('do-not-contact');
    expect(app.sales!.isSuppressed(secondId, 'buyer@example.test')).toBe(false);
  });
  it('marks known Stripe purchasers as customers', async () => {
    vi.spyOn(app.revenue!, 'purchaseForContact').mockReturnValue({ captured: 5000 } as ReturnType<RevenueService['purchaseForContact']>);
    await service.sync(productId); expect(leads()[0]!.value.stage).toBe('customer');
  });
  it('preserves owner-managed stages, notes and permissions', async () => {
    await service.sync(productId); const lead = leads()[0]!; const value = { ...lead.value, stage: 'lost' as const, notes: 'Owner decision', permission: 'unknown' as const };
    app.db.update(studioLeads).set({ value }).where(eq(studioLeads.id, lead.id)).run(); await service.sync(productId);
    expect(leads()[0]!.value).toEqual(value);
  });
  it('resumes page checkpoints after restart and uses a bounded time window', async () => {
    pages = [Array.from({ length: 100 }, (_, i) => member(`person${i}@example.test`)), [member()]]; total = 101;
    await service.sync(productId); expect(service.source(productId)).toMatchObject({ status: 'partial', offset: 100, added: 100 });
    service = new ProspectService(app); app.prospects = service; clock.advance(5000); await service.sync(productId);
    expect(leads()).toHaveLength(101); expect(service.source(productId)).toMatchObject({ status: 'current', offset: 0, added: 101 });
    const requests = transport.mock.calls.map(([url]) => new URL(String(url))); expect(requests[1]!.searchParams.get('offset')).toBe('100'); expect(requests[1]!.searchParams.get('before_last_changed')).toBe(requests[0]!.searchParams.get('before_last_changed'));
  });
  it('uses overlapping incremental scans and a daily full refresh', async () => {
    await service.sync(productId); clock.advance(300000); await service.sync(productId);
    expect(new URL(String(transport.mock.calls[1]![0])).searchParams.get('since_last_changed')).toBe(new Date(clock.now() - 420000).toISOString());
    clock.advance(86400000); await service.sync(productId);
    expect(new URL(String(transport.mock.calls[2]![0])).searchParams.has('since_last_changed')).toBe(false);
  });
  it.each(['malformed', 'wrong-list', 'wrong-id', 'duplicate', 'oversized', 'future', 'echo-secret'])('rejects the whole page on %s', async kind => {
    if (kind === 'malformed') pages = [[member(), { status: 'subscribed' }]];
    if (kind === 'wrong-list') pages = [[member(undefined, { list_id: 'other' })]];
    if (kind === 'wrong-id') pages = [[member(undefined, { id: 'a'.repeat(32) })]];
    if (kind === 'duplicate') pages = [[member(), member()]];
    if (kind === 'oversized') total = 10001;
    if (kind === 'future') pages = [[member(undefined, { last_changed: new Date(clock.now() + 60000).toISOString() })]];
    if (kind === 'echo-secret') pages = [[member(undefined, { full_name: token })]];
    await service.sync(productId); expect(leads()).toHaveLength(0); expect(service.source(productId)?.status).toBe('attention'); expect(JSON.stringify(service.view())).not.toContain(token);
  });
  it('preserves a saved checkpoint after a provider error', async () => {
    pages = [Array.from({ length: 100 }, (_, i) => member(`person${i}@example.test`)), [member()]]; total = 101;
    await service.sync(productId); transport.mockResolvedValueOnce(new Response(null, { status: 429 })); await service.sync(productId);
    expect(service.source(productId)).toMatchObject({ status: 'attention', offset: 100 }); expect(leads()).toHaveLength(100);
    await service.sync(productId); expect(leads()).toHaveLength(101);
  });
  it('discards a response if Operations pauses while a request is in flight', async () => {
    run(); transport.mockImplementationOnce(async () => { app.operations!.pause(productId); return Response.json({ members: [member()], total_items: 1 }); });
    await service.sync(productId, true); expect(leads()).toHaveLength(0); expect(service.source(productId)?.status).toBe('attention');
  });
  it('blocks offline reads and cross-business source configuration', async () => {
    await expect(service.configure(secondId, config)).rejects.toThrow('business');
    app.env.SIGNAL_OFFLINE = '1';
    await expect(service.sync(productId)).rejects.toThrow('offline');
    await expect(service.catalog(productId, 'mailchimp')).rejects.toThrow('Offline');
    await service.tick(); expect(transport).not.toHaveBeenCalled(); expect(leads()).toHaveLength(0);
  });
  it('requires business confirmation when enabling ingestion', async () => {
    await expect(service.configure(productId, { ...config, businessConfirmed: false })).rejects.toThrow('Confirm');
  });
  it('allows unlinked contacts without remote requests', async () => { await check(); expect(transport).not.toHaveBeenCalled(); });
  it('rechecks linked consent and catches an unsubscribe after the scan', async () => {
    await service.sync(productId); await check(); latest = member(undefined, { status: 'unsubscribed' });
    await expect(check()).rejects.toThrow('consent'); expect(app.sales!.isSuppressed(productId, 'buyer@example.test')).toBe(true);
  });
  it.each([null, { status: 'archived' }, { status: 'pending' }, { consents_to_one_to_one_messaging: false }])('holds a linked contact with missing or changed consent: %j', async override => {
    await service.sync(productId); latest = override ? member(undefined, override) : null; await expect(check()).rejects.toThrow('consent');
  });
  it('holds linked contacts when the source or connection is unavailable', async () => {
    await service.sync(productId); await service.configure(productId, { ...config, enabled: false }); await expect(check()).rejects.toThrow('disabled');
    await service.configure(productId, config); app.db.delete(settings).where(eq(settings.key, 'connections.account.mailchimp')).run(); await expect(check()).rejects.toThrow('business');
  });
});
