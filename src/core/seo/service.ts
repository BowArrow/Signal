import { createHash } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import type { App } from '../app.js';
import { settings } from '../db/schema.js';
import { requireProduct } from '../marketing/store.js';
import { seoConfigSchema, searchPropertyMatches, SEO_GUIDANCE, type SeoConfig, type SeoState, type SeoSnapshot, type SeoView } from '../../shared/seo.js';
import type { DemandFinding } from '../../shared/discovery.js';

const CONFIG = 'seo.config.', SNAPSHOT = 'seo.snapshot.';
export class SeoService {
  private running = new Map<string, { promise: Promise<void>; controller: AbortController }>();
  constructor(private readonly app: App) {}
  private get<T>(key: string) { return this.app.db.select().from(settings).where(eq(settings.key, key)).get()?.value as T | undefined; }
  private put(key: string, value: unknown) { this.app.db.insert(settings).values({ key, value, updatedAt: this.app.clock.now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: this.app.clock.now() } }).run(); }
  states() { return this.app.db.select().from(settings).where(like(settings.key, CONFIG + '%')).all().map(r => r.value as SeoState); }
  private account(productId: string, accountId: string) {
    requireProduct(this.app, productId);
    if (!this.app.connections?.accounts().some(a => a.id === accountId && a.productId === productId && a.provider === 'search-console' && a.status === 'verified')) throw new Error('Connect and verify Search Console for this business first.');
  }
  configure(productId: string, input: SeoConfig) {
    const value = seoConfigSchema.parse(input); this.account(productId, value.accountId);
    const origin = new URL(requireProduct(this.app, productId).utmBase).origin;
    if (!searchPropertyMatches(value.siteUrl, origin)) throw new Error('Use the domain or root URL property for this product website.');
    this.running.get(productId)?.controller.abort();
    this.app.db.transaction(() => {
      this.put(CONFIG + productId, { ...value, productId, origin, revision: (this.get<SeoState>(CONFIG + productId)?.revision ?? 0) + 1, status: 'idle', lastAttemptAt: null, detail: 'Source saved. Sync to read observed search queries.' } satisfies SeoState);
      this.app.db.delete(settings).where(eq(settings.key, SNAPSHOT + productId)).run();
    });
  }
  remove(productId: string) { requireProduct(this.app, productId); this.running.get(productId)?.controller.abort(); this.app.db.transaction(() => { for (const prefix of [CONFIG, SNAPSHOT]) this.app.db.delete(settings).where(eq(settings.key, prefix + productId)).run(); }); }
  view(): SeoView { return { offline: this.app.env.SIGNAL_OFFLINE === '1', accounts: (this.app.connections?.accounts() ?? []).filter(a => a.provider === 'search-console').map(({ id, productId, label, status }) => ({ id, productId, label, status })), states: this.states(), snapshots: this.states().flatMap(s => { const snap = this.get<SeoSnapshot>(SNAPSHOT + s.productId); return snap ? [snap] : []; }) }; }
  context(productId: string) {
    const state = this.get<SeoState>(CONFIG + productId), snapshot = this.get<SeoSnapshot>(SNAPSHOT + productId);
    let available = false;
    if (state) { try { this.account(productId, state.accountId); available = new URL(requireProduct(this.app, productId).utmBase).origin === state.origin; } catch { /* unavailable */ } }
    const fresh = Boolean(available && snapshot && this.app.clock.now() - snapshot.observedAt < 48 * 3600000 && state?.status === 'current');
    return { configured: Boolean(state), fresh, detail: state?.detail ?? 'Connect Search Console to measure brand visibility and real search queries. Topic popularity is unknown until measured.', snapshot: snapshot ? { ...snapshot, rows: [...snapshot.rows].sort((a, b) => b.impressions - a.impressions).slice(0, 30) } : null, guidance: SEO_GUIDANCE };
  }
  findings(productId: string): DemandFinding[] {
    const context = this.context(productId); if (!context.fresh || !context.snapshot) return [];
    const snapshot = this.get<SeoSnapshot>(SNAPSHOT + productId)!;
    const seen = new Set<string>();
    return [...snapshot.rows].sort((a, b) => b.impressions - a.impressions).filter(row => {
      const key = row.query.toLowerCase().trim();
      if (!key || seen.has(key) || row.impressions <= 0 || key.split(/\s+/).length < 3) return false;
      seen.add(key); return true;
    }).slice(0, 50).map(row => ({
      id: createHash('sha256').update(`seo:${productId}:${row.query.toLowerCase().trim()}`).digest('hex').slice(0, 24),
      kind: 'search-console', url: row.page, title: `Search intent: ${row.query}`, query: row.query,
      excerpt: `Observed Google query: ${JSON.stringify(row.query)}. ${row.impressions} impressions and ${row.clicks} clicks for ${row.page}, ${snapshot.startDate} through ${snapshot.endDate}. This is aggregate search intent, not an identifiable author or contact permission. Check full product fit before proposing a useful guide; do not duplicate the existing ranking page.`,
      postedAt: Date.parse(snapshot.endDate + 'T00:00:00Z'), observedAt: snapshot.observedAt, requestLanguage: true,
    }));
  }
  sync(productId: string): Promise<void> {
    const active = this.running.get(productId); if (active) return active.promise;
    const controller = new AbortController(); const promise = this.scan(productId, controller.signal).finally(() => this.running.delete(productId));
    this.running.set(productId, { promise, controller }); return promise;
  }
  private async scan(productId: string, signal: AbortSignal) {
    if (this.app.env.SIGNAL_OFFLINE === '1') throw new Error('Search research is unavailable offline.');
    const state = this.get<SeoState>(CONFIG + productId); if (!state) throw new Error('Choose a Search Console property first.');
    this.put(CONFIG + productId, { ...state, lastAttemptAt: this.app.clock.now(), status: 'syncing', detail: 'Reading completed Google search observations.' });
    try {
      this.account(productId, state.accountId);
      if (new URL(requireProduct(this.app, productId).utmBase).origin !== state.origin) throw new Error('Website changed.');
      const report = await this.app.connections!.searchRead(productId, state, signal);
      signal.throwIfAborted(); this.account(productId, state.accountId);
      if (this.get<SeoState>(CONFIG + productId)?.revision !== state.revision) return;
      if (new URL(requireProduct(this.app, productId).utmBase).origin !== state.origin) throw new Error('Website changed.');
      this.app.db.transaction(() => {
        this.put(SNAPSHOT + productId, { ...report, productId, accountId: state.accountId, siteUrl: state.siteUrl, observedAt: this.app.clock.now() } satisfies SeoSnapshot);
        this.put(CONFIG + productId, { ...state, lastAttemptAt: this.app.clock.now(), status: 'current', detail: report.rows.length ? 'Search observations saved. Suitable task queries can inform website campaigns.' : 'No query rows returned. This does not prove the website is unindexed or that nobody searches for it.' } satisfies SeoState);
      });
    } catch {
      if (!signal.aborted && this.get<SeoState>(CONFIG + productId)?.revision === state.revision) this.put(CONFIG + productId, { ...state, lastAttemptAt: this.app.clock.now(), status: 'attention', detail: 'Search sync failed. Check property access, Search Console API, connection and website scope. The previous report is preserved.' });
    }
  }
  async tick() {
    if (this.app.env.SIGNAL_OFFLINE === '1') return;
    for (const state of this.states()) if (this.app.operations?.state(state.productId).running && (state.lastAttemptAt === null || this.app.clock.now() - state.lastAttemptAt >= (state.status === 'attention' ? 3600000 : 86400000))) await this.sync(state.productId);
  }
  async stop() { for (const active of this.running.values()) active.controller.abort(); await Promise.allSettled([...this.running.values()].map(a => a.promise)); }
}
