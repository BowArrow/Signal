import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { ConnectionService, type CredentialVault } from '../../src/core/connections/service.js';
import { RevenueService } from '../../src/core/revenue/service.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { VideoPublishingService } from '../../src/core/video/publishing.js';
import { studioAction, studioView } from '../../src/core/studio/store.js';
import { marketingCash, studioLeads, settings } from '../../src/core/db/schema.js';
import { purchaseContactHash } from '../../src/core/revenue/identity.js';
import { OutreachService } from '../../src/core/sales/outreach-service.js';

class Vault implements CredentialVault { data = new Map<string, string>(); available() { return true; } get(key: string) { return this.data.get(key); } set(key: string, value: string) { this.data.set(key, value); } delete(key: string) { this.data.delete(key); } }
let app: App; let service: RevenueService; let connection: ConnectionService; let vault: Vault;
let clock: ReturnType<typeof fixedClock>; let send: ReturnType<typeof vi.fn<typeof fetch>>;
let productId: string; let accountId: string;
let charges: Record<string, unknown>[]; let refunded: number; let campaign: string; let lineProducts: string[];
const list = (data: unknown[], more = false) => Response.json({ data, has_more: more });
const charge = (id = 'ch_payment1', extra: Record<string, unknown> = {}) => ({ id, created: 1789600000, livemode: false, currency: 'usd', paid: true, captured: true, status: 'succeeded', amount_captured: 4900, amount_refunded: 0, disputed: false, invoice: null, payment_intent: 'pi_payment1', metadata: {}, billing_details: { email: 'private-buyer@example.com', name: 'Private Buyer' }, ...extra });
beforeEach(async () => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); clock = fixedClock(1789610000000); app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger });
  vault = new Vault(); charges = [charge()]; refunded = 0; campaign = ''; lineProducts = ['prod_lemonade'];
  send = vi.fn(async (input, init) => {
    const url = new URL(String(input)); expect(init?.method ?? 'GET').toBe('GET'); expect(init?.redirect).toBe('error');
    if (url.pathname === '/v1/balance') return Response.json({ livemode: false, available: [] });
    expect(new Headers(init?.headers).get('stripe-version')).toBe('2024-06-20');
    if (url.pathname === '/v1/products') return list([{ id: 'prod_lemonade', name: 'Lemonade licence' }, { id: 'prod_cinegen', name: 'CineGen plan' }]);
    if (url.pathname === '/v1/charges') return list(charges.map(c => ({ ...c, amount_refunded: refunded })));
    if (url.pathname === '/v1/checkout/sessions') return list([{ id: 'cs_test_session1', payment_intent: 'pi_payment1', metadata: { ...(campaign ? { utm_campaign: campaign } : {}) } }]);
    if (url.pathname.endsWith('/line_items') || url.pathname.endsWith('/lines')) return list(lineProducts.map((p, i) => ({ id: `li_tmp_${i}`, price: { product: p } })));
    if (url.pathname === '/v1/invoices/in_invoice1') return Response.json({ id: 'in_invoice1', metadata: {}, subscription_details: { metadata: campaign ? { signal_campaign: campaign } : {} } });
    throw new Error(`Unexpected test endpoint ${url.pathname}`);
  });
  connection = new ConnectionService(app, vault, undefined, send); app.connections = connection;
  productId = connection.view().products[0]!.id;
  await connection.connect({ productId, provider: 'stripe', label: 'Stripe payments', credential: 'rk_test_privatekey' }); accountId = connection.accounts()[0]!.id;
  service = new RevenueService(app); app.revenue = service;
});
afterEach(async () => { await service.stop(); app.close(); vi.unstubAllEnvs(); __setConfigForTests(null); });
const configure = (live = false) => service.configure(productId, { accountId, stripeProductIds: ['prod_lemonade'], since: clock.now() - 86400000, live });
it('matches Stripe metadata to confirmed business-owned video deliveries without inferring attribution', async () => {
  app.videoPublishing = new VideoPublishingService(app, vault, () => { throw new Error('No video file reads during revenue sync.'); });
  const other = connection.view().products[1]!.id;
  for (const [id, business, receipt] of [['own-video', productId, { id: 'confirmed' }], ['other-video', other, { id: 'confirmed' }], ['unconfirmed-video', productId, null]] as const) app.db.insert(settings).values({ key: 'video.youtube.job.' + id, value: { id, productId: business, receipt } }).run();
  configure(); campaign = 'own-video'; await service.sync(productId); expect(service.payments(productId)[0]).toMatchObject({ attribution: 'matched', campaignId: 'own-video' });
  campaign = 'other-video'; await service.sync(productId); expect(service.payments(productId)[0]?.attribution).toBe('unknown');
  campaign = 'unconfirmed-video'; await service.sync(productId); expect(service.payments(productId)[0]?.attribution).toBe('unknown');
});
it('syncs captured payments without exposing raw billing details or making cash available', async () => {
  configure(); await service.sync(productId); expect(service.totals(productId)[0]).toMatchObject({ payments: 1, captured: 4900, refunded: 0, live: false });
  const output = JSON.stringify(service.view()); expect(output).not.toContain('private-buyer'); expect(output).not.toContain('Private Buyer'); expect(output).not.toContain('rk_test_privatekey');
  expect(app.db.select().from(marketingCash).all()).toHaveLength(0); expect(service.states()[0]!.status).toBe('current');
});

