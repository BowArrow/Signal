import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { OutreachJob } from '../../shared/outreach.js';
import { boundedJson } from '../connections/network.js';
import { decodeMailHeader, gmailText, mailboxAddress } from './inbox.js';

const header = z.object({ name: z.string(), value: z.string() });
const internetId = z.string().regex(/^<[^<>\s\r\n]{3,250}>$/);
const gmailId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const graphId = z.string().regex(/^[A-Za-z0-9_+/=-]{1,1024}$/);
const address = z.object({ emailAddress: z.object({ address: z.string() }) });
const gmailMessage = z.object({ id: gmailId, threadId: gmailId, labelIds: z.array(z.string()), payload: z.object({ headers: z.array(header) }).passthrough() });
const graphMessage = z.object({ id: graphId, conversationId: graphId, internetMessageId: internetId.optional(), isDraft: z.boolean(), parentFolderId: graphId, hasAttachments: z.boolean(), subject: z.string(), from: address, sender: address, toRecipients: z.array(address), ccRecipients: z.array(address), bccRecipients: z.array(address), replyTo: z.array(address), body: z.object({ contentType: z.string(), content: z.string() }), internetMessageHeaders: z.array(header) });
const graphSelect = Object.keys(graphMessage.shape).join(',');
const digest = (text: string) => createHash('sha256').update(text.replace(/\r\n/g, '\n').trim()).digest('hex');
function single(headers: z.infer<typeof header>[], name: string) { const values = headers.filter(h => h.name.toLowerCase() === name); return values.length === 1 ? values[0]!.value : ''; }
export function outreachMime(job: OutreachJob) {
  if (mailboxAddress(job.from) !== job.from || mailboxAddress(job.to) !== job.to || /[\r\n]/.test(job.subject) || !/^<[^<>\s\r\n]{3,250}>$/.test(job.internetId) || !/^[a-f0-9]{64}$/.test(job.id)) throw new Error('Invalid outreach headers.');
  if (job.followUp) { internetId.parse(job.followUp.inReplyTo); z.array(internetId).min(1).max(2).parse(job.followUp.references); }
  const chunks: string[] = []; let chunk = '';
  for (const c of job.subject) { if (Buffer.byteLength(chunk + c) > 42) { chunks.push(chunk); chunk = ''; } chunk += c; } if (chunk) chunks.push(chunk);
  const subject = chunks.map(c => `=?UTF-8?B?${Buffer.from(c).toString('base64')}?=`).join('\r\n ');
  const body = Buffer.from(job.body.replace(/\r?\n/g, '\r\n')).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '';
  return Buffer.from([`From: ${job.from}`, `To: ${job.to}`, `Subject: ${subject}`, `Message-ID: ${job.internetId}`, ...(job.followUp ? [`In-Reply-To: ${job.followUp.inReplyTo}`, `References: ${job.followUp.references.join(' ')}`] : []), `X-Signal-Outreach-ID: ${job.id}`, `Date: ${new Date(job.createdAt).toUTCString()}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', 'Auto-Submitted: auto-generated', `List-Unsubscribe: <mailto:${job.from}?subject=unsubscribe>`, '', body].join('\r\n'));
}

/** Outreach transport: one recipient, confirmed thread history, no retry after a write attempt. */
export class OutreachDelivery {
  constructor(private readonly provider: 'gmail' | 'outlook', private readonly token: string, private readonly transport: typeof fetch, private readonly signal: AbortSignal, private readonly allowed: () => void, private readonly history: readonly OutreachJob[] = []) {}
  private async request(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown, mime = false) {
    this.signal.throwIfAborted(); this.allowed();
    const origin = this.provider === 'gmail' ? 'https://gmail.googleapis.com/gmail/v1/users/me' : 'https://graph.microsoft.com/v1.0/me';
    try {
      const response = await this.transport(origin + path, { method, redirect: 'error', signal: AbortSignal.any([this.signal, AbortSignal.timeout(30000)]), headers: { authorization: `Bearer ${this.token}`, 'content-type': mime ? 'text/plain' : 'application/json', ...(this.provider === 'outlook' ? { Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"' } : {}) }, ...(body !== undefined ? { body: mime ? String(body) : JSON.stringify(body) } : {}) });
      if (method === 'POST' && this.provider === 'outlook' && path.endsWith('/send')) { if (response.status !== 202) throw new Error('Send not acknowledged'); await response.body?.cancel(); return {}; }
      if (method === 'POST' && this.provider === 'outlook' && response.status !== 201) throw new Error('Draft not acknowledged');
      return await boundedJson(response);
    } catch { throw new Error('Outreach request could not be confirmed. Check the inbox and reconcile any attempted send.'); }
  }
  private safeId(value: string) { const id = (this.provider === 'gmail' ? gmailId : graphId).parse(value); if (id.includes(this.token)) throw new Error('Invalid provider identifier.'); return id; }
  private async gmailRead(id: string) { const message = gmailMessage.parse(await this.request(`/messages/${encodeURIComponent(this.safeId(id))}?format=full`)); if (message.id !== id) throw new Error('Different Gmail message returned.'); return message; }
  private sameGmail(raw: z.infer<typeof gmailMessage>, job: OutreachJob) {
    const h = raw.payload.headers; const text = gmailText(raw.payload);
    const thread = job.followUp ? raw.threadId === job.followUp.threadId && single(h, 'in-reply-to') === job.followUp.inReplyTo && single(h, 'references').trim().replace(/\s+/g, ' ') === job.followUp.references.join(' ') : !h.some(h => ['in-reply-to', 'references'].includes(h.name.toLowerCase()));
    const actualInternetId = single(h, 'message-id');
    // Gmail may replace the submitted Message-ID. Accept that only for the
    // exact provider ID acknowledged by send, while matching all other fields.
    // Once reconciled, retain the provider's ID for subsequent thread checks.
    const sameId = actualInternetId === (job.providerInternetId ?? job.internetId) || (!job.providerInternetId && raw.id === job.acceptedId && internetId.safeParse(actualInternetId).success);
    return thread && raw.labelIds.includes('SENT') && !text.incomplete && mailboxAddress(single(h, 'from')) === job.from && mailboxAddress(single(h, 'to')) === job.to && sameId && single(h, 'x-signal-outreach-id') === job.id && decodeMailHeader(single(h, 'subject')) === job.subject && !h.some(h => ['cc', 'bcc', 'reply-to'].includes(h.name.toLowerCase())) && digest(text.body) === job.bodyHash;
  }
  private async graphRead(id: string) { const message = graphMessage.parse(await this.request(`/messages/${encodeURIComponent(this.safeId(id))}?${new URLSearchParams({ '$select': graphSelect })}`)); if (message.id !== id) throw new Error('Different Outlook message returned.'); return message; }
  private sameGraph(raw: z.infer<typeof graphMessage>, job: OutreachJob) {
    const thread = job.followUp ? raw.conversationId === job.followUp.threadId && single(raw.internetMessageHeaders, 'in-reply-to') === job.followUp.inReplyTo : !raw.internetMessageHeaders.some(h => h.name.toLowerCase() === 'in-reply-to');
    return thread && !raw.hasAttachments && mailboxAddress(raw.from.emailAddress.address) === job.from && mailboxAddress(raw.sender.emailAddress.address) === job.from && raw.toRecipients.length === 1 && mailboxAddress(raw.toRecipients[0]!.emailAddress.address) === job.to && !raw.ccRecipients.length && !raw.bccRecipients.length && !raw.replyTo.length && raw.subject === job.subject && raw.body.contentType.toLowerCase() === 'text' && digest(raw.body.content) === job.bodyHash && single(raw.internetMessageHeaders, 'x-signal-outreach-id') === job.id;
  }
  async reconcile(job: OutreachJob): Promise<{ id: string; threadId: string; internetId?: string } | null> {
    if (this.provider === 'outlook') {
      if (!job.acceptedId) return null;
      const raw = await this.graphRead(job.acceptedId); if (raw.isDraft) return null;
      const folder = z.object({ id: graphId }).parse(await this.request('/mailFolders/sentitems?$select=id'));
      if (!this.sameGraph(raw, job) || raw.parentFolderId !== folder.id) throw new Error('Outlook sent copy differs from the saved outreach.');
      return { id: raw.id, threadId: raw.conversationId, ...(raw.internetMessageId ? { internetId: raw.internetMessageId } : {}) };
    }
    let id = job.acceptedId;
    if (!id) {
      const query = new URLSearchParams({ q: `in:sent rfc822msgid:${job.internetId}`, maxResults: '2' });
      const result = z.object({ messages: z.array(z.object({ id: gmailId })).max(2).default([]), nextPageToken: z.string().optional() }).parse(await this.request(`/messages?${query}`));
      if (result.nextPageToken || result.messages.length > 1) throw new Error('Multiple messages match this outreach.');
      id = result.messages[0]?.id ?? null; if (!id) return null;
    }
    const raw = await this.gmailRead(id); if (!this.sameGmail(raw, job)) throw new Error('Gmail sent copy differs from the saved outreach.');
    return { id: raw.id, threadId: raw.threadId, internetId: single(raw.payload.headers, 'message-id') };
  }
  async preflight(job: OutreachJob) {
    if (job.followUp) return this.followUpPreflight(job);
    // Check existing conversations as well as Sent Items, including recent inbound opt-outs.
    if (this.provider === 'gmail') {
      const query = new URLSearchParams({ q: `in:anywhere {from:${job.to} to:${job.to} cc:${job.to} bcc:${job.to}}`, maxResults: '1' });
      const found = z.object({ messages: z.array(z.object({ id: gmailId })).default([]) }).parse(await this.request(`/messages?${query}`));
      if (found.messages.length) throw new Error('This inbox has already contacted this recipient. Use the existing conversation.'); return;
    }
    const query = new URLSearchParams({ '$search': JSON.stringify(`participants:${job.to}`), '$select': 'id', '$top': '100' });
    const result = z.object({ value: z.array(z.object({ id: graphId })).max(100), '@odata.nextLink': z.string().optional() }).parse(await this.request(`/messages?${query}`));
    if (result['@odata.nextLink'] || result.value.some(m => m.id !== job.acceptedId)) throw new Error('This inbox has an existing conversation with this contact. Review it in Sales.');
  }
  private async followUpPreflight(job: OutreachJob) {
    if (!job.followUp || this.history.length !== job.followUp.step || this.history.at(-1)?.id !== job.followUp.previousId) throw new Error('Missing confirmed outreach history.');
    const ids = new Set(this.history.map(j => j.acceptedId!));
    if (this.provider === 'gmail') {
      const thread = z.object({ id: gmailId, messages: z.array(gmailMessage).max(100) }).parse(await this.request(`/threads/${encodeURIComponent(this.safeId(job.followUp.threadId))}?format=full`));
      if (thread.id !== job.followUp.threadId || thread.messages.length !== this.history.length || thread.messages.some(m => !ids.has(m.id))) throw new Error('The outreach thread changed. Check replies or manual activity before following up.');
      for (const previous of this.history) { const raw = thread.messages.find(m => m.id === previous.acceptedId); if (!raw || !this.sameGmail(raw, previous)) throw new Error('The earlier sent outreach changed.'); }
      const query = new URLSearchParams({ q: `in:anywhere {from:${job.to} to:${job.to} cc:${job.to} bcc:${job.to}}`, maxResults: '100' });
      const found = z.object({ messages: z.array(z.object({ id: gmailId })).max(100).default([]), nextPageToken: z.string().optional() }).parse(await this.request(`/messages?${query}`));
      if (found.nextPageToken || found.messages.some(m => !ids.has(m.id))) throw new Error('A new conversation or manual message stopped outreach follow-ups.');
      return;
    }
    const folder = z.object({ id: graphId }).parse(await this.request('/mailFolders/sentitems?$select=id'));
    for (const previous of this.history) {
      const raw = await this.graphRead(previous.acceptedId!);
      if (raw.isDraft || raw.parentFolderId !== folder.id || raw.conversationId !== job.followUp.threadId || raw.internetMessageId !== previous.providerInternetId || !this.sameGraph(raw, previous)) throw new Error('The preceding Outlook outreach is not confirmed in the original conversation.');
    }
    const query = new URLSearchParams({ '$search': JSON.stringify(`participants:${job.to}`), '$select': 'id', '$top': '100' });
    const result = z.object({ value: z.array(z.object({ id: graphId })).max(100), '@odata.nextLink': z.string().optional() }).parse(await this.request(`/messages?${query}`));
    if (result['@odata.nextLink'] || result.value.some(m => !ids.has(m.id) && m.id !== job.acceptedId)) throw new Error('A new Outlook conversation or manual message stopped outreach follow-ups.');
  }
  async send(job: OutreachJob, beforeWrite: () => void | Promise<void>, accepted: (id: string) => void, continueAttempt: () => void | Promise<void>) {
    if (job.attemptedAt !== null || job.acceptedId) throw new Error('Outreach was already attempted. Reconciliation only.');
    const existing = await this.reconcile(job); if (existing) return existing;
    await this.preflight(job); const mime = outreachMime(job); this.signal.throwIfAborted(); await beforeWrite();
    if (this.provider === 'gmail') {
      const response = z.object({ id: gmailId }).parse(await this.request('/messages/send', 'POST', { raw: mime.toString('base64url'), ...(job.followUp ? { threadId: job.followUp.threadId } : {}) }));
      accepted(this.safeId(response.id)); const found = await this.reconcile({ ...job, acceptedId: response.id }); if (!found) throw new Error('Sent copy is not available.'); return found;
    }
    const previous = this.history.at(-1);
    const path = job.followUp && previous?.acceptedId ? `/messages/${encodeURIComponent(this.safeId(previous.acceptedId))}/createReply` : '/messages';
    const created = z.object({ id: graphId }).parse(await this.request(path, 'POST', mime.toString('base64'), true));
    const id = this.safeId(created.id); accepted(id); await continueAttempt();
    await this.preflight({ ...job, acceptedId: id }); const draft = await this.graphRead(id); if (!draft.isDraft || !this.sameGraph(draft, job)) throw new Error('The outreach draft changed.');
    await continueAttempt(); await this.request(`/messages/${encodeURIComponent(id)}/send`, 'POST');
    const found = await this.reconcile({ ...job, acceptedId: id }); if (!found) throw new Error('Outlook has not confirmed the sent copy.'); return found;
  }
}
