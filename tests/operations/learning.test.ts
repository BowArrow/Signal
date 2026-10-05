import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock, DAY } from '../../src/core/lib/clock.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { ConnectionService } from '../../src/core/connections/service.js';
import { RevenueService } from '../../src/core/revenue/service.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { chooseOperation } from '../../src/core/operations/learning.js';
import { acquisitionChannel } from '../../src/core/operations/acquisition-channels.js';
import { growthTasks, settings } from '../../src/core/db/schema.js';
import type { Delivery, OperationState } from '../../src/shared/operations.js';
import type { RevenuePayment, RevenueState } from '../../src/shared/revenue.js';
import type { ConnectedAccount } from '../../src/shared/connections.js';
import { AnalyticsService } from '../../src/core/analytics/service.js';
import { analyticsDates } from '../../src/core/analytics/ga4.js';
import type { AnalyticsSnapshot, AnalyticsState } from '../../src/shared/analytics.js';

let app: App; let productId: string; let other: string; let policy: OperationState; let revenue: RevenueState;
let clock: ReturnType<typeof fixedClock>; let history: Delivery[]; let payments: RevenuePayment[];
function put(key: string, value: unknown) { app.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run(); }
function publication(id: string, accountId: string, days: number): Delivery {
  const createdAt = clock.now() - days * DAY;
  return { id, accountId, productId, title: `Buyer task ${id}`, description: `A concrete task explained by campaign ${id}.`, body: `Our app: try this useful task. https://siplemona.de/?utm_campaign=${id}`, evidence: ['https://siplemona.de/'], taskId: id, provider: 'signal-blog', revision: 1, fingerprint: id, recordKey: id, slug: id, author: 'Lemonade team', status: 'published', createdAt, updatedAt: createdAt, nextAttemptAt: createdAt, attempts: 1, leaseUntil: 0, leaseId: '', detail: 'Confirmed', receipt: { id, url: `https://siplemona.de/writing/${id}`, confirmedAt: createdAt } };
}
function payment(id: string, campaignId: string): RevenuePayment { return { id, campaignId, productId, accountId: 'stripe', live: true, currency: 'usd', captured: 4900, refunded: 0, disputed: false, createdAt: clock.now() - DAY, observedAt: clock.now(), attribution: 'matched' }; }
function choose(state = policy) { put(`revenue.config.${productId}`, revenue); put(`revenue.snapshot.${productId}`, payments); return chooseOperation(app, state, history); }
beforeEach(() => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); clock = fixedClock(1789700000000); app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger });
  app.connections = new ConnectionService(app, { available: () => true, get: () => undefined, set: () => {}, delete: () => {} });
  [productId, other] = app.connections.view().products.map(p => p.id) as [string, string];
  for (const id of ['website', 'social', 'stripe']) {
    const account: ConnectedAccount = { id, productId, provider: id === 'stripe' ? 'stripe' : id === 'social' ? 'bluesky' : 'signal-blog', label: id, identity: 'fixture', username: '', site: '', status: 'verified', detail: 'Synthetic account', checkedAt: clock.now(), createdAt: clock.now(), expiresAt: null, refreshable: false, grantedScopes: [] };
    put(`connections.account.${id}`, account);
  }
  app.operations = new OperationsService(app); app.operations.configure(productId, { objective: 'Help buyers solve useful tasks with verified product capabilities.', accountIds: ['website', 'social'], intervalHours: 24, dailyLimit: 1 });
  policy = app.operations.state(productId);
  app.revenue = new RevenueService(app); app.revenue.configure(productId, { accountId: 'stripe', stripeProductIds: ['prod_lemonade'], since: clock.now() - 90 * DAY, live: true });
  revenue = { ...app.revenue.states()[0]!, status: 'current', lastCompleteAt: clock.now() };
  history = [publication('web1', 'website', 20), publication('web2', 'website', 10), publication('social1', 'social', 22), publication('social2', 'social', 12)];
  payments = [payment('ch_first', 'web1'), payment('ch_second', 'web1'), payment('ch_third', 'web2')];
});
afterEach(() => { app.close(); vi.unstubAllEnvs(); __setConfigForTests(null); });

