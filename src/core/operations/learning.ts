import type { App } from '../app.js';
import type { Delivery, OperationLearning, OperationState } from '../../shared/operations.js';
import { chooseTrafficExperiment } from './traffic-learning.js';

const DAY = 86400000;
/** A bounded allocation heuristic, not a causal experiment or significance test. */
export function chooseOperation(app: App, state: OperationState, deliveries: Delivery[]): OperationLearning {
  const purchase = choosePurchaseOperation(app, state, deliveries);
  const { traffic, candidate } = chooseTrafficExperiment(app, state, deliveries);
  const summary = { ...traffic }; delete summary.reference;
  const decision = { ...purchase, traffic: summary };
  // Keep purchase-supported focus and paid ties ahead of the weaker visitor proxy.
  if (purchase.mode === 'build-on' || purchase.accounts.some(a => a.paidCampaigns >= 2 && a.retainedPayments >= 3)) return decision;
  if (purchase.cycle % 4 === 0) return { ...decision, reason: 'Use this cycle to explore a different buyer problem and keep selected destinations in rotation. Every fourth cycle remains exploratory.' };
  if (!candidate || !traffic.reference) return decision;
  return { ...decision, mode: 'test-interest', accountId: candidate.accountId, traffic,
    reason: `Test an adjacent buyer task after ${candidate.engagedCampaigns} publications each recorded at least 10 engaged sessions. This destination has ${candidate.engagedSessions} engaged sessions in the reported window. This is a visitor-interest hypothesis, not purchase evidence or a proven winning channel. Other campaigns may have missing tracking. Limits and spending permissions stay unchanged.` };
}
function choosePurchaseOperation(app: App, state: OperationState, deliveries: Delivery[]): OperationLearning {
  const now = app.clock.now(); const windowStart = now - 30 * DAY;
  const history = deliveries.filter(d => d.productId === state.productId && state.accountIds.includes(d.accountId));
  const lastUsed = (accountId: string) => Math.max(0, ...history.filter(d => d.accountId === accountId).map(d => d.createdAt));
  const rotation = [...state.accountIds].sort((a, b) => lastUsed(a) - lastUsed(b));
  const revenue = app.revenue?.states().find(s => s.productId === state.productId);
  const verified = app.connections?.accounts().some(a => a.id === revenue?.accountId && a.productId === state.productId && a.provider === 'stripe' && a.status === 'verified');
  const usable = Boolean(revenue?.live && revenue.status === 'current' && revenue.lastCompleteAt && revenue.lastCompleteAt <= now && now - revenue.lastCompleteAt <= 36 * 3600000 && revenue.since <= windowStart && verified);
  const mature = history.filter(d => d.status === 'published' && d.receipt && d.receipt.confirmedAt >= windowStart && d.receipt.confirmedAt <= now - 7 * DAY);
  const tracked = (delivery: Delivery) => [...delivery.body.matchAll(/https:\/\/[^\s)<>]+/g)].some(match => { try { const url = new URL(match[0]); return url.searchParams.get('utm_campaign') === delivery.id; } catch { return false; } });
  const payments = usable ? app.revenue!.payments(state.productId).filter(p => p.accountId === revenue!.accountId && p.live && p.attribution === 'matched' && p.campaignId && !p.disputed && p.captured > p.refunded && p.createdAt >= windowStart && p.createdAt <= revenue!.lastCompleteAt!) : [];
  const paymentCounts = new Map<string, number>();
  const seen = new Set<string>();
  for (const payment of payments) {
    const campaign = mature.find(d => d.id === payment.campaignId && payment.createdAt >= d.receipt!.confirmedAt);
    if (!campaign || seen.has(payment.id)) continue;
    seen.add(payment.id); paymentCounts.set(campaign.id, (paymentCounts.get(campaign.id) ?? 0) + 1);
  }
  const accounts = state.accountIds.map(accountId => {
    const campaigns = mature.filter(d => d.accountId === accountId);
    const retainedPayments = campaigns.reduce((count, d) => count + (paymentCounts.get(d.id) ?? 0), 0);
    return { accountId, campaigns: campaigns.length, paidCampaigns: campaigns.filter(d => paymentCounts.has(d.id)).length, retainedPayments, paymentsPerCampaign: campaigns.length ? retainedPayments / campaigns.length : 0 };
  });
  const decision: OperationLearning = { version: 1, cycle: (state.learning?.cycle ?? 0) + 1, decidedAt: now, windowStart, mode: 'explore', accountId: rotation[0]!, reason: 'Keep testing distinct buyer problems. There is not enough comparable purchase evidence to focus delivery.', revenueObservedAt: revenue?.lastCompleteAt ?? null, accounts };
  if (!usable) { decision.reason = 'Rotate destinations and test a new buyer problem. Focusing needs a current live Stripe scan covering the last 30 days; missing tracking is not evidence of failure.'; return decision; }
  if (accounts.some(a => a.campaigns < 2) || mature.some(d => !tracked(d))) { decision.reason = 'Keep exploring: each destination needs at least two tracked publications aged 7–30 days before comparing payment associations.'; return decision; }
  if (decision.cycle % 4 === 0) { decision.reason = 'Use this cycle to explore a different buyer problem and keep other selected destinations in rotation. Every fourth cycle remains exploratory.'; return decision; }
  const ranked = accounts.filter(a => a.paidCampaigns >= 2 && a.retainedPayments >= 3).sort((a, b) => b.paymentsPerCampaign - a.paymentsPerCampaign || lastUsed(a.accountId) - lastUsed(b.accountId));
  const candidate = ranked[0]; if (!candidate) return decision;
  // Tied destinations remain in rotation rather than declaring a winner.
  if (accounts.some(a => a.accountId !== candidate.accountId && a.paymentsPerCampaign >= candidate.paymentsPerCampaign)) return decision;
  const reference = mature.filter(d => d.accountId === candidate.accountId && paymentCounts.has(d.id)).sort((a, b) => (paymentCounts.get(b.id)! - paymentCounts.get(a.id)!) || b.createdAt - a.createdAt)[0]!;
  return { ...decision, mode: 'build-on', accountId: candidate.accountId,
    reason: `Build on a buyer problem from ${candidate.paidCampaigns} publications associated with ${candidate.retainedPayments} live payments that retain value after refunds and are not disputed. This is a directional association, not proof of causality or unique customers. Limits and spending permissions stay unchanged.`,
    reference: { id: reference.id, title: reference.title, description: reference.description, retainedPayments: paymentCounts.get(reference.id)! } };
}
