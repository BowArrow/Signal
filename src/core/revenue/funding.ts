import { eq } from 'drizzle-orm';
import type { App } from '../app.js';
import { products, settings } from '../db/schema.js';
import { fundingPolicySchema, type FundingPolicy, type FundingState, type FundingView } from '../../shared/funding.js';
import type { RevenuePayment, RevenueState } from '../../shared/revenue.js';

const PREFIX = 'revenue.funding.';
function read<T>(app: App, key: string) { return app.db.select().from(settings).where(eq(settings.key, key)).get()?.value as T | undefined; }
export function configureFunding(app: App, productId: string, input: FundingPolicy) {
  const policy = fundingPolicySchema.parse(input);
  const product = app.db.select().from(products).where(eq(products.id, productId)).get(); if (!product) throw new Error('Business not found.');
  const source = read<RevenueState>(app, 'revenue.config.' + productId);
  if (policy.enabled && (!source?.live || !source.stripeProductIds.length)) throw new Error('Configure a live Stripe source for this business before enabling reinvestment.');
  const prior = read<FundingState>(app, PREFIX + productId);
  const value: FundingState = { ...policy, productId, currency: product.currency.toLowerCase(), revenueRevision: source?.revision ?? 0, revision: (prior?.revision ?? 0) + 1, configuredAt: app.clock.now() };
  app.operations?.pause(productId);
  app.db.insert(settings).values({ key: PREFIX + productId, value, updatedAt: app.clock.now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: app.clock.now() } }).run();
  return fundingView(app, productId);
}
/** A cumulative allocation from observed receipts, never a bank balance or profit claim.
 * No append-only credits: a later refund reduces the same calculation on the next scan.
 */
export function fundingView(app: App, productId: string): FundingView {
  const product = app.db.select().from(products).where(eq(products.id, productId)).get(); if (!product) throw new Error('Business not found.');
  const policy = read<FundingState>(app, PREFIX + productId) ?? null;
  const source = read<RevenueState>(app, 'revenue.config.' + productId);
  const currency = product.currency.toLowerCase();
  const view: FundingView = { productId, currency, policy, eligibleCents: 0, allocationCents: 0, eligiblePayments: 0, heldPayments: 0, unknownPayments: 0, excludedPayments: 0, blockers: [], observedAt: source?.lastCompleteAt ?? null };
  if (!policy) { view.blockers.push('Sales-funded marketing is not configured.'); return view; }
  if (!policy.enabled) view.blockers.push('Sales-funded marketing is disabled.');
  if (!policy.capCents || !policy.reinvestPct) view.blockers.push('The saved reinvestment percentage or total allocation cap is zero.');
  if (!source?.live) { view.blockers.push('A live Stripe revenue source is required.'); return view; }
  if (policy.revenueRevision !== source.revision || policy.currency !== currency) { view.blockers.push('The revenue source or currency changed. Review and save the funding rule again.'); return view; }
  if (!app.connections?.accounts().some(a => a.productId === productId && a.id === source.accountId && a.provider === 'stripe' && a.status === 'verified')) view.blockers.push('The configured Stripe account needs verification.');
  if (source.status !== 'current' || !source.lastCompleteAt || source.lastCompleteAt > app.clock.now() || app.clock.now() - source.lastCompleteAt > 3600000) view.blockers.push('Complete a fresh Stripe scan before reserving money.');
  const seen = new Set<string>();
  for (const payment of read<RevenuePayment[]>(app, 'revenue.snapshot.' + productId) ?? []) {
    if (seen.has(payment.id)) continue; seen.add(payment.id);
    if (payment.productId !== productId || payment.accountId !== source.accountId || !payment.live || payment.currency !== currency || payment.disputed || payment.refunded > 0) { view.excludedPayments++; continue; }
    const cash = payment.settlement;
    if (!cash || cash.currency !== currency || cash.amount !== payment.captured || cash.net !== cash.amount - cash.fee || cash.tax < 0 || cash.fee < 0 || cash.tax > cash.amount || !Number.isSafeInteger(cash.net)) { view.unknownPayments++; continue; }
    if (cash.status !== 'available' || cash.availableAt > app.clock.now() || payment.createdAt > app.clock.now() - policy.holdDays * 86400000) { view.heldPayments++; continue; }
    view.eligiblePayments++;
    view.eligibleCents += Math.max(0, cash.net - cash.tax);
  }
  if (view.unknownPayments) view.blockers.push('Some payments are missing verified fees, settlement or tax amounts. Check Stripe read permissions and sync again.');
  const afterCosts = Math.floor(view.eligibleCents * (100 - policy.operatingReservePct) / 100);
  if (!view.blockers.length) view.allocationCents = Math.min(policy.capCents, Math.floor(Math.max(0, afterCosts - policy.reserveCents) * policy.reinvestPct / 100));
  return view;
}
