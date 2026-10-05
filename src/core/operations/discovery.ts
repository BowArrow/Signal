import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { App } from '../app.js';
import { settings, type Source } from '../db/schema.js';
import type { OperationState } from '../../shared/operations.js';
import { deliveryCapacity } from '../../shared/delivery-capacity.js';
import { queryLabel, type DemandFinding, type DiscoverySnapshot, type DiscoveryQuery } from '../../shared/discovery.js';
import type { NormalizedItem } from '../ingest/types.js';
import { eligibleAcquisitionFindings } from './acquisition.js';
import { normalizeBlueskyPostUrl } from '../../shared/bluesky-url.js';

const WINDOW = 14 * 86400000;
const PREFIX = 'operations.discovery.';
/** Public demand observations, deliberately separate from people in the sales pipeline. */
export class DemandDiscovery {
  private active: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private productId: string | null = null;
  constructor(private readonly app: App) {}
  snapshot(state: OperationState): DiscoverySnapshot {
    const saved = this.app.db.select().from(settings).where(eq(settings.key, PREFIX + state.productId)).get()?.value as DiscoverySnapshot | undefined;
    if (!saved || saved.revision !== state.revision) return { productId: state.productId, revision: state.revision, lastAttemptAt: null, nextAttemptAt: 0, searches: [], findings: [] };
    return { ...saved, findings: saved.findings.filter(f => f.postedAt >= this.app.clock.now() - WINDOW).map(f => f.kind === 'bluesky' ? { ...f, url: normalizeBlueskyPostUrl(f.url) } : f) };
  }
  context(state: OperationState): DemandFinding[] {
    if (!state.discovery?.enabled) return [];
    const recent = new Set((this.app.operations?.deliveries() ?? []).filter(j => j.productId === state.productId).slice(0, 6).flatMap(j => j.demandEvidence?.map(f => f.id) ?? []));
    const findings = [...this.snapshot(state).findings, ...(this.app.seo?.findings(state.productId) ?? [])];
    return (state.mode === 'acquisition' ? eligibleAcquisitionFindings(this.app, state, findings) : findings).sort((a, b) => Number(recent.has(a.id)) - Number(recent.has(b.id)) || Number(b.requestLanguage) - Number(a.requestLanguage) || b.postedAt - a.postedAt).slice(0, 6);
  }
  private queryInterval(state: OperationState) {
    const room = deliveryCapacity(state, this.app.operations?.deliveries() ?? [], this.app.clock.now());
    const capacity = room.canPublish || room.canReply;
    return state.running && state.mode === 'acquisition' && capacity ? 15 * 60000 : 3600000;
  }
  pause(productId: string) { if (this.productId === productId) this.controller?.abort(); }
  async stop() { this.controller?.abort(); await this.active; }
  tick(states: OperationState[]): Promise<void> {
    if (this.active) return this.active;
    this.active = this.cycle(states).finally(() => { this.active = null; this.productId = null; this.controller = null; });
    return this.active;
  }
  async refresh(productId: string) {
    if (this.active) throw new Error('A public research check is already running.');
    const state = this.app.operations?.state(productId);
    if (!state?.discovery?.enabled) throw new Error('Save public buyer research settings for this business first.');
    if (this.app.env.SIGNAL_OFFLINE === '1') throw new Error('Turn off offline mode before researching public sources.');
    this.active = this.cycle([state], true).finally(() => { this.active = null; this.productId = null; this.controller = null; });
    await this.active;
    return this.snapshot(this.app.operations!.state(productId));
  }
  private async cycle(states: OperationState[], allowPaused = false) {
    if (this.app.env.SIGNAL_OFFLINE === '1') return;
    const candidates = states.filter(s => (s.running || allowPaused) && s.discovery?.enabled).map(s => ({ state: s, snapshot: this.snapshot(s) })).filter(c => c.snapshot.nextAttemptAt <= this.app.clock.now() && c.state.discovery!.queries.some(q => !c.snapshot.searches.some(s => s.query === queryLabel(q) && s.attemptedAt > this.app.clock.now() - (s.status === 'attention' ? 3600000 : this.queryInterval(c.state))))).sort((a, b) => (a.snapshot.lastAttemptAt ?? 0) - (b.snapshot.lastAttemptAt ?? 0));
    const selected = candidates[0]; if (!selected) return;
    const { state, snapshot } = selected;
    const query = state.discovery!.queries.filter(q => { const last = snapshot.searches.find(s => s.query === queryLabel(q)); return !last || last.attemptedAt <= this.app.clock.now() - (last.status === 'attention' ? 3600000 : this.queryInterval(state)); }).sort((a, b) => (snapshot.searches.find(s => s.query === queryLabel(a))?.attemptedAt ?? 0) - (snapshot.searches.find(s => s.query === queryLabel(b))?.attemptedAt ?? 0))[0]!;
    const last = snapshot.searches.find(s => s.query === queryLabel(query));
    if (last && last.attemptedAt > this.app.clock.now() - (last.status === 'attention' ? 3600000 : this.queryInterval(state))) return;
    this.productId = state.productId; this.controller = new AbortController();
    const now = this.app.clock.now(); const label = queryLabel(query);
    let findings: DemandFinding[] = []; let detail = 'Search completed. Results are unqualified public observations.'; let status: 'ok' | 'attention' = 'ok';
    try {
      if (query.kind === 'bluesky') {
        const account = this.app.connections?.accounts().find(a => a.productId === state.productId && a.provider === 'bluesky' && a.status === 'verified');
        if (!account) throw new Error('Connect Bluesky to search for public requests.');
        findings = await this.app.connections!.blueskyRequests(state.productId, account.id, query.query, this.controller.signal);
      } else {
      const source: Source = { id: `demand:${state.productId}`, kind: query.kind, identifier: query.kind === 'hn' ? query.query : `${query.site}:${query.query}`, displayName: label, enabled: false, pollIntervalSeconds: 3600, ignoreRobotsTxt: false, robotsExemptionReason: null, maxItemAgeHours: WINDOW / 3600000, discovered: true, discoveredVia: 'operations-research', lastPolledAt: null, lastPollError: null, createdAt: now, updatedAt: now };
      const poller = this.app.pollers.find(p => p.kind === query.kind);
      if (!poller?.available().ready) throw new Error('Unavailable search provider');
      const result = await poller.poll(source, this.controller.signal);
      findings = result.items.slice(0, 100).map(item => this.finding(query, item, now)).filter((f): f is DemandFinding => Boolean(f));
      }
    } catch {
      status = 'attention'; detail = 'Search unavailable or rate limited. Signal will try again later; existing observations may still inform campaigns.';
    }
    const current = this.app.operations?.state(state.productId);
    if (this.controller.signal.aborted || String(this.app.env.SIGNAL_OFFLINE) === '1' || !current || (!current.running && !allowPaused) || current.revision !== state.revision || !current.discovery?.enabled) return;
    const dedup = new Map(snapshot.findings.map(f => [f.id, f])); for (const f of findings) dedup.set(f.id, f);
    const value: DiscoverySnapshot = { productId: state.productId, revision: state.revision, lastAttemptAt: now, nextAttemptAt: now + (status === 'ok' ? 60000 : 600000), searches: [...snapshot.searches.filter(s => s.query !== label), { query: label, attemptedAt: now, status, found: findings.length, detail }], findings: [...dedup.values()].sort((a, b) => b.postedAt - a.postedAt).slice(0, 200) };
    this.app.db.insert(settings).values({ key: PREFIX + state.productId, value, updatedAt: now }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } }).run();
  }
  private finding(query: Exclude<DiscoveryQuery, { kind: 'bluesky' }>, item: NormalizedItem, now: number): DemandFinding | null {
    if (!/^\d{1,16}$/.test(item.externalId) || !item.postedAt || item.postedAt < now - WINDOW || item.postedAt > now + 60000 || !item.title.trim()) return null;
    // Construct provider permalinks; never trust a search result's arbitrary outbound URL.
    const host = query.kind === 'hn' ? 'news.ycombinator.com' : query.site === 'stackoverflow' ? 'stackoverflow.com' : query.site === 'superuser' ? 'superuser.com' : `${query.site}.stackexchange.com`;
    const url = query.kind === 'hn' ? `https://${host}/item?id=${item.externalId}` : `https://${host}/questions/${item.externalId}`;
    const title = item.title.slice(0, 240); const excerpt = item.body.slice(0, 1400);
    // A launch announcement or a question in a comment's parent headline is not
    // evidence that the author needs help. Keep the actual request text.
    if (query.kind === 'hn' && /^Show HN\s*:/i.test(title)) return null;
    const requestText = (title.startsWith('re: ') ? excerpt : `${title} ${excerpt}`).replace(/https?:\/\/\S+/gi, '');
    const tokens = (query.query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(t => !['how', 'to', 'for', 'with', 'a', 'an', 'the', 'my'].includes(t));
    const requests = [...requestText.matchAll(/\b(looking for|how (?:do|can|could|should|to)|can (?:anyone|someone)|does anyone|any (?:recommendations|suggestions)|recommend (?:a|an|some)|alternatives? to|struggling|need help|anyone know|best way to|is there (?:a|an)|I (?:need|want) (?:a|an|to))\b/gi)];
    const requestLanguage = tokens.length > 0 && requests.some(match => {
      const nearby = requestText.slice(Math.max(0, match.index! - 180), match.index! + 420);
      return tokens.every(token => new RegExp(`\\b${token}${token.length > 2 ? '\\w*' : ''}\\b`, 'i').test(nearby));
    });
    if (!requestLanguage) return null;
    return { id: createHash('sha256').update(url).digest('hex').slice(0, 24), url, title, excerpt, postedAt: item.postedAt, observedAt: now, query: queryLabel(query), kind: query.kind, requestLanguage };
  }
}
