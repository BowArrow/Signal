import { createHash } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import type { App } from '../app.js';
import { settings, studioLeads } from '../db/schema.js';
import { requireProduct } from '../marketing/store.js';
import { newId } from '../lib/id.js';
import { mailboxAddress } from './inbox.js';
import { isSalesSuppressed } from './suppression.js';
import { prospectConfigSchema, type MailchimpMember, type ProspectState, type ProspectView } from '../../shared/prospects.js';

const SOURCE = 'prospects.source.'; const MEMBER = 'prospects.member.'; const DAY = 86400000;
type Provider = 'mailchimp' | 'signal-blog';
const sourceKey = (productId: string, provider: Provider = 'mailchimp') => (provider === 'signal-blog' ? 'prospects.website.' : SOURCE) + productId;
type Link = { productId: string; email: string; accountId: string; listId: string; status: string; observedAt: number; provider?: Provider };
export class ProspectTemporarilyUnavailable extends Error {}
const memberKey = (productId: string, email: string, provider: Provider = 'mailchimp') => MEMBER + createHash('sha256').update(`${productId}:${email}${provider === 'signal-blog' ? ':website' : ''}`).digest('hex');
export function memberEligible(member: MailchimpMember, permissionId: string) {
  if (member.status !== 'subscribed' || !member.oneToOne) return false;
  if (!permissionId) return member.permissions.length === 0;
  const permissions = member.permissions.filter(p => p.id === permissionId); return permissions.length === 1 && permissions[0]!.enabled;
}
export class ProspectService {
  private active = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  constructor(private readonly app: App) {}
  private get<T>(key: string) { return this.app.db.select().from(settings).where(eq(settings.key, key)).get()?.value as T | undefined; }
  private put(key: string, value: unknown) { this.app.db.insert(settings).values({ key, value, updatedAt: this.app.clock.now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: this.app.clock.now() } }).run(); }
  sources() { return [SOURCE, 'prospects.website.'].flatMap(prefix => this.app.db.select().from(settings).where(like(settings.key, prefix + '%')).all().map(r => r.value as ProspectState)); }
  source(productId: string, provider: Provider = 'mailchimp') { requireProduct(this.app, productId); return this.get<ProspectState>(sourceKey(productId, provider)); }
  view(): ProspectView { return { sources: this.sources(), accounts: this.app.connections?.accounts().filter(a => ['mailchimp', 'signal-blog'].includes(a.provider)) ?? [], offline: this.app.env.SIGNAL_OFFLINE === '1' }; }
  private reader(productId: string, accountId: string, provider: Provider | undefined, signal: AbortSignal) { return provider === 'signal-blog' ? this.app.connections!.websiteProspectReader(productId, accountId, signal) : this.app.connections!.mailchimpReader(productId, accountId, signal); }
  async catalog(productId: string, accountId: string) { return (await this.app.connections!.mailchimpReader(productId, accountId, AbortSignal.timeout(30000))).audiences(); }
  async configure(productId: string, input: unknown) {
    requireProduct(this.app, productId); const value = prospectConfigSchema.parse(input); const old = this.source(productId, value.provider);
    this.app.operations?.pause(productId); this.pause(productId);
    const audience = value.enabled ? await (await this.reader(productId, value.accountId, value.provider, AbortSignal.timeout(30000))).audience(value.listId) : null;
    if ((this.source(productId, value.provider)?.revision ?? 0) !== (old?.revision ?? 0)) throw new Error('Source settings changed while checking the audience. Save again.');
    if (audience && audience.id !== value.listId) throw new Error('Provider returned a different audience.');
    this.put(sourceKey(productId, value.provider), { ...value, productId, revision: (old?.revision ?? 0) + 1, audienceName: audience?.name ?? old?.audienceName ?? value.listId, status: 'idle', detail: value.enabled ? 'Source saved. Run Operations or sync now to read this audience.' : 'Ingestion disabled. Linked contacts are held from automatic email.', watermark: 0, scanSince: 0, scanUntil: null, offset: 0, lastCompleteAt: null, lastFullAt: null, nextAttemptAt: 0, scanned: 0, added: 0, suppressed: 0, ...(value.provider === 'signal-blog' ? { websiteCursor: old?.accountId === value.accountId ? old.websiteCursor ?? 0 : 0, websiteHead: null } : {}) } satisfies ProspectState);
  }
  pause(productId: string) { for (const provider of ['mailchimp', 'signal-blog'] as const) this.active.get(sourceKey(productId, provider))?.controller.abort(); }
  async stop() { for (const work of this.active.values()) work.controller.abort(); await Promise.allSettled([...this.active.values()].map(w => w.promise)); }
  async sync(productId: string, automatic = false, provider: Provider = 'mailchimp') {
    const key = sourceKey(productId, provider);
    if (this.active.has(key)) throw new Error('This audience is already syncing.');
    if (this.app.env.SIGNAL_OFFLINE === '1') throw new Error('Audience reads are disabled offline.');
    const state = this.source(productId, provider); if (!state?.enabled || !this.app.sales) throw new Error('Enable a prospect source first.');
    const controller = new AbortController(); const promise = this.read(state, controller.signal, automatic).finally(() => this.active.delete(key));
    this.active.set(key, { controller, promise }); await promise;
  }
  private async read(original: ProspectState, signal: AbortSignal, automatic: boolean) {
    const productId = original.productId, key = sourceKey(productId, original.provider), website = original.provider === 'signal-blog', label = website ? 'Website' : 'Mailchimp';
    const allowed = () => { signal.throwIfAborted(); const current = this.source(productId, original.provider); if (!current?.enabled || current.revision !== original.revision || (automatic && !this.app.operations?.state(productId).running)) throw new Error('Audience sync paused or changed.'); };
    allowed(); const now = this.app.clock.now();
    const starting = original.scanUntil === null || original.scanUntil < now - DAY;
    const full = !original.lastFullAt || now - original.lastFullAt >= DAY;
    const state: ProspectState = { ...original, status: 'syncing', detail: 'Reading a page from the selected audience.', ...(starting ? { scanSince: full ? 0 : Math.max(0, original.watermark - 120000), scanUntil: now, offset: 0, scanned: 0, added: 0, suppressed: 0 } : {}) };
    this.put(key, state);
    try {
      const page: { members: MailchimpMember[]; next: number | null; cursor?: number; head?: number } = website ? await (await this.app.connections!.websiteProspectReader(productId, state.accountId, signal)).page(state.websiteCursor ?? 0, state.websiteHead) : await (await this.app.connections!.mailchimpReader(productId, state.accountId, signal)).page(state.listId, state.scanSince, state.scanUntil!, state.offset); allowed();
      this.app.db.transaction(() => {
        let added = state.added; let suppressed = state.suppressed;
        for (const member of page.members) {
          const leads = this.app.db.select().from(studioLeads).where(eq(studioLeads.productId, productId)).all().filter(l => mailboxAddress(l.value.contact) === member.email);
          const optOut = ['unsubscribed', 'cleaned'].includes(member.status);
          const eligible = memberEligible(member, state.marketingPermissionId);
          if (optOut) { this.app.sales!.suppress(productId, member.email, `${label} audience ${state.listId}: ${member.status}.`); suppressed++; }
          if (optOut || eligible || leads.length) this.put(memberKey(productId, member.email, state.provider), { productId, email: member.email, accountId: state.accountId, listId: state.listId, status: member.status, observedAt: now, ...(state.provider ? { provider: state.provider } : {}) } satisfies Link);
          if (!eligible || leads.length || isSalesSuppressed(this.app, productId, member.email)) continue;
          const customer = Boolean(this.app.revenue?.purchaseForContact(productId, member.email));
          this.app.db.insert(studioLeads).values({ id: newId(), productId, createdAt: now, value: { name: member.name, contact: member.email, permission: 'opted-in', stage: customer ? 'customer' : 'discovered', followUpAt: null, campaignId: '', source: `${label}: ${state.audienceName} (${state.listId})`, notes: `${label} reported subscribed and consent to one-to-one messaging at ${new Date(now).toISOString()}. Opt-in timestamp: ${member.optedAt || 'not supplied'}.${state.marketingPermissionId ? ` Enabled marketing permission: ${state.marketingPermissionId}.` : ''}${member.notes ? ` Requested task: ${member.notes}` : ''}${member.consentText ? ` Recorded consent: ${member.consentText}` : ''}${member.campaignId ? ` Visitor-supplied campaign: ${member.campaignId} (unverified).` : ''}` } }).run(); added++;
        }
        const finished = page.next === null;
        this.put(key, { ...state, status: finished ? 'current' : 'partial', detail: finished ? 'Scan complete. Eligible new contacts are in the pipeline; existing leads were preserved.' : 'Page saved. Run continues from the saved position.', scanned: state.scanned + page.members.length, added, suppressed, offset: page.next ?? 0, scanUntil: finished ? null : state.scanUntil, watermark: finished ? state.scanUntil! : state.watermark, lastCompleteAt: finished ? now : state.lastCompleteAt, lastFullAt: finished && state.scanSince === 0 ? now : state.lastFullAt, nextAttemptAt: finished ? now + 5 * 60000 : now, ...(page.cursor !== undefined ? { websiteCursor: page.cursor, websiteHead: finished ? null : page.head! } : {}) } satisfies ProspectState);
      });
    } catch {
      if (this.source(productId, state.provider)?.revision === state.revision) this.put(key, { ...state, status: 'attention', detail: signal.aborted ? 'Sync paused. Saved pages remain; resume from the last checkpoint.' : 'Audience sync needs attention. Check connection access, audience and response limits. No partial page was imported.', nextAttemptAt: now + 5 * 60000 } satisfies ProspectState);
    }
  }
  /** Query current consent just before an email write, including contacts imported in earlier sessions. */
  async assertContact(productId: string, email: string, signal: AbortSignal) {
    const contact = mailboxAddress(email); if (!contact) throw new Error('Invalid contact.');
    for (const provider of ['mailchimp', 'signal-blog'] as const) {
    const link = this.get<Link>(memberKey(productId, contact, provider)); if (!link) continue;
    const state = this.source(productId, provider);
    if (!state?.enabled || state.accountId !== link.accountId || state.listId !== link.listId) throw new Error('The original audience source is disabled or changed.');
    let member: MailchimpMember | null;
    try { const reader = await this.reader(productId, state.accountId, provider, signal); member = await reader.contact(state.listId, contact); }
    catch (error) {
      signal.throwIfAborted();
      if (error instanceof Error && (/^Provider returned HTTP (?:429|5\d\d)\./.test(error.message) || error.name === 'TimeoutError' || error instanceof TypeError)) throw new ProspectTemporarilyUnavailable('The audience consent check is temporarily unavailable.');
      throw error;
    }
    signal.throwIfAborted(); if (this.source(productId, provider)?.revision !== state.revision) throw new Error('The audience source changed.');
    if (member && ['unsubscribed', 'cleaned'].includes(member.status)) this.app.sales!.suppress(productId, contact, `${provider === 'signal-blog' ? 'Website' : 'Mailchimp'} pre-send check: ${member.status}.`);
    if (!member || !memberEligible(member, state.marketingPermissionId) || isSalesSuppressed(this.app, productId, contact)) throw new Error('Current audience consent does not permit this email.');
    }
  }
  async tick() {
    if (this.app.env.SIGNAL_OFFLINE === '1') return;
    const source = this.sources().find(s => s.enabled && !this.active.has(sourceKey(s.productId, s.provider)) && s.nextAttemptAt <= this.app.clock.now() && this.app.operations?.state(s.productId).running);
    if (source) await this.sync(source.productId, true, source.provider);
  }
}