function addBuyer(id: string, business = productId, contact = 'Private-Buyer@example.com') {
  app.db.insert(studioLeads).values({ id, productId: business, value: { name: 'Existing lead', contact, stage: 'trial', permission: 'do-not-contact', source: 'Owner import', notes: '', followUpAt: clock.now() + 86400000, campaignId: '' }, createdAt: clock.now() }).run();
}
it('matches a live purchase to exact business contacts without changing permission or campaign attribution', async () => {
  addBuyer('buyer'); addBuyer('other-business', connection.view().products[1]!.id); addBuyer('alias', productId, 'private-buyer+tag@example.com');
  configure(true); charges = [charge('ch_live', { livemode: true })]; await service.sync(productId);
  const leads = app.db.select().from(studioLeads).all();
  expect(leads.find(l => l.id === 'buyer')!.value).toMatchObject({ stage: 'customer', permission: 'do-not-contact', followUpAt: null, campaignId: '' });
  expect(leads.filter(l => l.id !== 'buyer').map(l => l.value.stage)).toEqual(['trial', 'trial']);
  expect(service.purchaseForContact(productId, 'Private Buyer <private-buyer@example.com>')?.id).toBe('ch_live');
  expect(service.view().payments[0]).toMatchObject({ matchedLeadCount: 1, attribution: 'none' });
  expect(JSON.stringify(service.view())).not.toContain('contactHash');
  expect(JSON.stringify(service.context(productId))).not.toContain('private-buyer');
  expect(purchaseContactHash('other-account', 'private-buyer@example.com')).not.toBe(service.payments(productId)[0]!.contactHash);
});
it('never changes leads from test purchases and matches leads created after a completed live scan', async () => {
  configure(); addBuyer('buyer'); await service.sync(productId);
  expect(app.db.select().from(studioLeads).get()!.value.stage).toBe('trial'); expect(service.purchaseForContact(productId, 'private-buyer@example.com')).toBeUndefined();
  configure(true); charges = [charge('ch_live', { livemode: true, billing_details: { email: 'late@example.com' } })]; await service.sync(productId);
  addBuyer('late', productId, 'late@example.com'); await service.tick();
  expect(app.db.select().from(studioLeads).all().find(l => l.id === 'late')!.value.stage).toBe('customer');
});
it('uses checkout and invoice emails but refuses conflicting, malformed and receipt-only identities', async () => {
  configure(true); addBuyer('buyer'); const original = send.getMockImplementation()!;
  charges = [charge('ch_live', { livemode: true, billing_details: { email: null } })];
  send.mockImplementation(async (url, init) => new URL(String(url)).pathname === '/v1/checkout/sessions' ? list([{ id: 'cs_test_session1', payment_intent: 'pi_payment1', metadata: {}, customer_details: { email: 'private-buyer@example.com' } }]) : original(url, init));
  await service.sync(productId); expect(service.view().payments[0]!.matchedLeadCount).toBe(1);
  charges = [charge('ch_live', { livemode: true, billing_details: { email: 'other@example.com' } })];
  await service.sync(productId); expect(service.payments(productId)[0]).toMatchObject({ contactHash: null, contactMatch: 'conflicting' });
  charges = [charge('ch_live', { livemode: true, billing_details: { email: 'invalid' } })];
  await service.sync(productId); expect(service.payments(productId)[0]!.contactHash).toBeNull(); expect(service.states()[0]!.status).toBe('current');
  send.mockImplementation(original); charges = [charge('ch_live', { livemode: true, billing_details: null, receipt_email: 'private-buyer@example.com' })];
  await service.sync(productId); expect(service.payments(productId)[0]!.contactMatch).toBe('missing');
  charges = [charge('ch_invoice', { livemode: true, invoice: 'in_invoice1', billing_details: null })];
  send.mockImplementation(async (url, init) => new URL(String(url)).pathname === '/v1/invoices/in_invoice1' ? Response.json({ id: 'in_invoice1', customer_email: 'private-buyer@example.com', metadata: {} }) : original(url, init));
  await service.sync(productId); expect(service.view().payments[0]!.matchedLeadCount).toBe(1);
});
it('does not convert leads from a partial or failed scan and preserves purchase history after refunds', async () => {
  configure(true); addBuyer('buyer'); const original = send.getMockImplementation()!; let fail = true;
  send.mockImplementation(async (url, init) => { const u = new URL(String(url)); if (u.pathname !== '/v1/charges') return original(url, init); return !u.searchParams.has('starting_after') ? list([charge('ch_live', { livemode: true })], true) : fail ? new Response('unavailable', { status: 503 }) : list([]); });
  await service.sync(productId); await service.sync(productId);
  expect(app.db.select().from(studioLeads).get()!.value.stage).toBe('trial'); expect(service.purchaseForContact(productId, 'private-buyer@example.com')).toBeUndefined();
  fail = false; await service.sync(productId); expect(app.db.select().from(studioLeads).get()!.value.stage).toBe('customer');
  send.mockImplementation(original); charges = [charge('ch_live', { livemode: true, disputed: true })]; refunded = 4900; await service.sync(productId);
  expect(service.purchaseForContact(productId, 'private-buyer@example.com')).toMatchObject({ refunded: 4900, disputed: true });
  expect(app.db.select().from(studioLeads).get()!.value).toMatchObject({ stage: 'customer', followUpAt: null });
});
it('updates partial and full refunds idempotently and preserves dispute flags', async () => {
  configure(); await service.sync(productId); refunded = 1200; charges = [charge('ch_payment1', { disputed: true })];
  clock.advance(1000); await service.sync(productId); await service.sync(productId);
  expect(service.totals(productId)[0]).toMatchObject({ payments: 1, captured: 4900, refunded: 1200, disputedPayments: 1 });
  refunded = 4900; await service.sync(productId); expect(service.totals(productId)[0]!.refunded).toBe(4900);
});
it('excludes failed, uncaptured, zero and mixed-business payments instead of assigning account-wide totals', async () => {
  configure(); charges = [charge('ch_failed', { status: 'failed', paid: false }), charge('ch_hold', { captured: false }), charge('ch_free', { amount_captured: 0 })];
  await service.sync(productId); expect(service.payments(productId)).toHaveLength(0); expect(service.states()[0]!.excluded).toBe(3);
  charges = [charge()]; lineProducts = ['prod_lemonade', 'prod_cinegen']; await service.sync(productId); expect(service.payments(productId)).toHaveLength(0);
});
it('keeps currencies separate and rejects a Stripe mode mismatch without replacing a valid snapshot', async () => {
  configure(); charges = [charge(), charge('ch_jpy', { currency: 'jpy', amount_captured: 600 })]; await service.sync(productId);
  expect(service.totals(productId).map(g => [g.currency, g.captured])).toEqual([['usd', 4900], ['jpy', 600]]);
  charges = [charge('ch_live', { livemode: true })]; await service.sync(productId);
  expect(service.states()[0]!.status).toBe('attention'); expect(service.totals(productId)).toHaveLength(2);
});
it('matches only real campaigns in this business and does not infer missing attribution', async () => {
  configure(); studioAction(app, { type: 'campaign', productId, value: { title: 'Document answers', channel: 'content', objective: 'Find trial users', audience: 'People comparing reports', offer: 'Try the app', formats: ['article'] } });
  campaign = studioView(app).campaigns[0]!.id; await service.sync(productId);
  expect(service.payments(productId)[0]).toMatchObject({ campaignId: campaign, attribution: 'matched' });
  const other = connection.view().products[1]!.id; studioAction(app, { type: 'campaign', productId: other, value: { title: 'Video workflows', channel: 'content', objective: 'Find trial users', audience: 'Video creators', offer: 'Try the app', formats: ['article'] } });
  campaign = studioView(app).campaigns.find(c => c.productId === other)!.id; await service.sync(productId);
  expect(service.payments(productId)[0]).toMatchObject({ campaignId: null, attribution: 'unknown' });
  campaign = ''; await service.sync(productId); expect(service.payments(productId)[0]!.attribution).toBe('none');
  charges = [charge('ch_conflict', { metadata: { signal_campaign: 'first_campaign', utm_campaign: 'different_campaign' } })];
  await service.sync(productId); expect(service.payments(productId)[0]!.attribution).toBe('unknown');
});
it('credits explicit outreach metadata only after a sent copy is confirmed in this business', async () => {
  configure(); app.outreach = new OutreachService(app); campaign = 'a'.repeat(64);
  const value = { id: campaign, productId, status: 'queued' };
  app.db.insert(settings).values({ key: `sales.outreach.${campaign}`, value }).run(); await service.sync(productId); expect(service.payments(productId)[0]!.attribution).toBe('unknown');
  app.db.update(settings).set({ value: { ...value, status: 'sent' } }).where(eq(settings.key, `sales.outreach.${campaign}`)).run();
  await service.sync(productId); expect(service.payments(productId)[0]).toMatchObject({ attribution: 'matched', campaignId: campaign });
  app.db.update(settings).set({ value: { ...value, status: 'sent', productId: connection.view().products[1]!.id } }).where(eq(settings.key, `sales.outreach.${campaign}`)).run();
  await service.sync(productId); expect(service.payments(productId)[0]!.attribution).toBe('unknown');
});
it('reads subscription invoice line scope and subscription attribution metadata', async () => {
  configure();
  studioAction(app, { type: 'campaign', productId, value: { title: 'Document answers', channel: 'content', objective: 'Find trial users', audience: 'People comparing reports', offer: 'Try the app', formats: ['article'] } });
  campaign = studioView(app).campaigns[0]!.id;
  // Subscription renewals do not have a one-time Checkout Session to query.
  charges = [charge('ch_subscription', { invoice: 'in_invoice1', metadata: {} })]; await service.sync(productId);
  expect(service.totals(productId)[0]!.payments).toBe(1); expect(send.mock.calls.some(([url]) => String(url).includes('/invoices/in_invoice1/lines'))).toBe(true);
  expect(service.payments(productId)[0]).toMatchObject({ campaignId: campaign, attribution: 'matched' });
  expect(send.mock.calls.some(([url]) => new URL(String(url)).pathname === '/v1/checkout/sessions')).toBe(false);
  const original = send.getMockImplementation()!;
  send.mockImplementation(async (url, init) => new URL(String(url)).pathname === '/v1/invoices/in_invoice1'
    ? Response.json({ id: 'in_invoice1', metadata: { signal_campaign: 'different_campaign' }, subscription_details: { metadata: { signal_campaign: campaign } } }) : original(url, init));
  await service.sync(productId);
  expect(service.payments(productId)[0]).toMatchObject({ campaignId: null, attribution: 'unknown' });
  expect(service.totals(productId)[0]!.captured).toBe(4900);
});
it('keeps the previous snapshot visible while pages are staged, then swaps atomically and resumes after restart', async () => {
  configure(); await service.sync(productId); const original = send.getMockImplementation()!;
  send.mockImplementation(async (url, init) => new URL(String(url)).pathname === '/v1/charges' ? (new URL(String(url)).searchParams.has('starting_after') ? list([charge('ch_second')]) : list([charge('ch_first')], true)) : original(url, init));
  clock.advance(1000); await service.sync(productId); expect(service.payments(productId).map(p => p.id)).toEqual(['ch_payment1']); expect(service.states()[0]!.status).toBe('partial');
  service = new RevenueService(app); app.revenue = service; await service.sync(productId);
  expect(service.payments(productId).map(p => p.id)).toEqual(['ch_first', 'ch_second']); expect(service.totals(productId)[0]!.captured).toBe(9800);
});
it('does not replace a good snapshot when a later page fails and deduplicates overlapping pages on retry', async () => {
  configure(); await service.sync(productId); const original = send.getMockImplementation()!; let fail = true;
  send.mockImplementation(async (url, init) => { const u = new URL(String(url)); if (u.pathname !== '/v1/charges') return original(url, init); if (!u.searchParams.has('starting_after')) return list([charge('ch_new')], true); return fail ? new Response('rk_test_privatekey', { status: 403 }) : list([charge('ch_new'), charge('ch_last')]); });
  await service.sync(productId); await service.sync(productId); expect(service.payments(productId)[0]!.id).toBe('ch_payment1'); expect(service.states()[0]!.status).toBe('attention');
  expect(JSON.stringify(service.view())).not.toContain('rk_test_privatekey'); fail = false; await service.sync(productId); expect(service.payments(productId)).toHaveLength(2);
});
it('rejects cross-business account access and duplicate product assignment', async () => {
  configure(); const other = connection.view().products[1]!.id;
  expect(() => service.configure(other, { accountId, stripeProductIds: ['prod_lemonade'], since: 0, live: false })).toThrow('business');
  await expect(service.catalog(other, accountId)).rejects.toThrow('business');
  await connection.connect({ productId: other, provider: 'stripe', label: 'Other business', credential: 'rk_test_other' }); const otherId = connection.accounts().find(a => a.productId === other)!.id;
  expect(() => service.configure(other, { accountId: otherId, stripeProductIds: ['prod_lemonade'], since: 0, live: false })).toThrow('already assigned');
});
it('discards a late scan when configuration changes or the account is disconnected', async () => {
  configure(); const original = send.getMockImplementation()!; let release!: () => void; let enter!: () => void; const started = new Promise<void>(resolve => { enter = resolve; });
  send.mockImplementation(async (url, init) => { if (new URL(String(url)).pathname === '/v1/charges') { enter(); await new Promise<void>(resolve => { release = resolve; }); } return original(url, init); });
  const pending = service.sync(productId); await started; configure(); release(); await pending;
  expect(service.payments(productId)).toHaveLength(0); expect(service.states()[0]!.status).toBe('idle');
  connection.disconnect(productId, accountId); await service.sync(productId); expect(service.states()[0]!.status).toBe('attention');
});
it('allows one in-flight sync per business and only auto-syncs while its operation is running', async () => {
  configure(); await Promise.all([service.sync(productId), service.sync(productId)]);
  expect(send.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/v1/charges')).toHaveLength(1);
  app.operations = new OperationsService(app); clock.advance(1000000); await service.tick();
  expect(send.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/v1/charges')).toHaveLength(1);
});
it('loads the full product catalogue without exposing a reflected credential', async () => {
  const original = send.getMockImplementation()!;
  send.mockImplementation(async (url, init) => { const u = new URL(String(url)); if (u.pathname !== '/v1/products') return original(url, init); return u.searchParams.has('starting_after') ? list([{ id: 'prod_second', name: 'Other product' }]) : list([{ id: 'prod_first', name: 'rk_test_privatekey' }], true); });
  expect(await service.catalog(productId, accountId)).toEqual([{ id: 'prod_first', name: '[redacted]' }, { id: 'prod_second', name: 'Other product' }]);
});
it('loads and tracks owner-defined Stripe product IDs without requiring a prod_ prefix', async () => {
  const original = send.getMockImplementation()!;
  send.mockImplementation(async (url, init) => new URL(String(url)).pathname === '/v1/products' ? list([{ id: 'lemonade', name: 'Lemonade' }]) : original(url, init));
  expect(await service.catalog(productId, accountId)).toEqual([{ id: 'lemonade', name: 'Lemonade' }]);
  service.configure(productId, { accountId, stripeProductIds: ['lemonade'], since: 0, live: false });
  lineProducts = ['lemonade']; await service.sync(productId);
  expect(service.states()[0]!.status).toBe('current'); expect(service.totals(productId)[0]?.captured).toBe(4900);
});
it('does not confuse an owner-defined product named unscoped with a manual invoice item', async () => {
  service.configure(productId, { accountId, stripeProductIds: ['unscoped'], since: 0, live: false });
  charges = [charge('ch_invoice', { invoice: 'in_invoice1' })]; const original = send.getMockImplementation()!;
  send.mockImplementation(async (url, init) => String(url).includes('/lines?') ? list([{ id: 'il_manual', price: null }]) : original(url, init));
  await service.sync(productId); expect(service.states()[0]!.status).toBe('current'); expect(service.payments(productId)).toHaveLength(0);
});
it('auto-syncs a running operation on schedule and does not repeatedly poll a current snapshot', async () => {
  configure(); app.operations = new OperationsService(app);
  const state = app.operations.state(productId); vi.spyOn(app.operations, 'state').mockReturnValue({ ...state, running: true });
  await service.tick(); await service.tick();
  expect(send.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/v1/charges')).toHaveLength(1);
  clock.advance(900000); await service.tick(); expect(send.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/v1/charges')).toHaveLength(2);
});
it('excludes manual invoice items with no product and rejects mismatched invoice identities', async () => {
  configure(); charges = [charge('ch_invoice', { invoice: 'in_invoice1' })]; const original = send.getMockImplementation()!;
  send.mockImplementation(async (url, init) => String(url).includes('/lines?') ? list([{ id: 'il_manual', price: null }]) : original(url, init));
  await service.sync(productId); expect(service.states()[0]!.status).toBe('current'); expect(service.payments(productId)).toHaveLength(0);
  send.mockImplementation(async (url, init) => new URL(String(url)).pathname === '/v1/invoices/in_invoice1' ? Response.json({ id: 'in_other', metadata: {} }) : original(url, init));
  await service.sync(productId); expect(service.states()[0]!.status).toBe('attention');
});