it('focuses on repeated payment associations and supplies the original topic without conflating currencies', () => {
  payments[1]!.currency = 'jpy'; payments[1]!.captured = 600;
  const decision = choose(); expect(decision).toMatchObject({ mode: 'build-on', accountId: 'website', cycle: 1, reference: { id: 'web1', retainedPayments: 2 } });
  expect(decision.accounts[0]).toMatchObject({ campaigns: 2, paidCampaigns: 2, retainedPayments: 3, paymentsPerCampaign: 1.5 });
  expect(JSON.stringify(decision)).not.toContain('4900');
});
it('uses purchase evidence for acquisition channel allocation without redirecting the new buyer conversation', () => {
  choose(); // Persist the same complete, live revenue evidence used by publishing.
  vi.spyOn(app.operations!, 'deliveries').mockReturnValue(history);
  const state = { ...policy, mode: 'acquisition' as const, testChannels: true };
  const finding = { id: 'new-request', kind: 'hn' as const, title: 'My document problem', excerpt: 'I need to compare my project documents.', url: 'https://news.ycombinator.com/item?id=1', query: 'hn:documents', requestLanguage: true, postedAt: clock.now(), observedAt: clock.now() };
  const selection = acquisitionChannel(app, state, [finding])!;
  expect(selection.route).toMatchObject({ account: { id: 'website' }, finding: { id: 'new-request' } });
  expect(selection.learning).toMatchObject({ mode: 'build-on', cycle: 1 });
  expect(selection.learning?.reference).toBeUndefined();
  const fourth = acquisitionChannel(app, { ...state, learning: { ...selection.learning!, cycle: 3 } }, [finding])!;
  expect(fourth.learning).toMatchObject({ mode: 'explore', cycle: 4, accountId: 'social' });
});
it('preserves an exploration cycle every fourth run, including after restart', () => {
  const first = choose(); expect(first.mode).toBe('build-on');
  const fourth = choose({ ...policy, learning: { ...first, cycle: 3 } }); expect(fourth).toMatchObject({ mode: 'explore', cycle: 4, accountId: 'social' });
  put(`operations.policy.${productId}`, { ...policy, learning: fourth });
  const restored = new OperationsService(app); expect(choose(restored.state(productId))).toMatchObject({ cycle: 5, mode: 'build-on' });
});
it.each(['partial', 'attention', 'syncing', 'idle'] as const)('does not focus from a %s scan', status => { revenue.status = status; expect(choose().mode).toBe('explore'); });
it('requires fresh, live, available Stripe data covering the comparison window', () => {
  revenue.lastCompleteAt = clock.now() - 37 * 3600000; expect(choose().mode).toBe('explore');
  revenue.lastCompleteAt = clock.now() + 1; expect(choose().mode).toBe('explore');
  revenue.lastCompleteAt = clock.now(); revenue.live = false; expect(choose().mode).toBe('explore');
  revenue.live = true; revenue.since = clock.now() - 20 * DAY; expect(choose().mode).toBe('explore');
  revenue.since = clock.now() - 90 * DAY; app.connections!.disconnect(productId, 'stripe'); expect(choose().mode).toBe('explore');
});
it('explores when observations are too young, sparse or untracked and does not count cross-business work', () => {
  history[3] = publication('social2', 'social', 2); expect(choose().mode).toBe('explore');
  history[3] = publication('social2', 'social', 12); history[3].body = 'Our app: https://siplemona.de/'; expect(choose().mode).toBe('explore');
  history[3] = { ...publication('social2', 'social', 12), productId: other }; expect(choose().mode).toBe('explore');
  history[3] = { ...publication('social2', 'social', 12), receipt: null }; expect(choose().mode).toBe('explore');
});
it.each(['test', 'refund', 'dispute', 'unknown', 'other-account', 'before-publication'] as const)('excludes %s payment evidence', kind => {
  for (const p of payments) {
    if (kind === 'test') p.live = false;
    if (kind === 'refund') p.refunded = p.captured;
    if (kind === 'dispute') p.disputed = true;
    if (kind === 'unknown') p.attribution = 'unknown';
    if (kind === 'other-account') p.accountId = 'another-stripe';
    if (kind === 'before-publication') p.createdAt = clock.now() - 29 * DAY;
  }
  expect(choose().mode).toBe('explore'); expect(choose().accounts[0]!.retainedPayments).toBe(0);
});
it('does not inflate repeated snapshots, duplicate payments, or a single paid campaign into a trend', () => {
  payments = [payment('ch_first', 'web1'), payment('ch_first', 'web1'), payment('ch_third', 'web2')];
  expect(choose().accounts[0]!.retainedPayments).toBe(2); expect(choose().mode).toBe('explore');
  payments = [payment('ch_first', 'web1'), payment('ch_second', 'web1'), payment('ch_third', 'web1')]; expect(choose().mode).toBe('explore');
});
it('keeps tied observations in rotation and drops focus when subsequent refunds remove support', () => {
  payments.push(payment('ch_fourth', 'social1'), payment('ch_fifth', 'social1'), payment('ch_sixth', 'social2')); expect(choose().mode).toBe('explore');
  payments = payments.slice(0, 3); const first = choose(); expect(first.mode).toBe('build-on');
  payments[0]!.refunded = payments[0]!.captured; expect(choose({ ...policy, learning: first }).mode).toBe('explore');
});
it('persists the decision in the scheduled cycle without increasing limits and does not schedule while paused', () => {
  choose(); for (const job of history) put(`operations.delivery.${job.id}`, job);
  app.operations!.schedule(); expect(app.operations!.state(productId).taskId).toBeNull();
  app.operations!.run(productId); app.operations!.schedule(); const state = app.operations!.state(productId);
  expect(state).toMatchObject({ targetAccountId: 'website', dailyLimit: 1, intervalHours: 24, learning: { mode: 'build-on', cycle: 1 } });
  app.operations!.schedule(); expect(app.operations!.state(productId).learning!.cycle).toBe(1);
  expect(app.db.select().from(growthTasks).where(eq(growthTasks.id, state.taskId!)).get()!.status).toBe('queued');
});

