import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { products, settings, marketingCash, marketingCommitments } from '../../src/core/db/schema.js';
import { ConnectionService } from '../../src/core/connections/service.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { budget, initializeMarketing, reserveGrowthTest } from '../../src/core/marketing/store.js';
import { configureFunding, fundingView } from '../../src/core/revenue/funding.js';
import type { FundingPolicy } from '../../src/shared/funding.js';
import type { RevenuePayment, RevenueState } from '../../src/shared/revenue.js';

let app: App, productId: string, source: RevenueState, payment: RevenuePayment;
let clock: ReturnType<typeof fixedClock>;
const policy: FundingPolicy = { enabled: true, reinvestPct: 20, operatingReservePct: 40, reserveCents: 100, capCents: 10000, holdDays: 30 };
const put = (key: string, value: unknown) => app.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
const snapshot = (rows = [payment]) => put('revenue.snapshot.' + productId, rows);
beforeEach(() => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); clock = fixedClock(1790434800000);
  app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger }); initializeMarketing(app);
  productId = app.db.select().from(products).where(eq(products.key, 'lemonade')).get()!.id;
  app.connections = new ConnectionService(app, { available: () => false, get: () => undefined, set: () => {}, delete: () => {} }); app.operations = new OperationsService(app);
  put('connections.account.stripe', { id: 'stripe', productId, provider: 'stripe', status: 'verified', label: 'Fixture' });
  source = { productId, accountId: 'stripe', stripeProductIds: ['prod_fixture'], since: clock.now() - 90 * 86400000, live: true, revision: 1, cursor: '', scanStartedAt: null, lastAttemptAt: clock.now(), lastCompleteAt: clock.now(), scanned: 1, excluded: 0, status: 'current', detail: 'Fixture' }; put('revenue.config.' + productId, source);
  payment = { id: 'ch_1', productId, accountId: 'stripe', live: true, currency: 'usd', captured: 10000, refunded: 0, disputed: false, createdAt: clock.now() - 31 * 86400000, observedAt: clock.now(), campaignId: null, attribution: 'none', settlement: { id: 'txn_1', currency: 'usd', amount: 10000, fee: 300, net: 9700, tax: 700, availableAt: clock.now() - 29 * 86400000, status: 'available' } }; snapshot();
});
afterEach(() => { app.close(); vi.unstubAllEnvs(); __setConfigForTests(null); });

