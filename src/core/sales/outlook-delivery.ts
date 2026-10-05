import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { SalesReply } from '../../shared/sales-replies.js';
import { boundedJson } from '../connections/network.js';
import { gmailMime, ReplyDeliveryError } from './gmail-delivery.js';
import { inboxPlainText, mailboxAddress } from './inbox.js';

const id = z.string().regex(/^[A-Za-z0-9_+/=-]{1,1024}$/);
const address = z.object({ emailAddress: z.object({ address: z.string().max(500) }) });
const date = z.string().refine(value => Number.isSafeInteger(Date.parse(value)));
const message = z.object({
  id, conversationId: id, internetMessageId: z.string().max(1024), parentFolderId: id,
  isDraft: z.boolean(), hasAttachments: z.boolean(), subject: z.string().max(1000),
  from: address, sender: address, toRecipients: z.array(address).max(100), ccRecipients: z.array(address).max(100), bccRecipients: z.array(address).max(100), replyTo: z.array(address).max(100),
  receivedDateTime: date, sentDateTime: date, createdDateTime: date,
  body: z.object({ contentType: z.string(), content: z.string().max(100000) }),
  internetMessageHeaders: z.array(z.object({ name: z.string().max(1000), value: z.string().max(16000) })).max(500),
});
type Message = z.infer<typeof message>;
const select = Object.keys(message.shape).join(',');
const header = (m: Message, name: string) => m.internetMessageHeaders.filter(h => h.name.toLowerCase() === name).map(h => h.value);
const singleHeader = (m: Message, name: string) => { const values = header(m, name); return values.length === 1 ? values[0]! : ''; };
const plain = (m: Message) => m.body.contentType.toLowerCase() === 'text' ? m.body.content : inboxPlainText(m.body.content);