function traffic() {
  const source = app.connections!.accounts()[0]!;
  put('connections.account.ga4', { ...source, id: 'ga4', provider: 'ga4' });
  app.analytics = new AnalyticsService(app); app.analytics.configure(productId, { accountId: 'ga4', propertyId: '123' });
  const config: AnalyticsState = { ...app.analytics.states()[0]!, status: 'current', lastCompleteAt: clock.now() };
  const snapshot: AnalyticsSnapshot = { productId, accountId: 'ga4', propertyId: '123', hostname: 'siplemona.de', timeZone: 'America/Los_Angeles', currencyCode: 'USD', observedAt: clock.now(), ...analyticsDates(clock.now(), 'America/Los_Angeles'), limitations: [], rows: [
    { campaignId: 'web1', attribution: 'matched', sessions: 35, engagedSessions: 20, keyEvents: 1000, ecommercePurchases: 1000, purchaseRevenue: 999999 },
    { campaignId: 'web2', attribution: 'matched', sessions: 25, engagedSessions: 15, keyEvents: 0, ecommercePurchases: 0, purchaseRevenue: 0 },
  ] };
  const save = () => { put(`analytics.config.${productId}`, config); put(`analytics.snapshot.${productId}`, snapshot); };
  payments = []; save(); return { config, snapshot, save };
}
it('uses repeated visitor interest to propose a distinct experiment before any attributed sales', () => {
  traffic(); const decision = choose();
  expect(decision).toMatchObject({ mode: 'test-interest', accountId: 'website', traffic: { status: 'usable', reference: { id: 'web1', engagedSessions: 20, sessions: 35 } } });
  expect(decision.reference).toBeUndefined(); expect(decision.reason).toContain('not purchase evidence');
  expect(decision.traffic!.accounts[0]).toMatchObject({ campaigns: 2, observedCampaigns: 2, engagedCampaigns: 2, sessions: 60, engagedSessions: 35 });
  expect(decision.traffic!.accounts[1]).toMatchObject({ campaigns: 2, observedCampaigns: 0 });
  expect(decision.accounts.every(a => a.retainedPayments === 0)).toBe(true);
  expect(JSON.stringify(decision)).not.toContain('999999'); // Analytics revenue never becomes payment evidence.
  delete app.revenue; expect(chooseOperation(app, policy, history).mode).toBe('test-interest');
});
it('keeps exploration every fourth cycle and never overrides purchase evidence or a paid tie with traffic', () => {
  const t = traffic(); t.snapshot.rows = t.snapshot.rows.map((row, i) => ({ ...row, campaignId: `social${i + 1}` })); t.save();
  const first = choose(); expect(first).toMatchObject({ mode: 'test-interest', accountId: 'social' });
  expect(choose({ ...policy, learning: { ...first, cycle: 3 } })).toMatchObject({ mode: 'explore', cycle: 4 });
  payments = [payment('p1', 'web1'), payment('p2', 'web1'), payment('p3', 'web2')];
  const paid = choose(); expect(paid).toMatchObject({ mode: 'build-on', accountId: 'website' }); expect(paid.traffic!.reference).toBeUndefined();
  payments.push(payment('p4', 'social1'), payment('p5', 'social1'), payment('p6', 'social2')); expect(choose().mode).toBe('explore');
});
it.each(['limited', 'attention', 'syncing', 'idle'] as const)('does not select visitor interest from a %s analytics source', status => {
  const t = traffic(); t.config.status = status; t.save(); expect(choose().traffic!.status).toBe('unavailable'); expect(choose().mode).toBe('explore');
});
it.each(['stale', 'future', 'account', 'property', 'hostname', 'product', 'limited', 'timezone', 'dates', 'observation-mismatch'] as const)('does not allocate from %s analytics observations', kind => {
  const t = traffic();
  if (kind === 'stale') t.snapshot.observedAt = t.config.lastCompleteAt = clock.now() - 37 * 3600000;
  if (kind === 'future') t.snapshot.observedAt = t.config.lastCompleteAt = clock.now() + 1;
  if (kind === 'account') t.snapshot.accountId = 'other-ga4';
  if (kind === 'property') t.snapshot.propertyId = '456';
  if (kind === 'hostname') t.snapshot.hostname = 'cinegenaimedia.com';
  if (kind === 'product') t.snapshot.productId = other;
  if (kind === 'limited') t.snapshot.limitations = ['Sampled data'];
  if (kind === 'timezone') t.snapshot.timeZone = 'Not/AZone';
  if (kind === 'dates') t.snapshot.startDate = '2020-01-01';
  if (kind === 'observation-mismatch') t.config.lastCompleteAt = clock.now() - 1;
  t.save(); expect(choose()).toMatchObject({ mode: 'explore', traffic: { status: 'unavailable' } });
});
it('drops visitor selection after the GA4 account is disconnected or its token expires without renewal', () => {
  traffic(); const account = app.connections!.accounts().find(a => a.id === 'ga4')!;
  put('connections.account.ga4', { ...account, expiresAt: clock.now() - 1, refreshable: false }); expect(choose().mode).toBe('explore');
  put('connections.account.ga4', { ...account, expiresAt: clock.now() - 1, refreshable: true }); expect(choose().mode).toBe('test-interest');
  app.connections!.disconnect(productId, 'ga4'); expect(choose().mode).toBe('explore');
});
it.each(['unknown', 'none', 'other-business', 'young', 'old', 'unconfirmed', 'cancelled', 'wrong-link', 'sparse'] as const)('excludes %s campaign observations from visitor selection', kind => {
  const t = traffic();
  if (kind === 'unknown' || kind === 'none') t.snapshot.rows[1]!.attribution = kind;
  if (kind === 'other-business') history[1]!.productId = other;
  if (kind === 'young') history[1] = publication('web2', 'website', 6);
  if (kind === 'old') history[1] = publication('web2', 'website', 31);
  if (kind === 'unconfirmed') history[1]!.receipt = null;
  if (kind === 'cancelled') history[1]!.status = 'cancelled';
  if (kind === 'wrong-link') history[1]!.body = 'Our app: https://unrelated.test/?utm_campaign=web2';
  if (kind === 'sparse') t.snapshot.rows[1]!.engagedSessions = 9;
  t.save(); expect(choose().mode).toBe('explore');
});
it.each(['duplicate', 'negative', 'fraction', 'impossible-engagement', 'unsafe'] as const)('rejects %s session counts rather than focusing on corrupt observations', kind => {
  const t = traffic();
  if (kind === 'duplicate') t.snapshot.rows.push({ ...t.snapshot.rows[0]! });
  if (kind === 'negative') t.snapshot.rows[0]!.sessions = -1;
  if (kind === 'fraction') t.snapshot.rows[0]!.sessions = 1.5;
  if (kind === 'impossible-engagement') t.snapshot.rows[0]!.engagedSessions = 36;
  if (kind === 'unsafe') t.snapshot.rows[0]!.sessions = Number.MAX_SAFE_INTEGER;
  t.save(); expect(choose()).toMatchObject({ mode: 'explore', traffic: { status: 'unavailable' } });
});
it('keeps tied traffic experiments in rotation and responds to corrected observations without accumulating snapshots', () => {
  const t = traffic(); t.snapshot.rows.push(...t.snapshot.rows.map((row, i) => ({ ...row, campaignId: `social${i + 1}` }))); t.save();
  expect(choose().mode).toBe('explore'); t.snapshot.rows.splice(2); t.save();
  const first = choose(); expect(first.mode).toBe('test-interest'); expect(choose().traffic!.accounts[0]!.sessions).toBe(60);
  t.snapshot.rows[1]!.engagedSessions = 2; t.save(); expect(choose({ ...policy, learning: first }).mode).toBe('explore'); expect(first.traffic!.accounts[0]!.engagedSessions).toBe(35);
});
it('waits for each destination to have two mature tracked publications and uses maturity at observation time', () => {
  const t = traffic(); history[3] = publication('social2', 'social', 1); expect(choose().mode).toBe('explore');
  history[3] = publication('social2', 'social', 8); history[1] = publication('web2', 'website', 7);
  t.snapshot.observedAt = t.config.lastCompleteAt = clock.now() - 1000; t.save(); expect(choose().mode).toBe('explore');
});
it('persists visitor evidence with the scheduled cycle and restores it without changing budgets or delivery limits', () => {
  traffic(); choose(); for (const job of history) put(`operations.delivery.${job.id}`, job);
  app.operations!.run(productId); app.operations!.schedule(); const restored = new OperationsService(app).state(productId);
  expect(restored).toMatchObject({ targetAccountId: 'website', dailyLimit: 1, intervalHours: 24, learning: { mode: 'test-interest', traffic: { reference: { id: 'web1' }, accounts: [{ accountId: 'website', engagedSessions: 35 }, { accountId: 'social', observedCampaigns: 0 }] } } });
  app.operations!.schedule(); expect(app.operations!.state(productId).learning!.cycle).toBe(1);
});
