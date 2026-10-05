import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { SalesReply } from '../../shared/sales-replies.js';
import { boundedJson } from '../connections/network.js';
import { decodeMailHeader, mailboxAddress, gmailText } from './inbox.js';

const messageId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const headers = z.array(z.object({ name: z.string(), value: z.string() }));
const message = z.object({ id: messageId, threadId: messageId, internalDate: z.string().regex(/^\d+$/), labelIds: z.array(z.string()), payload: z.object({ headers, mimeType: z.string().optional() }).passthrough() });
const headerValues = (raw: z.infer<typeof message>, name: string) => raw.payload.headers.filter(h => h.name.toLowerCase() === name).map(h => h.value);
const single = (raw: z.infer<typeof message>, name: string) => { const values = headerValues(raw, name); return values.length === 1 ? values[0]! : ''; };
const internetId = /^<[^<>\s\r\n]{3,250}>$/;
export class ReplyDeliveryError extends Error {}
export function gmailMime(job: SalesReply) {
  if (!internetId.test(job.internetId) || !internetId.test(job.inReplyTo) || mailboxAddress(job.from) !== job.from || mailboxAddress(job.to) !== job.to || /[\r\n]/.test(job.subject)) throw new ReplyDeliveryError('Invalid reply address or header.');
  const chunks: string[] = []; let chunk = '';
  for (const character of job.subject) { if (Buffer.byteLength(chunk + character) > 42) { chunks.push(chunk); chunk = ''; } chunk += character; }
  if (chunk) chunks.push(chunk);
  const subject = chunks.map(value => `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`).join('\r\n ');
  const body = Buffer.from(job.body.replace(/\r?\n/g, '\r\n')).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '';
  return Buffer.from([`From: ${job.from}`, `To: ${job.to}`, `Subject: ${subject}`, `Message-ID: ${job.internetId}`, `In-Reply-To: ${job.inReplyTo}`, `References: ${job.inReplyTo}`, `Date: ${new Date(job.createdAt).toUTCString()}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', 'Auto-Submitted: auto-replied', '', body].join('\r\n')).toString('base64url');
}
export class GmailReplyDelivery {
  private readonly base = 'https://gmail.googleapis.com/gmail/v1/users/me';
  constructor(private readonly token: string, private readonly transport: typeof fetch, private readonly signal: AbortSignal, private readonly mayRead: () => void, private readonly history: SalesReply[] = []) {}
  private async request(path: string, body?: unknown) {
    this.signal.throwIfAborted(); this.mayRead();
    try {
      return await boundedJson(await this.transport(this.base + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, redirect: 'error', signal: AbortSignal.any([this.signal, AbortSignal.timeout(30000)]), ...(body ? { body: JSON.stringify(body) } : {}) }));
    } catch { throw new ReplyDeliveryError('Gmail request could not be confirmed. Check account access and reconcile any attempted send.'); }
  }
  private async readMessage(id: string) { const raw = message.parse(await this.request(`/messages/${encodeURIComponent(messageId.parse(id))}?format=full`)); if (raw.id.includes(this.token)) throw new ReplyDeliveryError('Gmail returned an invalid reply identifier.'); return raw; }
  private sameSent(raw: z.infer<typeof message>, job: SalesReply) {
    const text = gmailText(raw.payload);
    return raw.threadId === job.threadId && raw.labelIds.includes('SENT') && single(raw, 'message-id') === job.internetId && mailboxAddress(single(raw, 'from')) === job.from && mailboxAddress(single(raw, 'to')) === job.to && !headerValues(raw, 'cc').length && !headerValues(raw, 'bcc').length && single(raw, 'in-reply-to') === job.inReplyTo && decodeMailHeader(single(raw, 'subject')) === job.subject && !text.incomplete && createHash('sha256').update(text.body.replace(/\r\n/g, '\n').trim()).digest('hex') === job.bodyHash;
  }
  async reconcile(job: SalesReply): Promise<string | null> {
    if (job.acceptedId) { const raw = await this.readMessage(job.acceptedId); if (!this.sameSent(raw, job)) throw new ReplyDeliveryError('The saved Gmail message does not match this reply.'); return raw.id; }
    const query = new URLSearchParams({ q: `in:sent rfc822msgid:${job.internetId}`, maxResults: '2' });
    const data = z.object({ messages: z.array(z.object({ id: messageId })).max(2).default([]) }).parse(await this.request(`/messages?${query}`));
    if (!data.messages.length) return null;
    if (data.messages.length !== 1) throw new ReplyDeliveryError('Multiple Gmail messages use this reply identifier. Review the mailbox.');
    const raw = await this.readMessage(data.messages[0]!.id); if (!this.sameSent(raw, job)) throw new ReplyDeliveryError('A different message occupies this reply identifier.'); return raw.id;
  }
  async preflight(job: SalesReply) {
    const thread = z.object({ id: messageId, messages: z.array(message).min(1).max(100) }).parse(await this.request(`/threads/${encodeURIComponent(messageId.parse(job.threadId))}?format=full`));
    if (thread.id !== job.threadId) throw new ReplyDeliveryError('Gmail returned a different conversation.');
    const original = thread.messages.find(m => m.id === job.sourceProviderId); if (!original) throw new ReplyDeliveryError('The original incoming message is no longer in this conversation.');
    if (headerValues(original, 'bcc').some(value => value.trim())) throw new ReplyDeliveryError('Messages with Bcc recipients need owner review.');
    if (job.followUp && (!this.history.length || this.history.length !== job.followUp.step || this.history.at(-1)?.id !== job.followUp.previousReplyId)) throw new ReplyDeliveryError('Confirmed sequence history is missing.');
    for (const previous of this.history) { const raw = thread.messages.find(m => m.id === previous.acceptedId); if (!raw || raw.labelIds.some(label => ['TRASH', 'SPAM', 'DRAFT'].includes(label)) || !this.sameSent(raw, previous)) throw new ReplyDeliveryError('A preceding sequence message changed or is missing.'); }
    if (thread.messages.some(m => m.id !== original.id && Number(m.internalDate) >= job.sourceReceivedAt && !this.history.some(previous => previous.acceptedId === m.id && this.sameSent(m, previous)))) throw new ReplyDeliveryError('This conversation has newer activity. Read it before replying.');
    const text = gmailText(original.payload); const replyTo = headerValues(original, 'reply-to');
    const subject = decodeMailHeader(single(original, 'subject'));
    if ((/^re:/i.test(subject) ? subject : `Re: ${subject}`) !== job.subject) throw new ReplyDeliveryError('The conversation subject changed. Review the mailbox.');
    if (original.labelIds.some(label => ['SENT', 'DRAFT', 'SPAM', 'TRASH'].includes(label)) || mailboxAddress(single(original, 'from')) !== job.to || mailboxAddress(single(original, 'to')) !== job.from || headerValues(original, 'cc').length || (replyTo.length && (replyTo.length !== 1 || mailboxAddress(replyTo[0]!) !== job.to)) || single(original, 'message-id') !== job.inReplyTo || Number(original.internalDate) !== job.sourceReceivedAt || text.incomplete || text.body.trim() !== job.sourceBody.trim()) throw new ReplyDeliveryError('The incoming message, recipient, or conversation scope changed. Review the mailbox.');
    if (headerValues(original, 'list-id').length || headerValues(original, 'auto-submitted').some(value => value.toLowerCase() !== 'no')) throw new ReplyDeliveryError('Automatic or list messages require review.');
  }
  async send(job: SalesReply, beforeSend: () => void | Promise<void>, accepted: (id: string) => void): Promise<string> {
    if (job.attemptedAt !== null) throw new ReplyDeliveryError('This reply was already attempted. Reconciliation only.');
    const existing = await this.reconcile(job); if (existing) return existing;
    await this.preflight(job);
    const raw = gmailMime(job); this.signal.throwIfAborted(); await beforeSend();
    const response = z.object({ id: messageId, threadId: messageId }).parse(await this.request('/messages/send', { raw, threadId: job.threadId }));
    if (response.id.includes(this.token)) throw new ReplyDeliveryError('Gmail returned an invalid reply identifier.');
    accepted(response.id); // Persist the accepted ID before another request or possible shutdown.
    if (response.threadId !== job.threadId) throw new ReplyDeliveryError('Gmail accepted the message in a different thread. Review the mailbox.');
    const stored = await this.readMessage(response.id); if (!this.sameSent(stored, job)) throw new ReplyDeliveryError('Gmail accepted a reply but its sent copy has not been confirmed.');
    return response.id;
  }
}
