import { createHash } from 'node:crypto';
import { z } from 'zod';
import { boundedJson } from '../connections/network.js';
import { audienceId, type MailchimpAudience, type MailchimpMember } from '../../shared/prospects.js';

const audience = z.object({ id: audienceId, name: z.string().min(1).max(200) });
const member = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/), email_address: z.string().email().max(254), list_id: audienceId,
  full_name: z.string().max(1000).default(''), status: z.enum(['subscribed', 'unsubscribed', 'cleaned', 'pending', 'transactional', 'archived']),
  consents_to_one_to_one_messaging: z.boolean().default(false), timestamp_opt: z.string().max(50).default(''), last_changed: z.string().datetime({ offset: true }),
  marketing_permissions: z.array(z.object({ marketing_permission_id: z.string().min(1).max(100), enabled: z.boolean() })).max(100).default([]),
});
const fields = Object.keys(member.shape).join(',');
export class MailchimpReader {
  private origin: string;
  constructor(private readonly token: string, private readonly transport: typeof fetch, private readonly signal: AbortSignal, private readonly allowed: () => void) {
    const dc = /-(us\d{1,6})$/.exec(token)?.[1]; if (!dc) throw new Error('Use a Mailchimp API key with its data-center suffix.');
    this.origin = `https://${dc}.api.mailchimp.com/3.0`;
  }
  private async get(path: string, missing = false) {
    this.signal.throwIfAborted(); this.allowed();
    const response = await this.transport(this.origin + path, { method: 'GET', redirect: 'error', headers: { authorization: `Basic ${Buffer.from(`signal:${this.token}`).toString('base64')}` }, signal: AbortSignal.any([this.signal, AbortSignal.timeout(30000)]) });
    this.signal.throwIfAborted(); this.allowed();
    if (missing && response.status === 404) { await response.body?.cancel(); return null; }
    const data = await boundedJson(response); this.signal.throwIfAborted(); this.allowed();
    if (JSON.stringify(data).includes(this.token)) throw new Error('Mailchimp response unexpectedly contained credential data.');
    return data;
  }
  async audiences(): Promise<MailchimpAudience[]> {
    const response = z.object({ lists: z.array(audience).max(100), total_items: z.number().int().nonnegative() }).parse(await this.get('/lists?count=100&fields=lists.id,lists.name,total_items'));
    if (response.total_items > 100) throw new Error('This account has more than 100 audiences. Use a dedicated business account.');
    if (new Set(response.lists.map(l => l.id)).size !== response.lists.length) throw new Error('Mailchimp returned duplicate audiences.');
    return response.lists;
  }
  async audience(id: string) { return audience.parse(await this.get(`/lists/${audienceId.parse(id)}?fields=id,name`)); }
  private normalize(raw: unknown, listId: string): MailchimpMember {
    const value = member.parse(raw); const email = value.email_address.trim().toLowerCase();
    if (value.list_id !== listId || value.id !== createHash('md5').update(email).digest('hex')) throw new Error('Mailchimp returned a mismatched contact identity.');
    return { id: value.id, email, name: (value.full_name.trim() || email).slice(0, 200), listId: value.list_id, status: value.status, oneToOne: value.consents_to_one_to_one_messaging, optedAt: value.timestamp_opt, changedAt: value.last_changed, permissions: value.marketing_permissions.map(p => ({ id: p.marketing_permission_id, enabled: p.enabled })) };
  }
  async page(listId: string, since: number, until: number, offset: number) {
    audienceId.parse(listId);
    if (![since, until, offset].every(Number.isSafeInteger) || since < 0 || until < since || offset < 0 || offset >= 10000) throw new Error('Invalid audience scan range.');
    const query = new URLSearchParams({ count: '100', offset: String(offset), before_last_changed: new Date(until).toISOString(), sort_field: 'last_changed', sort_dir: 'ASC', fields: `members.${fields.split(',').join(',members.')},total_items` });
    if (since) query.set('since_last_changed', new Date(since).toISOString());
    const response = z.object({ members: z.array(z.unknown()).max(100), total_items: z.number().int().min(0).max(10000) }).parse(await this.get(`/lists/${listId}/members?${query}`));
    const members = response.members.map(m => this.normalize(m, listId));
    if (new Set(members.map(m => m.id)).size !== members.length || members.some(m => Date.parse(m.changedAt) > until || Date.parse(m.changedAt) < since) || (!members.length && response.total_items > offset)) throw new Error('Mailchimp returned an inconsistent scan page.');
    return { members, next: offset + members.length < response.total_items ? offset + members.length : null };
  }
  async contact(listId: string, email: string) {
    const normalized = z.string().email().max(254).parse(email).toLowerCase();
    const raw = await this.get(`/lists/${audienceId.parse(listId)}/members/${createHash('md5').update(normalized).digest('hex')}?fields=${fields}`, true);
    const result = raw ? this.normalize(raw, listId) : null;
    if (result && result.email !== normalized) throw new Error('Mailchimp returned a different contact.'); return result;
  }
}
