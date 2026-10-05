import { and, eq, like } from 'drizzle-orm';
import type { App } from '../app.js';
import { settings, studioCampaigns, studioLeads } from '../db/schema.js';
import { budget, initializeMarketing, requireProduct } from '../marketing/store.js';
import { revenueConfigSchema, type RevenueConfig, type RevenuePayment, type RevenueState, type RevenueTotals, type RevenueView } from '../../shared/revenue.js';
import { purchaseContactHash } from './identity.js';
import { mailboxAddress } from '../sales/inbox.js';
import { fundingView } from './funding.js';

const POLICY = 'revenue.config.'; const SNAPSHOT = 'revenue.snapshot.'; const STAGE = 'revenue.stage.';
export class RevenueService {
  private running = new Map<string, { promise: Promise<void>; controller: AbortController }>();
  constructor(private readonly app: App) {}
  private get<T>(key: string): T | undefined { return this.app.db.select().from(settings).where(eq(settings.key, key)).get()?.value as T | undefined; }
  private put(key: string, value: unknown) { this.app.db.insert(settings).values({ key, value, updatedAt: this.app.clock.now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: this.app.clock.now() } }).run(); }
  states() { return this.app.db.select().from(settings).where(like(settings.key, `${POLICY}%`)).all().map(row => row.value as RevenueState).filter(state => { try { requireProduct(this.app, state.productId); return true; } catch { return false; } }); }
  private state(productId: string) { requireProduct(this.app, productId); const state = this.get<RevenueState>(POLICY + productId); if (!state) throw new Error('Choose a Stripe revenue source for this business first.'); return state; }
  payments(productId: string): RevenuePayment[] { requireProduct(this.app, productId); return this.get<RevenuePayment[]>(SNAPSHOT + productId) ?? []; }
  purchaseForContact(productId: string, contact: string) {
    const state = this.get<RevenueState>(POLICY + productId);
    if (!state?.live) return undefined;
    const hash = purchaseContactHash(state.accountId, mailboxAddress(contact));
    return hash ? this.payments(productId).find(p => p.live && p.accountId === state.accountId && p.contactHash === hash && p.captured > 0) : undefined;
  }
  /** A refund never resumes a sales sequence. This records purchase history, not entitlement. */
  reconcileCustomers(productId: string) {
    requireProduct(this.app, productId);
    const payments = this.payments(productId).filter(p => p.live && p.contactHash && p.captured > 0);
    const state = this.get<RevenueState>(POLICY + productId); if (!state?.live || !payments.length) return;
    const hashes = new Set(payments.filter(p => p.accountId === state.accountId).map(p => p.contactHash));
    for (const lead of this.app.db.select().from(studioLeads).where(eq(studioLeads.productId, productId)).all()) {
      const contact = mailboxAddress(lead.value.contact); const hash = purchaseContactHash(state.accountId, contact);
      if (!contact || !hash || !hashes.has(hash)) continue;
      this.app.db.transaction(() => {
        if (lead.value.stage !== 'customer' || lead.value.followUpAt !== null) this.app.db.update(studioLeads).set({ value: { ...lead.value, stage: 'customer', followUpAt: null } }).where(eq(studioLeads.id, lead.id)).run();
        this.app.salesReplies?.stopForPurchase(productId, contact);
        this.app.outreach?.stopForPurchase(productId, contact);
      });
    }
  }
  private account(productId: string, accountId: string) {
    requireProduct(this.app, productId);
    const account = this.app.connections?.accounts().find(a => a.id === accountId && a.productId === productId && a.provider === 'stripe');
    if (!account || account.status !== 'verified') throw new Error('Choose a verified Stripe account connected to this business.');
    return account;
  }
  configure(productId: string, input: RevenueConfig) {
    const value = revenueConfigSchema.parse(input); this.account(productId, value.accountId);
    if (value.since > this.app.clock.now()) throw new Error('Revenue history cannot start in the future.');
    if (new Set(value.stripeProductIds).size !== value.stripeProductIds.length) throw new Error('Choose each Stripe product once.');
    if (this.states().some(s => s.productId !== productId && s.stripeProductIds.some(id => value.stripeProductIds.includes(id)))) throw new Error('A selected Stripe product is already assigned to another business.');
    this.running.get(productId)?.controller.abort();
    const revision = (this.get<RevenueState>(POLICY + productId)?.revision ?? 0) + 1;
    this.app.db.transaction(() => {
      this.put(POLICY + productId, { ...value, productId, revision, cursor: '', scanStartedAt: null, lastAttemptAt: null, lastCompleteAt: null, scanned: 0, excluded: 0, status: 'idle', detail: 'Saved. Revenue has not been synced for this source.' } satisfies RevenueState);
      this.put(SNAPSHOT + productId, []); this.put(STAGE + productId, []);
    });
  }
  async catalog(productId: string, accountId: string) {
    this.account(productId, accountId);
    const result = await this.app.connections!.revenueRead(productId, { accountId }, new AbortController().signal);
    if (!Array.isArray(result)) throw new Error('Unexpected Stripe product response.'); return result;
  }
  totals(productId: string): RevenueTotals[] {
    const groups = new Map<string, RevenueTotals>();
    for (const row of this.payments(productId)) {
      const key = `${row.live}:${row.currency}`; const group = groups.get(key) ?? { currency: row.currency, live: row.live, payments: 0, captured: 0, refunded: 0, disputedPayments: 0, attributedPayments: 0 };
      group.payments++; group.captured += row.captured; group.refunded += row.refunded; group.disputedPayments += Number(row.disputed); group.attributedPayments += Number(row.attribution === 'matched'); groups.set(key, group);
    }
    return [...groups.values()];
  }
  context(productId: string) {
    const state = this.get<RevenueState>(POLICY + productId);
    const campaigns = new Map<string, { campaignId: string; currency: string; live: boolean; payments: number; captured: number; refunded: number; disputed: number }>();
    for (const payment of this.payments(productId).filter(p => p.attribution === 'matched' && p.campaignId)) {
      const key = `${payment.campaignId}:${payment.currency}:${payment.live}`;
      const row = campaigns.get(key) ?? { campaignId: payment.campaignId!, currency: payment.currency, live: payment.live, payments: 0, captured: 0, refunded: 0, disputed: 0 };
      row.payments++; row.captured += payment.captured; row.refunded += payment.refunded; row.disputed += Number(payment.disputed); campaigns.set(key, row);
    }
    return { configured: Boolean(state), status: state?.status ?? 'unconfigured', lastCompleteAt: state?.lastCompleteAt ?? null, since: state?.since ?? null, totals: this.totals(productId), campaigns: [...campaigns.values()], boundary: 'Stripe-reported captured payments and refunds, in each currency smallest unit. Test payments are not revenue. Disputes remain flagged. These are not unique customers, profit, settled surplus, proof of causality, or authorization to spend. No tracking metadata means unattributed, never inferred.' };
  }
  view(): RevenueView {
    initializeMarketing(this.app); const products = this.app.connections?.view().products ?? [];
    return { funding: products.map(p => { const funding = fundingView(this.app, p.id); return { ...funding, ...(funding.policy ? { remaining: budget(this.app, p.id) } : {}) }; }), offline: this.app.env.SIGNAL_OFFLINE === '1', products, accounts: (this.app.connections?.accounts() ?? []).filter(a => a.provider === 'stripe').map(a => ({ id: a.id, productId: a.productId, label: a.label, status: a.status })), states: this.states(), payments: products.flatMap(p => this.paymentView(p.id)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 300), totals: products.map(p => ({ productId: p.id, rows: this.totals(p.id) })) };
  }
  private paymentView(productId: string) {
    const contacts = this.app.db.select().from(studioLeads).where(eq(studioLeads.productId, productId)).all().map(l => mailboxAddress(l.value.contact));
    const counts = new Map<string, Map<string, number>>();
    return this.payments(productId).map(payment => {
      if (!counts.has(payment.accountId)) {
        const hashes = new Map<string, number>();
        for (const contact of contacts) { const hash = purchaseContactHash(payment.accountId, contact); if (hash) hashes.set(hash, (hashes.get(hash) ?? 0) + 1); }
        counts.set(payment.accountId, hashes);
      }
      const { contactHash, ...publicPayment } = payment;
      return { ...publicPayment, matchedLeadCount: payment.live && contactHash ? counts.get(payment.accountId)!.get(contactHash) ?? 0 : 0 };
    });
  }
  sync(productId: string): Promise<void> {
    const existing = this.running.get(productId); if (existing) return existing.promise;
    const controller = new AbortController();
    const promise = this.scan(productId, controller.signal).finally(() => this.running.delete(productId));
    this.running.set(productId, { promise, controller }); return promise;
  }
  async tick() {
    if (this.app.env.SIGNAL_OFFLINE === '1') return;
    for (const state of this.states()) {
      this.reconcileCustomers(state.productId);
      if (!this.app.operations?.state(state.productId).running) continue;
      const interval = state.status === 'partial' ? 2000 : state.status === 'attention' ? 60000 : 900000;
      if (state.lastAttemptAt !== null && this.app.clock.now() - state.lastAttemptAt < interval) continue;
      await this.sync(state.productId);
    }
  }
  async stop() { for (const item of this.running.values()) item.controller.abort(); await Promise.all([...this.running.values()].map(item => item.promise)); }
  private async scan(productId: string, signal: AbortSignal) {
    if (this.app.env.SIGNAL_OFFLINE === '1') throw new Error('Revenue sync is unavailable in offline mode.');
    const state = this.state(productId); const now = this.app.clock.now();
    const startedAt = state.scanStartedAt ?? now;
    this.put(POLICY + productId, { ...state, scanStartedAt: startedAt, lastAttemptAt: now, status: 'syncing', detail: 'Reading a bounded page of Stripe payments.' });
    try {
      this.account(productId, state.accountId);
      const result = await this.app.connections!.revenueRead(productId, state, signal, { cursor: state.cursor, startedAt });
      if (Array.isArray(result)) throw new Error('Unexpected Stripe response.');
      signal.throwIfAborted(); if (this.state(productId).revision !== state.revision) return;
      const previous = state.scanStartedAt === null ? [] : this.get<RevenuePayment[]>(STAGE + productId) ?? [];
      const records = new Map(previous.map(p => [p.id, p]));
      for (const row of result.rows) {
        const campaign = row.campaign && (this.app.db.select().from(studioCampaigns).where(and(eq(studioCampaigns.id, row.campaign), eq(studioCampaigns.productId, productId))).get() || this.app.operations?.deliveries().some(d => d.id === row.campaign && d.productId === productId) || this.app.outreach?.jobs(productId).some(j => j.id === row.campaign && j.status === 'sent') || this.app.videoPublishing?.jobs().some(j => j.id === row.campaign && j.productId === productId && j.receipt));
        records.set(row.id, { id: row.id, productId, accountId: state.accountId, live: row.live, currency: row.currency, captured: row.captured, refunded: row.refunded, disputed: row.disputed, createdAt: row.createdAt, observedAt: now, campaignId: campaign ? row.campaign : null, attribution: campaign ? 'matched' : row.hasCampaign ? 'unknown' : 'none', contactHash: row.contactHash ?? null, contactMatch: row.contactMatch ?? 'missing', ...(row.settlement ? { settlement: row.settlement } : {}) });
      }
      if (records.size > 50000) throw new Error('Revenue history exceeds this scan capacity. Choose a shorter history window.');
      this.app.db.transaction(() => {
        this.put(STAGE + productId, result.next ? [...records.values()] : []);
        if (!result.next) this.put(SNAPSHOT + productId, [...records.values()]);
        this.put(POLICY + productId, { ...state, cursor: result.next, scanStartedAt: result.next ? startedAt : null, lastAttemptAt: now, lastCompleteAt: result.next ? state.lastCompleteAt : this.app.clock.now(), scanned: (state.scanStartedAt === null ? 0 : state.scanned) + result.scanned, excluded: (state.scanStartedAt === null ? 0 : state.excluded) + result.excluded, status: result.next ? 'partial' : 'current', detail: result.next ? 'More history remains. The previous complete snapshot stays visible until the scan finishes.' : 'Complete scan for the selected Stripe products and history window. Captured amounts are not spendable surplus.' });
      });
      if (!result.next) this.reconcileCustomers(productId);
    } catch {
      if (this.get<RevenueState>(POLICY + productId)?.revision === state.revision) this.put(POLICY + productId, { ...this.state(productId), status: 'attention', detail: 'Revenue sync could not finish. Check Stripe access, selected mode, product scope, and network. The previous complete snapshot is preserved.' });
    }
  }
}
