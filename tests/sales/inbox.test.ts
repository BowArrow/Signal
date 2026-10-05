import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock, DAY } from '../../src/core/lib/clock.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { ConnectionService, type CredentialVault } from '../../src/core/connections/service.js';
import { SalesService } from '../../src/core/sales/service.js';
import { InboxReader, mailboxAddress, decodeMailHeader } from '../../src/core/sales/inbox.js';
import { studioAction, studioView } from '../../src/core/studio/store.js';
import { settings, studioLeads } from '../../src/core/db/schema.js';
import { OperationsService } from '../../src/core/operations/service.js';
import type { LlmClient } from '../../src/core/llm/client.js';
import type { SalesMessage } from '../../src/shared/sales.js';

class Vault implements CredentialVault { data = new Map<string, string>(); available() { return true; } get(key: string) { return this.data.get(key); } set(key: string, value: string) { this.data.set(key, value); } delete(key: string) { this.data.delete(key); } }
let app: App; let service: SalesService; let connection: ConnectionService; let clock: ReturnType<typeof fixedClock>;
let send: ReturnType<typeof vi.fn<typeof fetch>>; let complete: ReturnType<typeof vi.fn<LlmClient['complete']>>;
let productId: string; let accountId: string; let data: Record<string, unknown>[]; let next: string;
const gmail = (id: string, body = 'Can I try the product?', extra: Record<string, unknown> = {}) => ({ id, threadId: `thread-${id}`, internalDate: String(clock.now() - 1000), labelIds: ['INBOX', 'UNREAD'], payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'Buyer <buyer@example.com>' }, { name: 'Subject', value: 'Product question' }, { name: 'Message-ID', value: `<${id}@example.com>` }], body: { data: Buffer.from(body).toString('base64url') } }, ...extra });
beforeEach(async () => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); clock = fixedClock(1789610000000); app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger }); data = []; next = '';
  send = vi.fn(async (input, init) => {
    const url = new URL(String(input)); expect(init?.method ?? 'GET').toBe('GET'); expect(init?.redirect).toBe('error');
    if (url.pathname.endsWith('/profile')) return Response.json({ emailAddress: 'sales@example.org' });
    if (url.pathname.endsWith('/messages')) return Response.json({ messages: data.map(d => ({ id: d['id'] })), ...(next ? { nextPageToken: next } : {}) });
    const record = data.find(d => d['id'] === decodeURIComponent(url.pathname.split('/').at(-1)!)); if (record) return Response.json(record);
    throw new Error('Unexpected network request');
  });
  connection = new ConnectionService(app, new Vault(), undefined, send); app.connections = connection; productId = connection.view().products[0]!.id;
  await connection.connect({ productId, provider: 'gmail', label: 'Sales inbox', credential: 'fixture-secret-token' }); accountId = connection.accounts()[0]!.id;
  complete = vi.fn(async () => ({ text: JSON.stringify({ category: 'inquiry', summary: 'The sender asks to try the product.', evidence: 'Can I try the product?' }), inputTokens: 10, outputTokens: 10, model: 'fixture', stopReason: 'stop' }));
  service = new SalesService(app, { complete, available: () => ({ ready: true }) }); app.sales = service;
  service.configure(productId, { accountId, since: clock.now() - DAY, autoSync: true, aiTriage: true });
});
afterEach(async () => { await service.stop(); app.close(); vi.unstubAllEnvs(); __setConfigForTests(null); });
function lead(email = 'buyer@example.com') {
  studioAction(app, { type: 'lead', productId, value: { name: 'Buyer', contact: email, stage: 'contacted', permission: 'existing-conversation', source: 'Owner conversation', notes: '', followUpAt: clock.now() + DAY, campaignId: '' } });
  const row = studioView(app).leads.find(l => l.value.contact === email)!;
  app.db.update(studioLeads).set({ createdAt: clock.now() - 5000 }).where(eq(studioLeads.id, row.id)).run(); return row.id;
}
it('reads received mail without marking it read, stops a matching follow-up, and saves no credentials', async () => {
  const id = lead(); data = [gmail('m1', 'Can I try the product? fixture-secret-token')]; await service.sync(productId, accountId);
  expect(service.source(productId, accountId).status).toBe('current');
  expect(studioView(app).leads.find(l => l.id === id)!.value).toMatchObject({ followUpAt: null, stage: 'replied' });
  expect(service.messages(productId)[0]).toMatchObject({ leadId: id, category: 'pending', body: 'Can I try the product? [redacted]' });
  expect(JSON.stringify(app.db.select().from(settings).all())).not.toContain('fixture-secret-token');
  expect(JSON.stringify(service.context(productId))).not.toContain('buyer@example.com');
  expect(send.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
});
it('replayed and overlapping messages do not clear a newly scheduled follow-up or duplicate a lead', async () => {
  data = [gmail('m1')]; await service.sync(productId, accountId); await service.triage(productId, service.messages(productId)[0]!.id);
  const row = studioView(app).leads[0]!; expect(row.value.permission).toBe('existing-conversation');
  studioAction(app, { type: 'lead', productId, id: row.id, value: { ...row.value, followUpAt: clock.now() + DAY } });
  await service.sync(productId, accountId); await service.triage(productId, service.messages(productId)[0]!.id);
  expect(service.messages(productId)).toHaveLength(1); expect(studioView(app).leads).toHaveLength(1); expect(studioView(app).leads[0]!.value.followUpAt).toBe(clock.now() + DAY); expect(complete).toHaveBeenCalledTimes(1);
});
it('suppresses explicit opt-outs even with AI disabled and enforces them in Studio without the desktop service', async () => {
  const id = lead(); service.configure(productId, { accountId, since: clock.now() - DAY, autoSync: true, aiTriage: false }); data = [gmail('optout', 'Please stop contacting me.')]; await service.sync(productId, accountId);
  const message = service.messages(productId)[0]!; expect(message.category).toBe('unsubscribe'); expect(service.isSuppressed(productId, 'BUYER@example.com')).toBe(true); expect(complete).not.toHaveBeenCalled();
  const row = studioView(app).leads.find(l => l.id === id)!; expect(row.value).toMatchObject({ permission: 'do-not-contact', followUpAt: null });
  delete app.sales;
  expect(() => studioAction(app, { type: 'lead', productId, id, value: { ...row.value, permission: 'opted-in' } })).toThrow('suppressed');
  expect(() => studioAction(app, { type: 'lead', productId, value: { ...row.value, followUpAt: clock.now() + DAY } })).toThrow('suppressed');
});
it('does not suppress quoted opt-out footers or turn automated newsletters into leads', async () => {
  data = [gmail('quoted', 'Can I try the product?\nOn Tuesday you wrote:\nUnsubscribe here.'), gmail('list', 'unsubscribe', { payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'news@example.com' }, { name: 'List-ID', value: 'newsletter' }], body: { data: Buffer.from('unsubscribe').toString('base64url') } } })];
  await service.sync(productId, accountId); expect(service.isSuppressed(productId, 'buyer@example.com')).toBe(false); expect(service.isSuppressed(productId, 'news@example.com')).toBe(false);
  const automated = service.messages(productId).find(m => m.from === 'news@example.com')!; expect(automated.category).toBe('other'); expect(() => service.addLead(productId, automated.id)).toThrow('Automated');
});
it('preserves saved pages and retries the same cursor after a failed page and restart', async () => {
  data = [gmail('page1')]; next = 'cursor2'; await service.sync(productId, accountId); const before = service.source(productId, accountId); expect(before.cursor).toBe('cursor2');
  send.mockImplementationOnce(async () => new Response('fixture-secret-token private body', { status: 503 })); await service.sync(productId, accountId);
  expect(service.source(productId, accountId)).toMatchObject({ status: 'attention', cursor: 'cursor2', watermark: before.watermark }); expect(service.messages(productId)).toHaveLength(1);
  const restarted = new SalesService(app); data = [gmail('page1'), gmail('page2')]; next = ''; await restarted.sync(productId, accountId);
  expect(restarted.messages(productId)).toHaveLength(2); expect(restarted.source(productId, accountId).status).toBe('current'); expect(send.mock.calls.some(([url]) => String(url).includes('pageToken=cursor2'))).toBe(true);
});
it('keeps business identities and all message actions scoped, including duplicate mailbox connections', async () => {
  const other = connection.view().products[1]!.id; data = [gmail('m1')]; await service.sync(productId, accountId); const message = service.messages(productId)[0]!;
  for (const action of [() => service.addLead(other, message.id), () => service.review(other, message.id), () => service.remove(other, accountId), () => service.configure(other, { accountId, since: clock.now() - DAY, autoSync: true, aiTriage: true })]) expect(action).toThrow();
  expect(() => service.sync(other, accountId)).toThrow();
  await connection.connect({ productId: other, provider: 'gmail', label: 'Duplicate', credential: 'second-secret' }); const duplicate = connection.accounts().find(a => a.productId === other)!;
  expect(() => service.configure(other, { accountId: duplicate.id, since: clock.now() - DAY, autoSync: true, aiTriage: true })).toThrow('already configured');
  expect(service.messages(other)).toHaveLength(0); service.suppress(productId, 'buyer@example.com', 'Owner requested no contact'); expect(service.isSuppressed(other, 'buyer@example.com')).toBe(false);
});
it('rejects late page results after source edits, removal, or credential disconnection', async () => {
  const original = send.getMockImplementation()!; let finish!: () => void;
  send.mockImplementation(async (url, init) => { if (String(url).includes('/messages?')) await new Promise<void>(resolve => { finish = resolve; }); return original(url, init); });
  data = [gmail('m1')]; const pending = service.sync(productId, accountId); await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  service.remove(productId, accountId); finish(); await pending; expect(service.messages(productId)).toHaveLength(0);
  service.configure(productId, { accountId, since: clock.now() - DAY, autoSync: true, aiTriage: true });
  finish = undefined as unknown as () => void; const second = service.sync(productId, accountId); await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  connection.disconnect(productId, accountId); finish(); await second; expect(service.messages(productId)).toHaveLength(0);
});
it('requires a grounded AI quote and retains unsuccessful triage for retry without creating a lead', async () => {
  data = [gmail('m1')]; await service.sync(productId, accountId); const message = service.messages(productId)[0]!;
  complete.mockResolvedValueOnce({ text: JSON.stringify({ category: 'positive', summary: 'Bought the product', evidence: 'invented words' }), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: null });
  await service.triage(productId, message.id); expect(service.messages(productId)[0]!.category).toBe('pending'); expect(studioView(app).leads).toHaveLength(0);
  await service.triage(productId, message.id); expect(studioView(app).leads[0]!.value).toMatchObject({ stage: 'replied', permission: 'existing-conversation' });
  expect(complete.mock.calls[0]![0].prompt).toContain('untrusted data'); expect(complete.mock.calls[0]![0].prompt).not.toContain('fixture-secret-token');
});
it('discards late AI classifications when the owner reviews or stops the inbox', async () => {
  data = [gmail('m1')]; await service.sync(productId, accountId); const id = service.messages(productId)[0]!.id;
  let finish!: (value: Awaited<ReturnType<LlmClient['complete']>>) => void; complete.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = service.triage(productId, id); service.review(productId, id); finish({ text: JSON.stringify({ category: 'inquiry', summary: 'Interested', evidence: 'Can I try the product?' }), inputTokens: 0, outputTokens: 0, model: 'fixture', stopReason: null }); await pending;
  expect(studioView(app).leads).toHaveLength(0); expect(service.messages(productId)[0]!.reviewedAt).not.toBeNull();
});
it('runs automatically only with a running Operation and enabled source, with bounded poll frequency', async () => {
  app.operations = new OperationsService(app); const initial = app.operations.state(productId); let running = false; vi.spyOn(app.operations, 'state').mockImplementation(() => ({ ...initial, running }));
  data = [gmail('m1')]; const before = send.mock.calls.length; await service.tick(); expect(send).toHaveBeenCalledTimes(before);
  running = true; await service.tick(); expect(service.messages(productId)).toHaveLength(1); expect(studioView(app).leads).toHaveLength(1);
  const calls = send.mock.calls.length; await service.tick(); expect(send).toHaveBeenCalledTimes(calls); clock.advance(120000); await service.tick(); expect(send.mock.calls.length).toBeGreaterThan(calls);
});
it('shares simultaneous scans and rejects offline sync and AI', async () => {
  data = [gmail('m1')]; const one = service.sync(productId, accountId); expect(service.sync(productId, accountId)).toBe(one); await one;
  Object.assign(app.env, { SIGNAL_OFFLINE: '1' }); await expect(service.sync(productId, accountId)).rejects.toThrow('offline'); await expect(service.triage(productId, service.messages(productId)[0]!.id)).rejects.toThrow('offline');
});
it('expires body text and old message records while retaining opt-out evidence and pipeline', async () => {
  data = [gmail('m1', 'Please unsubscribe me.')]; await service.sync(productId, accountId); clock.advance(31 * DAY); expect(service.view().messages[0]!.body).toBe(''); clock.advance(61 * DAY);
  expect(service.view().messages).toHaveLength(0); expect(service.isSuppressed(productId, 'buyer@example.com')).toBe(true);
});
it('reads nested Gmail plain text once, ignores attachments, and excludes sent/spam/self messages', async () => {
  data = [gmail('multipart', '', { payload: { mimeType: 'multipart/mixed', headers: [{ name: 'From', value: 'buyer@example.com' }], parts: [{ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('Plain question').toString('base64url') } }, { mimeType: 'text/html', body: { data: Buffer.from('<b>Same question</b>').toString('base64url') } }] }, { mimeType: 'text/plain', filename: 'private.txt', body: { data: Buffer.from('Attachment secret').toString('base64url') } }] } }), gmail('sent', '', { labelIds: ['SENT'] }), gmail('spam', '', { labelIds: ['SPAM'] }), gmail('self', '', { payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'sales@example.org' }], body: { data: 'SGVsbG8' } } })];
  await service.sync(productId, accountId); expect(service.messages(productId)).toHaveLength(1); expect(service.messages(productId)[0]!.body).toBe('Plain question'); expect(send.mock.calls.some(([url]) => String(url).includes('attachments'))).toBe(false);
  expect(mailboxAddress('A <one@example.org>, B <two@example.org>')).toBeNull(); expect(mailboxAddress('one@example.org\r\nBcc: other@example.org')).toBeNull();
});
it('reads Outlook with immutable IDs, skips excluded folders, strips HTML and rejects a hostile continuation', async () => {
  const account = { ...connection.accounts()[0]!, provider: 'outlook' as const };
  const graph = vi.fn<typeof fetch>(async (input, init) => {
    expect(init?.method).toBe('GET'); expect(new Headers(init?.headers).get('prefer')).toContain('ImmutableId');
    const url = new URL(String(input)); if (url.pathname.includes('/mailFolders/')) return Response.json({ id: url.pathname.split('/').at(-1) });
    return Response.json({ value: [{ id: 'AAM+1=', conversationId: 'conversation', internetMessageId: '<message@example.com>', from: { emailAddress: { address: 'buyer@example.com' } }, subject: 'Question', receivedDateTime: new Date(clock.now() - 1000).toISOString(), isDraft: false, parentFolderId: 'inbox', body: { contentType: 'html', content: '<script>steal()</script><b>Try this</b><img src="https://tracking.example"> fixture-secret-token' } }, { id: 'junk', conversationId: 'conversation2', isDraft: false, parentFolderId: 'junkemail', receivedDateTime: new Date(clock.now() - 1000).toISOString(), body: { contentType: 'text', content: 'Spam' } }], '@odata.nextLink': 'https://attacker.example/steal' });
  });
  const reader = new InboxReader(account, 'fixture-secret-token', graph, new AbortController().signal, () => {}); const page = await reader.page(clock.now() - DAY, clock.now(), '');
  expect(page.messages).toHaveLength(1); expect(page.messages[0]!.body.replace(/\s+/g, ' ')).toBe('Try this [redacted]'); expect(page.messages[0]!.body).not.toContain('steal'); const calls = graph.mock.calls.length;
  await expect(reader.page(clock.now() - DAY, clock.now(), page.next)).rejects.toThrow('continuation'); expect(graph).toHaveBeenCalledTimes(calls);
});
it('a partial or oversized message is handed off rather than creating an automatic sales lead', async () => {
  data = [gmail('long', 'Can I try the product?' + ' x'.repeat(7000))]; await service.sync(productId, accountId); const message = service.messages(productId)[0]!; expect(message.body.length).toBe(12000); expect(message.truncated).toBe(true);
  await service.triage(productId, message.id); expect(service.messages(productId)[0]!.category).toBe('handoff'); expect(studioView(app).leads).toHaveLength(0);
});
it('pausing Operations aborts an active model call and prevents a late lead from appearing', async () => {
  app.operations = new OperationsService(app); data = [gmail('m1')]; await service.sync(productId, accountId); const id = service.messages(productId)[0]!.id;
  let finish!: (value: Awaited<ReturnType<LlmClient['complete']>>) => void; complete.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = service.triage(productId, id); app.operations.pause(productId); finish({ text: JSON.stringify({ category: 'inquiry', summary: 'Interested', evidence: 'Can I try the product?' }), inputTokens: 0, outputTokens: 0, model: 'fixture', stopReason: null }); await pending;
  expect(studioView(app).leads).toHaveLength(0); expect(service.messages(productId)[0]!.category).toBe('pending');
});
it('malformed later messages roll back the entire page and never advance its cursor', async () => {
  data = [gmail('good'), gmail('bad', '', { internalDate: 'not-a-time' })]; const before = service.source(productId, accountId); await service.sync(productId, accountId);
  expect(service.messages(productId)).toHaveLength(0); expect(service.source(productId, accountId)).toMatchObject({ status: 'attention', cursor: before.cursor, watermark: before.watermark });
});
it('an AI opt-out suppresses a sender without inferring a sale or changing another business', async () => {
  lead(); data = [gmail('m1', 'No more messages, please.')]; await service.sync(productId, accountId);
  complete.mockResolvedValueOnce({ text: JSON.stringify({ category: 'unsubscribe', summary: 'The sender asks for no more messages.', evidence: 'No more messages, please.' }), inputTokens: 0, outputTokens: 0, model: 'fixture', stopReason: null });
  await service.triage(productId, service.messages(productId)[0]!.id); expect(service.isSuppressed(productId, 'buyer@example.com')).toBe(true); expect(studioView(app).leads[0]!.value).toMatchObject({ permission: 'do-not-contact', stage: 'replied' });
});
it('does not expose another business message slice when one inbox has many messages', () => {
  const other = connection.view().products[1]!.id;
  const prototype: SalesMessage = { id: 'base', productId, accountId, observedAt: clock.now(), providerId: 'x', threadId: 'x', internetId: '', from: 'buyer@example.com', subject: 'Question', body: 'Text', receivedAt: clock.now() - 1000, automated: false, bounce: false, truncated: false, category: 'pending', summary: '', evidence: '', leadId: null, reviewedAt: null, triageAttemptAt: null };
  for (let i = 0; i < 310; i++) app.db.insert(settings).values({ key: `sales.message.${i}`, value: { ...prototype, id: String(i) } }).run();
  app.db.insert(settings).values({ key: 'sales.message.other', value: { ...prototype, id: 'other', productId: other, receivedAt: clock.now() - 5000 } }).run();
  expect(service.view().messages.filter(m => m.productId === other)).toHaveLength(1); expect(service.view().messages.filter(m => m.productId === productId)).toHaveLength(300);
});
it('decodes folded encoded subjects and recognizes an opt-out in an encoded subject', async () => {
  expect(decodeMailHeader('=?UTF-8?B?SGVsbG8g?=\r\n =?UTF-8?B?8J+Riw==?=')).toBe('Hello 👋');
  expect(decodeMailHeader('=?UTF-8?Q?Caf=C3=A9_question?=')).toBe('Café question');
  expect(decodeMailHeader('=?unsupported?B?abc?=')).toBe('=?unsupported?B?abc?=');
  const message = gmail('encoded'); const payload = message.payload as { headers: { name: string; value: string }[] }; payload.headers.find(h => h.name === 'Subject')!.value = '=?UTF-8?Q?Please_unsubscribe_me?='; data = [message];
  await service.sync(productId, accountId); expect(service.messages(productId)[0]!.subject).toBe('Please unsubscribe me'); expect(service.isSuppressed(productId, 'buyer@example.com')).toBe(true);
});