/** Immutable draft IDs survive send. A missing response never causes another write attempt. */
export class OutlookReplyDelivery {
  private readonly base = 'https://graph.microsoft.com/v1.0/me';
  constructor(private readonly token: string, private readonly transport: typeof fetch, private readonly signal: AbortSignal, private readonly mayRead: () => void, private readonly history: SalesReply[] = []) {}
  private safeId(value: string) { const parsed = id.parse(value); if (parsed.includes(this.token)) throw new ReplyDeliveryError('Outlook returned an invalid identifier.'); return parsed; }
  private async request(path: string, method: 'GET' | 'POST' = 'GET', mime?: string) {
    this.signal.throwIfAborted(); this.mayRead();
    try {
      const response = await this.transport(this.base + path, { method, headers: { authorization: `Bearer ${this.token}`, Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"', ...(mime ? { 'content-type': 'text/plain' } : method === 'POST' ? { 'content-length': '0' } : {}) }, ...(mime ? { body: mime } : {}), redirect: 'error', signal: AbortSignal.any([this.signal, AbortSignal.timeout(30000)]) });
      if (method === 'POST' && !mime) {
        if (response.status !== 202) throw new Error('Send not acknowledged');
        await response.body?.cancel(); return {};
      }
      if (method === 'POST' && response.status !== 201) throw new Error('Draft not acknowledged');
      const result = await boundedJson(response); this.signal.throwIfAborted(); this.mayRead(); return result;
    } catch { throw new ReplyDeliveryError('Outlook request could not be confirmed. Check account access and reconcile any attempted reply.'); }
  }
  private async readMessage(value: string) {
    const raw = message.parse(await this.request(`/messages/${encodeURIComponent(this.safeId(value))}?${new URLSearchParams({ '$select': select })}`));
    if (this.safeId(raw.id) !== value) throw new ReplyDeliveryError('Outlook returned a different message.'); return raw;
  }
  private async folder(name: 'sentitems' | 'junkemail' | 'deleteditems' | 'drafts') { return this.safeId(z.object({ id }).parse(await this.request(`/mailFolders/${name}?$select=id`)).id); }
  private sameContent(raw: Message, job: SalesReply) {
    return raw.conversationId === job.threadId && !raw.hasAttachments && raw.subject === job.subject && mailboxAddress(raw.from.emailAddress.address) === job.from && mailboxAddress(raw.sender.emailAddress.address) === job.from && raw.toRecipients.length === 1 && mailboxAddress(raw.toRecipients[0]!.emailAddress.address) === job.to && !raw.ccRecipients.length && !raw.bccRecipients.length && (!raw.replyTo.length || (raw.replyTo.length === 1 && mailboxAddress(raw.replyTo[0]!.emailAddress.address) === job.from)) && singleHeader(raw, 'in-reply-to') === job.inReplyTo && raw.body.contentType.toLowerCase() === 'text' && createHash('sha256').update(raw.body.content.replace(/\r\n/g, '\n').trim()).digest('hex') === job.bodyHash;
  }
  private sameSent(raw: Message, job: SalesReply, sentFolder: string) { return !raw.isDraft && raw.parentFolderId === sentFolder && this.sameContent(raw, job); }
  async reconcile(job: SalesReply): Promise<string | null> {
    // The createReply response must be recorded before /send is ever called.
    // If that response was lost, this worker did not send the draft.
    if (!job.acceptedId) return null;
    const raw = await this.readMessage(job.acceptedId);
    if (raw.isDraft) return null;
    if (!this.sameSent(raw, job, await this.folder('sentitems'))) throw new ReplyDeliveryError('The saved Outlook sent copy does not match this reply.');
    return raw.id;
  }
  async preflight(job: SalesReply, ownDraftId?: string) {
    this.safeId(job.threadId); this.safeId(job.sourceProviderId);
    const folders = { sent: await this.folder('sentitems'), junk: await this.folder('junkemail'), deleted: await this.folder('deleteditems'), drafts: await this.folder('drafts') };
    const query = new URLSearchParams({ '$filter': `conversationId eq '${job.threadId}'`, '$select': select, '$top': '100' });
    const thread = z.object({ value: z.array(message).min(1).max(100), '@odata.nextLink': z.string().optional() }).parse(await this.request(`/messages?${query}`));
    if (thread['@odata.nextLink'] || new Set(thread.value.map(m => m.id)).size !== thread.value.length || thread.value.some(m => m.conversationId !== job.threadId)) throw new ReplyDeliveryError('The full Outlook conversation could not be verified.');
    const original = thread.value.find(m => m.id === job.sourceProviderId);
    if (!original) throw new ReplyDeliveryError('The original Outlook inquiry is no longer available.');
    if (job.followUp && (this.history.length !== job.followUp.step || this.history.at(-1)?.id !== job.followUp.previousReplyId)) throw new ReplyDeliveryError('Confirmed sequence history is missing.');
    for (const previous of this.history) { const raw = thread.value.find(m => m.id === previous.acceptedId); if (!raw || !this.sameSent(raw, previous, folders.sent)) throw new ReplyDeliveryError('A preceding sequence message changed or is missing.'); }
    if (thread.value.some(m => m.id !== original.id && m.id !== ownDraftId && Math.max(Date.parse(m.receivedDateTime), Date.parse(m.sentDateTime), Date.parse(m.createdDateTime)) >= job.sourceReceivedAt && !this.history.some(previous => previous.acceptedId === m.id && this.sameSent(m, previous, folders.sent)))) throw new ReplyDeliveryError('This Outlook conversation has newer activity. Review it before replying.');
    if (ownDraftId) { const raw = thread.value.find(m => m.id === ownDraftId); if (!raw || !raw.isDraft || raw.parentFolderId !== folders.drafts || !this.sameContent(raw, job)) throw new ReplyDeliveryError('The reply draft changed before sending.'); }
    if (original.isDraft || Object.values(folders).includes(original.parentFolderId) || mailboxAddress(original.from.emailAddress.address) !== job.to || mailboxAddress(original.sender.emailAddress.address) !== job.to || original.toRecipients.length !== 1 || mailboxAddress(original.toRecipients[0]!.emailAddress.address) !== job.from || original.ccRecipients.length || original.bccRecipients.length || (original.replyTo.length && (original.replyTo.length !== 1 || mailboxAddress(original.replyTo[0]!.emailAddress.address) !== job.to)) || original.internetMessageId !== job.inReplyTo || Date.parse(original.receivedDateTime) !== job.sourceReceivedAt || plain(original).trim() !== job.sourceBody.trim() || (/^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`) !== job.subject) throw new ReplyDeliveryError('The incoming Outlook message or recipient scope changed.');
    if (header(original, 'list-id').length || header(original, 'auto-submitted').some(v => v.toLowerCase() !== 'no') || header(original, 'precedence').some(v => /bulk|list|junk/i.test(v))) throw new ReplyDeliveryError('Automatic or list messages require review.');
    return folders;
  }
  async send(job: SalesReply, beforeSend: () => void | Promise<void>, accepted: (id: string) => void, continueAttempt: () => void | Promise<void>): Promise<string> {
    if (job.attemptedAt !== null || job.acceptedId) throw new ReplyDeliveryError('This reply was already attempted. Reconciliation only.');
    await this.preflight(job);
    const mime = Buffer.from(gmailMime(job), 'base64url').toString('base64');
    this.signal.throwIfAborted(); await beforeSend(); // Reserve the whole two-step operation durably before creating any draft.
    const created = z.object({ id }).parse(await this.request(`/messages/${encodeURIComponent(this.safeId(job.sourceProviderId))}/createReply`, 'POST', mime));
    const draftId = this.safeId(created.id); accepted(draftId); // Persist before another request, especially /send.
    await continueAttempt();
    await this.preflight(job, draftId); // Includes the newly created draft and a second check for human activity.
    const draft = await this.readMessage(draftId);
    if (!draft.isDraft || !this.sameContent(draft, job)) throw new ReplyDeliveryError('The Outlook draft changed before sending.');
    this.signal.throwIfAborted(); await continueAttempt();
    await this.request(`/messages/${encodeURIComponent(draftId)}/send`, 'POST');
    const found = await this.reconcile({ ...job, acceptedId: draftId });
    if (!found) throw new ReplyDeliveryError('Outlook accepted the send but its sent copy is not ready.');
    return found;
  }
}
