import { createHash } from 'node:crypto';
import { z } from 'zod';
import { boundedJson } from '../connections/network.js';
import type { MailchimpMember } from '../../shared/prospects.js';

const seq = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const record = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), email: z.string().email().max(254), name: z.string().min(1).max(254), goal: z.string().max(600), campaign: z.string().max(128), status: z.enum(['subscribed', 'unsubscribed']), verified: z.boolean(), consentVersion: z.string().min(1).max(100), consentText: z.string().min(20).max(1000), source: z.string().url(), optedAt: z.string().max(50), changedAt: z.string().datetime(), seq });
const hash = (email: string) => createHash('sha256').update(email).digest('hex');
export class WebsiteProspectReader {
  constructor(private readonly origin: string, private readonly product: string, private readonly token: string, private readonly transport: typeof fetch, private readonly signal: AbortSignal, private readonly allowed: () => void) {
    if (!({ lemonade: 'https://siplemona.de', cinegen: 'https://cinegenaimedia.com' } as Record<string, string>)[product] || ({ lemonade: 'https://siplemona.de', cinegen: 'https://cinegenaimedia.com' } as Record<string, string>)[product] !== origin) throw new Error('Unsupported business website.');
  }
  private async get(path: string, missing = false) {
    this.signal.throwIfAborted(); this.allowed();
    const response = await this.transport(this.origin + '/api/prospects' + path, { method: 'GET', redirect: 'error', headers: { authorization: `Bearer ${this.token}` }, signal: AbortSignal.any([this.signal, AbortSignal.timeout(30000)]) });
    this.signal.throwIfAborted(); this.allowed();
    if (missing && response.status === 404) { await response.body?.cancel(); return null; }
    const result = await boundedJson(response); this.signal.throwIfAborted(); this.allowed();
    if (JSON.stringify(result).includes(this.token)) throw new Error('Website response contained credential data.');
    if (z.object({ product: z.literal(this.product) }).safeParse(result).success === false) throw new Error('Website returned a different business.');
    return result;
  }
  async audience(id: string) {
    if (id !== 'website') throw new Error('Choose the website request source.');
    const value = z.object({ id: z.literal('website'), name: z.string().min(1).max(200), signupUrl: z.literal(this.origin + '/get-started'), consentVersion: z.string().min(1).max(100) }).parse(await this.get('/meta'));
    return { id: value.id, name: value.name };
  }
  private member(raw: unknown): MailchimpMember {
    const value = record.parse(raw), email = value.email.trim().toLowerCase();
    const name = this.product === 'lemonade' ? 'Lemonade' : 'CineGen';
    const expectedConsent = `Email me product guidance and promotional follow-ups from ${name}, including personal messages from its AI assistant. I can opt out at any time by replying stop or returning to this page.`;
    if (hash(email) !== value.id || value.source !== this.origin + '/get-started' || (value.status === 'subscribed' && (!value.optedAt || !Number.isFinite(Date.parse(value.optedAt)) || Date.parse(value.optedAt) > Date.parse(value.changedAt)))) throw new Error('Website consent record is inconsistent.');
    return { id: value.id, email, name: value.name.slice(0, 200), listId: 'website', status: value.status, oneToOne: value.verified && value.consentVersion === 'website-help-2026-09-17' && value.consentText === expectedConsent, optedAt: value.optedAt, changedAt: value.changedAt, permissions: [], notes: value.goal, campaignId: value.campaign, consentText: value.consentText };
  }
  async page(after: number, head?: number | null) {
    seq.parse(after); if (head != null) { seq.parse(head); if (head < after) throw new Error('Invalid website cursor.'); }
    const params = new URLSearchParams({ after: String(after), ...(head != null ? { head: String(head) } : {}) });
    const value = z.object({ records: z.array(record).max(100), cursor: seq, head: seq, hasMore: z.boolean() }).parse(await this.get('/changes?' + params));
    if (value.cursor < after || value.head < value.cursor || (head != null && head !== value.head) || value.hasMore !== (value.cursor < value.head) || (value.hasMore && value.records.length !== 100)) throw new Error('Website returned an inconsistent page.');
    let previous = after;
    for (const row of value.records) { if (row.seq !== previous + 1 || row.seq > value.head) throw new Error('Website change history has a gap.'); previous = row.seq; }
    if (previous !== value.cursor) throw new Error('Website cursor does not match its records.');
    return { members: value.records.map(r => this.member(r)), cursor: value.cursor, head: value.head, next: value.hasMore ? value.cursor : null };
  }
  async contact(_listId: string, email: string) {
    const normalized = z.string().email().max(254).parse(email).toLowerCase();
    const value = await this.get('/contacts/' + hash(normalized), true); if (!value) return null;
    const member = this.member(z.object({ contact: record }).parse(value).contact);
    if (member.email !== normalized) throw new Error('Website returned a different contact.'); return member;
  }
}
