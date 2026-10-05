import { z } from 'zod';
import type { ConnectedAccount } from '../../shared/connections.js';
import type { InboxMessage, InboxPage } from '../../shared/sales.js';
import { boundedJson } from '../connections/network.js';

const id = z.string().min(1).max(1024);
const header = z.object({ name: z.string(), value: z.string() });
const listSchema = z.object({ messages: z.array(z.object({ id })).max(20).default([]), nextPageToken: z.string().max(12000).optional() });
const gmailSchema = z.object({ id, threadId: id, internalDate: z.string().regex(/^\d+$/), labelIds: z.array(z.string()).default([]), payload: z.unknown() });
const address = z.object({ emailAddress: z.object({ address: z.string() }) });
const outlookSchema = z.object({ value: z.array(z.object({ id, conversationId: id, internetMessageId: z.string().default(''), from: address.optional(), subject: z.string().default(''), receivedDateTime: z.string(), isDraft: z.boolean(), parentFolderId: id, body: z.object({ contentType: z.string(), content: z.string() }), internetMessageHeaders: z.array(header).default([]) })).max(20), '@odata.nextLink': z.string().max(16000).optional() });
export function mailboxAddress(value: string): string | null {
  const match = /^\s*(?:[^<>\r\n]*<([^<>\r\n]+)>|([^<>\s]+))\s*$/.exec(value);
  const candidate = (match?.[1] ?? match?.[2] ?? '').toLowerCase();
  return z.string().email().max(254).safeParse(candidate).success ? candidate : null;
}
/** Exactly one visible addressee. Ambiguous/group/Bcc mail is never auto-routed. */
export function singleRecipient(headers: { name: string; value: string }[]): string | null {
  const to = headers.filter(h => h.name.toLowerCase() === 'to');
  if (to.length !== 1 || headers.some(h => ['cc', 'bcc'].includes(h.name.toLowerCase()) && h.value.trim())) return null;
  return mailboxAddress(to[0]!.value);
}
export function decodeMailHeader(value: string): string {
  return value.replace(/\?=\s+(?==\?)/g, '?=').replace(/=\?([^?\s]+)\?([bq])\?([^?]*)\?=/gi, (original: string, charset: string, encoding: string, encoded: string) => {
    try {
      if (encoding.toLowerCase() === 'b' && !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return original;
      const bytes = encoding.toLowerCase() === 'b' ? Buffer.from(encoded, 'base64') : Buffer.from(encoded.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16))), 'latin1');
      return new TextDecoder(charset, { fatal: true }).decode(bytes);
    } catch { return original; }
  });
}
// This produces inert plain text. No HTML is rendered and no URLs or attachments are fetched.
export function inboxPlainText(value: string): string {
  // eslint-disable-next-line no-control-regex -- Remove non-printing control bytes from untrusted mail.
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|lt|gt|quot|apos);/gi, entity => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }[entity.toLowerCase()] ?? ' ')).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
}
function gmailBody(value: unknown, depth = 0): { plain: string[]; html: string[]; incomplete: boolean } {
  if (depth > 12) return { plain: [], html: [], incomplete: true };
  const parsed = z.object({ mimeType: z.string().default(''), filename: z.string().default(''), body: z.object({ data: z.string().optional(), attachmentId: z.string().optional() }).default({}), parts: z.array(z.unknown()).max(100).default([]) }).parse(value);
  if (parsed.filename) return { plain: [], html: [], incomplete: false }; // No attachment ingestion.
  const result = { plain: [] as string[], html: [] as string[], incomplete: Boolean(parsed.body.attachmentId && parsed.mimeType.startsWith('text/')) };
  if (parsed.body.data && ['text/plain', 'text/html'].includes(parsed.mimeType)) {
    if (!/^[A-Za-z0-9_\-=]*$/.test(parsed.body.data)) throw new Error('Invalid message encoding.');
    result[parsed.mimeType === 'text/plain' ? 'plain' : 'html'].push(Buffer.from(parsed.body.data, 'base64url').toString('utf8'));
  }
  for (const part of parsed.parts) { const nested = gmailBody(part, depth + 1); result.plain.push(...nested.plain); result.html.push(...nested.html); result.incomplete ||= nested.incomplete; }
  return result;
}
export function gmailText(value: unknown) {
  const parts = gmailBody(value);
  const body = parts.plain.length ? parts.plain.join('\n').trim() : inboxPlainText(parts.html.join('\n'));
  return { body, incomplete: parts.incomplete || !body || body.includes('\uFFFD') };
}
const flags = (headers: { name: string; value: string }[], from: string) => {
  const get = (name: string) => headers.filter(h => h.name.toLowerCase() === name).map(h => h.value).join(' ');
  const bounce = /^(?:mailer-daemon|postmaster)@/i.test(from) || /delivery-status/i.test(get('content-type'));
  const automated = bounce || Boolean(get('list-id')) || /(?:bulk|list|junk)/i.test(get('precedence')) || Boolean(get('auto-submitted') && get('auto-submitted').toLowerCase() !== 'no');
  return { get, bounce, automated };
};
export class InboxReader {
  constructor(private readonly account: ConnectedAccount, private readonly token: string, private readonly transport: typeof fetch, private readonly signal: AbortSignal, private readonly allowed: () => void, private readonly secrets: string[] = [], private readonly recipient?: string) {}
  private scrub(value: string) { return [this.token, ...this.secrets].filter(Boolean).reduce((out, secret) => out.replaceAll(secret, '[redacted]'), value); }
  private async get(url: string, graph = false) {
    this.signal.throwIfAborted(); this.allowed();
    return boundedJson(await this.transport(url, { method: 'GET', headers: { authorization: `Bearer ${this.token}`, ...(graph ? { Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"' } : {}) }, redirect: 'error', signal: AbortSignal.any([this.signal, AbortSignal.timeout(20000)]) }));
  }
  async page(since: number, until: number, cursor: string): Promise<InboxPage> {
    const mailbox = mailboxAddress(this.account.identity); if (!mailbox) throw new Error('Verify a mailbox email identity first.');
    const messages: InboxMessage[] = [];
    const append = (message: InboxMessage) => {
      if (message.from === mailbox || message.from === this.recipient || message.receivedAt < since || message.receivedAt >= until) return;
      if ([this.token, ...this.secrets].filter(Boolean).some(secret => [message.providerId, message.threadId].some(value => value.includes(secret)))) throw new Error('Invalid mailbox message identifier.');
      messages.push({ ...message, from: this.scrub(message.from), subject: this.scrub(message.subject).slice(0, 500), body: this.scrub(message.body).slice(0, 12000), internetId: this.scrub(message.internetId).slice(0, 1024), truncated: message.truncated || message.body.length > 12000 });
    };
    if (this.account.provider === 'gmail') {
      const base = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
      const url = new URL(base); url.searchParams.set('maxResults', '20'); url.searchParams.set('includeSpamTrash', 'false');
      if (this.recipient && mailboxAddress(this.recipient) !== this.recipient) throw new Error('Invalid inbox recipient filter.');
      url.searchParams.set('q', `after:${Math.floor(since / 1000) - 1} before:${Math.ceil(until / 1000)} -in:sent -in:drafts${this.recipient ? ` to:${this.recipient}` : ''}`); if (cursor) url.searchParams.set('pageToken', cursor);
      const data = listSchema.parse(await this.get(url.toString()));
      for (const item of data.messages) {
        const raw = await this.get(`${base}/${encodeURIComponent(item.id)}?format=full`); const message = gmailSchema.parse(raw);
        if (message.id !== item.id) throw new Error('Mailbox returned a different message.');
        if (message.labelIds.some(label => ['SENT', 'DRAFT', 'SPAM', 'TRASH'].includes(label))) continue;
        const headers = z.object({ headers: z.array(header).default([]) }).parse(message.payload).headers;
        const recipient = singleRecipient(headers);
        if (this.recipient && recipient !== this.recipient) continue;
        const fromHeaders = headers.filter(h => h.name.toLowerCase() === 'from'); const from = fromHeaders.length === 1 ? mailboxAddress(fromHeaders[0]!.value) : null;
        if (!from) continue;
        const { get, automated, bounce } = flags(headers, from); const parts = gmailBody(message.payload);
        const body = parts.plain.length ? parts.plain.join('\n').trim() : inboxPlainText(parts.html.join('\n'));
        const receivedAt = Number(message.internalDate); if (!Number.isSafeInteger(receivedAt)) throw new Error('Invalid received timestamp.');
        append({ providerId: message.id, threadId: message.threadId, internetId: get('message-id'), from, ...(recipient ? { recipient } : {}), subject: decodeMailHeader(get('subject')), body, receivedAt, automated, bounce, truncated: parts.incomplete || !body || body.includes('\uFFFD') });
      }
      return { messages, next: data.nextPageToken ?? '', scanned: data.messages.length };
    }
    if (this.account.provider !== 'outlook') throw new Error('Choose Gmail or Outlook.');
    const base = 'https://graph.microsoft.com/v1.0/me/messages';
    const url = new URL(cursor || base);
    // Never forward credentials to a provider-supplied host/path or other user's mailbox.
    if (url.origin !== 'https://graph.microsoft.com' || url.pathname !== '/v1.0/me/messages' || url.username || url.password || url.hash) throw new Error('Unexpected mailbox continuation URL.');
    if (!cursor) {
      url.searchParams.set('$top', '20'); url.searchParams.set('$orderby', 'receivedDateTime asc');
      url.searchParams.set('$filter', `receivedDateTime ge ${new Date(since).toISOString()} and receivedDateTime lt ${new Date(until).toISOString()}`);
      url.searchParams.set('$select', 'id,conversationId,internetMessageId,from,subject,receivedDateTime,isDraft,parentFolderId,body,internetMessageHeaders');
    }
    const excluded = new Set<string>();
    for (const folder of ['junkemail', 'deleteditems', 'sentitems', 'drafts']) excluded.add(z.object({ id }).parse(await this.get(`https://graph.microsoft.com/v1.0/me/mailFolders/${folder}?$select=id`, true)).id);
    const data = outlookSchema.parse(await this.get(url.toString(), true));
    for (const message of data.value) {
      if (message.isDraft || excluded.has(message.parentFolderId)) continue;
      const from = mailboxAddress(message.from?.emailAddress.address ?? ''); if (!from) continue;
      const receivedAt = Date.parse(message.receivedDateTime); if (!Number.isSafeInteger(receivedAt)) throw new Error('Invalid received timestamp.');
      const { automated, bounce } = flags(message.internetMessageHeaders, from);
      const body = message.body.contentType.toLowerCase() === 'text' ? message.body.content : inboxPlainText(message.body.content);
      append({ providerId: message.id, threadId: message.conversationId, internetId: message.internetMessageId, from, subject: message.subject, body, receivedAt, automated, bounce, truncated: !body });
    }
    return { messages, next: data['@odata.nextLink'] ?? '', scanned: data.value.length };
  }
}