it('requires an explicit live-business rule and does not write cash credits', () => {
  expect(fundingView(app, productId).allocationCents).toBe(0);
  const value = configureFunding(app, productId, policy);
  expect(value).toMatchObject({ eligibleCents: 9000, allocationCents: 1060, eligiblePayments: 1, blockers: [] });
  expect(app.db.select().from(marketingCash).all()).toHaveLength(0);
  expect(budget(app, productId)).toMatchObject({ allocationCents: 1060, availableCents: 1060, tier: 'funded-tests' });
});
it('repeated snapshots and duplicate receipts do not mint more money', () => {
  configureFunding(app, productId, policy); snapshot([payment, payment]);
  for (let i = 0; i < 3; i++) expect(budget(app, productId).availableCents).toBe(1060);
  reserveGrowthTest(app, productId, 'first-test', 1000); expect(budget(app, productId).availableCents).toBe(60);
  expect(() => reserveGrowthTest(app, productId, 'second-test', 100)).toThrow('cash');
});
it('counts old spend, commitments and downward cash adjustments, but never manual surplus twice', () => {
  configureFunding(app, productId, policy);
  for (const [id, kind, amountCents] of [['old', 'settled_surplus', 999999], ['spent', 'spend', 100], ['cost', 'adjustment', 50]] as const) app.db.insert(marketingCash).values({ id, productId, kind, amountCents, reference: id, note: 'Fixture' }).run();
  reserveGrowthTest(app, productId, 'test', 200);
  expect(budget(app, productId)).toMatchObject({ allocationCents: 1010, spentCents: 100, committedCents: 200, availableCents: 710 });
});
it.each(['refund', 'dispute', 'test', 'currency', 'foreign-account', 'foreign-business'] as const)('excludes %s receipts', kind => {
  configureFunding(app, productId, policy);
  if (kind === 'refund') payment.refunded = 1;
  if (kind === 'dispute') payment.disputed = true;
  if (kind === 'test') payment.live = false;
  if (kind === 'currency') payment.currency = 'eur';
  if (kind === 'foreign-account') payment.accountId = 'foreign';
  if (kind === 'foreign-business') payment.productId = 'foreign';
  snapshot(); expect(budget(app, productId).availableCents).toBe(0); expect(fundingView(app, productId).excludedPayments).toBe(1);
});
it('a later refund removes funding without releasing already committed liability', () => {
  configureFunding(app, productId, policy); reserveGrowthTest(app, productId, 'test', 1000);
  payment.refunded = payment.captured; snapshot();
  expect(budget(app, productId)).toMatchObject({ allocationCents: 0, committedCents: 1000, availableCents: 0 });
  expect(() => reserveGrowthTest(app, productId, 'test', 1000)).toThrow('no longer fully funded');
  expect(app.db.select().from(marketingCommitments).all()[0]?.status).toBe('reserved');
});
it.each(['pending', 'young', 'future-settlement'] as const)('holds %s receipts', kind => {
  configureFunding(app, productId, policy);
  if (kind === 'pending') payment.settlement!.status = 'pending';
  if (kind === 'young') payment.createdAt = clock.now();
  if (kind === 'future-settlement') payment.settlement!.availableAt = clock.now() + 1;
  snapshot(); expect(fundingView(app, productId)).toMatchObject({ allocationCents: 0, heldPayments: 1 });
});
it.each(['missing', 'net-mismatch', 'currency-mismatch'] as const)('blocks funding with %s settlement evidence', kind => {
  configureFunding(app, productId, policy);
  if (kind === 'missing') delete payment.settlement;
  if (kind === 'net-mismatch') payment.settlement!.net++;
  if (kind === 'currency-mismatch') payment.settlement!.currency = 'eur';
  snapshot(); expect(fundingView(app, productId).unknownPayments).toBe(1); expect(budget(app, productId).availableCents).toBe(0);
});
it.each(['partial', 'stale', 'source-changed', 'disconnected'] as const)('blocks new reservations when %s', kind => {
  configureFunding(app, productId, policy);
  if (kind === 'partial') source.status = 'partial';
  if (kind === 'stale') source.lastCompleteAt = clock.now() - 3600001;
  if (kind === 'source-changed') source.revision++;
  if (kind === 'disconnected') put('connections.account.stripe', { id: 'stripe', productId, provider: 'stripe', status: 'attention' });
  put('revenue.config.' + productId, source);
  expect(() => reserveGrowthTest(app, productId, 'test', 1)).toThrow('cash');
});
it('honors zero cash, a zero cap, disabled rules and the cumulative cap', () => {
  configureFunding(app, productId, { ...policy, capCents: 500 }); expect(budget(app, productId).availableCents).toBe(500);
  configureFunding(app, productId, { ...policy, capCents: 0 }); expect(budget(app, productId).availableCents).toBe(0);
  configureFunding(app, productId, { ...policy, enabled: false }); expect(budget(app, productId).availableCents).toBe(0);
  configureFunding(app, productId, policy); snapshot([]); expect(budget(app, productId).availableCents).toBe(0);
});
it('rejects test sources and out-of-range financial settings', () => {
  source.live = false; put('revenue.config.' + productId, source);
  expect(() => configureFunding(app, productId, policy)).toThrow('live Stripe');
  for (const patch of [{ reinvestPct: 101 }, { capCents: -1 }, { holdDays: 0 }, { operatingReservePct: 101 }]) expect(() => configureFunding(app, productId, { ...policy, ...patch })).toThrow();
});
