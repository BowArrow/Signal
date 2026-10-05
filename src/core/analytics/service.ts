import { eq, like } from 'drizzle-orm';
import type { App } from '../app.js';
import { settings, studioCampaigns } from '../db/schema.js';
import { initializeMarketing, requireProduct } from '../marketing/store.js';
import { analyticsConfigSchema, analyticsTotals, type AnalyticsConfig, type AnalyticsRow, type AnalyticsSnapshot, type AnalyticsState, type AnalyticsView, type FunnelRow } from '../../shared/analytics.js';

const CONFIG = 'analytics.config.'; const SNAPSHOT = 'analytics.snapshot.';
export class AnalyticsService {
  private running = new Map<string, { promise: Promise<void>; controller: AbortController }>();
  constructor(private readonly app: App) {}
  private get<T>(key: string): T | undefined { return this.app.db.select().from(settings).where(eq(settings.key, key)).get()?.value as T | undefined; }
  private put(key: string, value: unknown) { this.app.db.insert(settings).values({ key, value, updatedAt: this.app.clock.now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: this.app.clock.now() } }).run(); }
  states() { return this.app.db.select().from(settings).where(like(settings.key, `${CONFIG}%`)).all().map(r => r.value as AnalyticsState).filter(s => { try { requireProduct(this.app, s.productId); return true; } catch { return false; } }); }
  snapshot(productId: string) { requireProduct(this.app, productId); return this.get<AnalyticsSnapshot>(SNAPSHOT + productId); }
  private account(productId: string, accountId: string) {
    requireProduct(this.app, productId);
    const account = this.app.connections?.accounts().find(a => a.id === accountId && a.productId === productId && a.provider === 'ga4' && a.status === 'verified');
    if (!account) throw new Error('Choose a verified Google Analytics account for this business.');
    return account;
  }
  configure(productId: string, input: AnalyticsConfig) {
    const value = analyticsConfigSchema.parse(input); this.account(productId, value.accountId);
    const hostname = new URL(requireProduct(this.app, productId).utmBase).hostname;
    if (this.states().some(s => s.productId !== productId && s.propertyId === value.propertyId && s.hostname === hostname)) throw new Error('This property and hostname are assigned to another business.');
    this.running.get(productId)?.controller.abort();
    const revision = (this.get<AnalyticsState>(CONFIG + productId)?.revision ?? 0) + 1;
    this.app.db.transaction(() => {
      this.put(CONFIG + productId, { ...value, productId, hostname, revision, status: 'idle', lastAttemptAt: null, lastCompleteAt: null, detail: 'Source saved. Sync to verify property access and read campaign results.' } satisfies AnalyticsState);
      this.app.db.delete(settings).where(eq(settings.key, SNAPSHOT + productId)).run();
    });
  }
  remove(productId: string) {
    requireProduct(this.app, productId); this.running.get(productId)?.controller.abort();
    this.app.db.transaction(() => { for (const prefix of [CONFIG, SNAPSHOT]) this.app.db.delete(settings).where(eq(settings.key, prefix + productId)).run(); });
  }
  view(): AnalyticsView {
    initializeMarketing(this.app); const products = this.app.connections?.view().products ?? [];
    return { offline: this.app.env.SIGNAL_OFFLINE === '1', products, accounts: (this.app.connections?.accounts() ?? []).filter(a => a.provider === 'ga4').map(({ id, productId, label, status }) => ({ id, productId, label, status })), states: this.states(), snapshots: products.flatMap(p => { const s = this.snapshot(p.id); return s ? [s] : []; }) };
  }
  context(productId: string) {
    const product = requireProduct(this.app, productId); const state = this.get<AnalyticsState>(CONFIG + productId); const snapshot = this.snapshot(productId);
    let sourceAvailable = false; if (state) { try { this.account(productId, state.accountId); sourceAvailable = new URL(product.utmBase).hostname === state.hostname; } catch { /* connection unavailable */ } }
    return { configured: Boolean(state), status: state?.status ?? 'unconfigured', sourceAvailable,
      stale: !snapshot || !sourceAvailable || this.app.clock.now() - snapshot.observedAt > 36 * 3600000,
      snapshot: snapshot ? { ...snapshot, ...(snapshot.funnel ? { funnel: { ...snapshot.funnel, rows: [...snapshot.funnel.rows].sort((a, b) => b.count - a.count).slice(0, 100), omittedRows: Math.max(0, snapshot.funnel.rows.length - 100), boundary: 'Event counts, not unique people or a sequential cohort. Missing events may reflect missing instrumentation or consent. Do not infer drop-off or activation rates from these aggregates.' } } : {}), rows: [...snapshot.rows].sort((a, b) => b.sessions - a.sessions).slice(0, 100), omittedRows: Math.max(0, snapshot.rows.length - 100), totals: analyticsTotals(snapshot.rows) } : null,
      boundary: 'GA4 website observations for the exact hostname and reported date window. Key events and purchase events depend on site instrumentation and consent; missing data is not proof of no sales. Revenue is an analytics estimate in currency major units, not Stripe payment evidence or spendable funds. Unknown campaigns are not inferred. Attribution is association, not causality. Respect reporting limitations and freshness; never add overlapping snapshots together.',
    };
  }
  sync(productId: string): Promise<void> {
    const active = this.running.get(productId); if (active) return active.promise;
    const controller = new AbortController(); const promise = this.scan(productId, controller.signal).finally(() => this.running.delete(productId));
    this.running.set(productId, { promise, controller }); return promise;
  }
  async tick() {
    if (this.app.env.SIGNAL_OFFLINE === '1') return;
    for (const state of this.states()) {
      if (!this.app.operations?.state(state.productId).running) continue;
      const interval = state.status === 'syncing' ? 0 : state.status === 'attention' ? 300000 : 3600000;
      if (state.lastAttemptAt !== null && this.app.clock.now() - state.lastAttemptAt < interval) continue;
      await this.sync(state.productId);
    }
  }
  async stop() { for (const active of this.running.values()) active.controller.abort(); await Promise.allSettled([...this.running.values()].map(a => a.promise)); }
  private async scan(productId: string, signal: AbortSignal) {
    if (this.app.env.SIGNAL_OFFLINE === '1') throw new Error('Analytics sync is unavailable offline.');
    requireProduct(this.app, productId); const state = this.get<AnalyticsState>(CONFIG + productId);
    if (!state) throw new Error('Choose a Google Analytics property first.');
    this.put(CONFIG + productId, { ...state, lastAttemptAt: this.app.clock.now(), status: 'syncing', detail: 'Reading campaign results for the last 30 completed calendar days.' });
    try {
      this.account(productId, state.accountId);
      if (new URL(requireProduct(this.app, productId).utmBase).hostname !== state.hostname) throw new Error('Website hostname changed.');
      const report = await this.app.connections!.analyticsRead(productId, state, signal);
      signal.throwIfAborted(); this.account(productId, state.accountId);
      if (this.get<AnalyticsState>(CONFIG + productId)?.revision !== state.revision) return;
      if (new URL(requireProduct(this.app, productId).utmBase).hostname !== state.hostname) throw new Error('Website hostname changed.');
      const ids = new Set(this.app.db.select({ id: studioCampaigns.id }).from(studioCampaigns).where(eq(studioCampaigns.productId, productId)).all().map(c => c.id));
      for (const delivery of this.app.operations?.deliveries() ?? []) if (delivery.productId === productId) ids.add(delivery.id);
      for (const delivery of this.app.videoPublishing?.jobs() ?? []) if (delivery.productId === productId && delivery.receipt) ids.add(delivery.id);
      const groups = new Map<string, AnalyticsRow>();
      for (const { campaign, ...metrics } of report.rows) {
        const attribution = ids.has(campaign) ? 'matched' : !campaign || ['(not set)', '(direct)'].includes(campaign) ? 'none' : 'unknown';
        const campaignId = attribution === 'matched' ? campaign : null;
        const key = campaignId ?? attribution; const group = groups.get(key);
        if (group) { group.sessions += metrics.sessions; group.engagedSessions += metrics.engagedSessions; group.keyEvents += metrics.keyEvents; group.ecommercePurchases += metrics.ecommercePurchases; group.purchaseRevenue += metrics.purchaseRevenue; }
        else groups.set(key, { ...metrics, campaignId, attribution });
      }
      const events = new Map<string, FunnelRow>();
      for (const row of report.funnel?.rows ?? []) {
        const attribution = ids.has(row.campaign) ? 'matched' : !row.campaign || ['(not set)', '(direct)'].includes(row.campaign) ? 'none' : 'unknown';
        const campaignId = attribution === 'matched' ? row.campaign : null;
        const key = JSON.stringify([campaignId ?? attribution, row.event]); const previous = events.get(key);
        if (previous) previous.count += row.count;
        else events.set(key, { event: row.event, count: row.count, campaignId, attribution });
      }
      const snapshot: AnalyticsSnapshot = { productId, accountId: state.accountId, propertyId: state.propertyId, hostname: state.hostname, startDate: report.startDate, endDate: report.endDate, timeZone: report.timeZone, currencyCode: report.currencyCode, observedAt: this.app.clock.now(), limitations: report.limitations, rows: [...groups.values()], ...(report.funnel ? { funnel: { status: report.funnel.status, rows: [...events.values()], limitations: report.funnel.limitations } } : {}) };
      this.app.db.transaction(() => {
        this.put(SNAPSHOT + productId, snapshot);
        this.put(CONFIG + productId, { ...state, lastAttemptAt: this.app.clock.now(), lastCompleteAt: snapshot.observedAt, status: report.limitations.length ? 'limited' : 'current', detail: report.limitations.length ? 'Report saved with limitations. Review them before comparing campaigns.' : 'Complete report saved. Analytics observations are separate from payment evidence.' } satisfies AnalyticsState);
      });
    } catch {
      if (signal.aborted) return;
      if (this.get<AnalyticsState>(CONFIG + productId)?.revision === state.revision) this.put(CONFIG + productId, { ...this.get<AnalyticsState>(CONFIG + productId)!, status: 'attention', detail: 'Analytics sync failed. Check account access, property ID, enabled Google Analytics Data/Admin APIs, website hostname and network. Reports over 10,000 campaign rows or with restricted metrics cannot replace the previous snapshot.' });
    }
  }
}
