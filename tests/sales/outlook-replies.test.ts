import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { ConnectionService, type CredentialVault } from '../../src/core/connections/service.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { SalesService } from '../../src/core/sales/service.js';
import { SalesReplyService } from '../../src/core/sales/reply-service.js';
import { OutlookReplyDelivery } from '../../src/core/sales/outlook-delivery.js';
import { settings, studioLeads } from '../../src/core/db/schema.js';
import type { LlmClient } from '../../src/core/llm/client.js';
import { replyAccountCanSend } from '../../src/shared/sales-replies.js';
import { PUBLISH_SCOPES } from '../../src/core/connections/providers.js';

class Vault implements CredentialVault { data = new Map<string, string>(); available() { return true; } get(k: string) { return this.data.get(k); } set(k: string, v: string) { this.data.set(k, v); } delete(k: string) { this.data.delete(k); } }
const DAY = 86400000; const ask = 'Can I try Lemonade to find my project files?'; const fact = 'Lemonade helps you find project files.';
const addr = (address: string) => ({ emailAddress: { address } });
const rawMessage = (now: number) => ({ id: 'incoming+1=', conversationId: 'conversation+1=', internetMessageId: '<incoming@example.com>', parentFolderId: 'inbox', isDraft: false, hasAttachments: false, subject: 'Trying Lemonade', from: addr('buyer@example.com'), sender: addr('buyer@example.com'), toRecipients: [addr('sales@example.org')], ccRecipients: [] as ReturnType<typeof addr>[], bccRecipients: [] as ReturnType<typeof addr>[], replyTo: [] as ReturnType<typeof addr>[], receivedDateTime: new Date(now).toISOString(), sentDateTime: new Date(now).toISOString(), createdDateTime: new Date(now).toISOString(), body: { contentType: 'text', content: ask }, internetMessageHeaders: [{ name: 'Message-ID', value: '<incoming@example.com>' }] });
type Raw = ReturnType<typeof rawMessage>;
let app: App; let clock: ReturnType<typeof fixedClock>; let connection: ConnectionService; let sales: SalesService; let replies: SalesReplyService; let vault: Vault;
let productId: string; let accountId: string; let incoming: Raw; let records: Raw[];
let send: ReturnType<typeof vi.fn<typeof fetch>>; let complete: ReturnType<typeof vi.fn<LlmClient['complete']>>;
let loseDraft: boolean; let loseSend: boolean; let delayedSent: boolean;
beforeEach(async () => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); clock = fixedClock(1789610000000); app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger });
  records = []; loseDraft = false; loseSend = false; delayedSent = false; vault = new Vault();
  complete = vi.fn(async request => ({ text: JSON.stringify(request.task === 'sales-triage' ? { category: 'inquiry', summary: 'A buyer asks to try Lemonade.', evidence: ask } : request.task === 'sales.reply-review' ? { approved: true, reason: 'Supported answer.', quotes: [fact] } : { decision: 'reply', body: 'You can try Lemonade to find your project files. Start at https://siplemona.de.', reason: 'Direct answer.' }), model: 'fixture', inputTokens: 1, outputTokens: 1, stopReason: 'stop' }));
  send = vi.fn(async (input, init) => {
    const url = new URL(String(input)); expect(init?.redirect).toBe('error');
    if (url.hostname === 'siplemona.de') return Response.json({ error: 'Post not found' }, { status: 404 });
    expect(url.origin).toBe('https://graph.microsoft.com');
    if (url.pathname === '/v1.0/me') return Response.json({ mail: 'sales@example.org' });
    expect(new Headers(init?.headers).get('prefer')).toContain('IdType="ImmutableId"');
    expect(new Headers(init?.headers).get('prefer')).toContain('outlook.body-content-type="text"');
    if (url.pathname.endsWith('/createReply')) {
      expect(init?.method).toBe('POST'); expect(new Headers(init?.headers).get('content-type')).toBe('text/plain');
      const job = replies.replies(productId).find(j => j.status === 'dispatching')!; expect(job.attemptedAt).not.toBeNull();
      const mime = Buffer.from(String(init?.body), 'base64').toString(); expect(mime).toContain(`In-Reply-To: ${job.inReplyTo}`); expect(mime).toContain('Auto-Submitted: auto-replied');
      expect(Buffer.from(mime.split('\r\n\r\n')[1]!, 'base64').toString().replace(/\r\n/g, '\n')).toBe(job.body);
      const draft: Raw = { ...rawMessage(clock.now()), id: `immutable+${records.length + 1}=`, internetMessageId: `<exchange-${records.length}@example.org>`, parentFolderId: 'drafts', isDraft: true, subject: job.subject, from: addr(job.from), sender: addr(job.from), toRecipients: [addr(job.to)], body: { contentType: 'text', content: job.body }, internetMessageHeaders: [{ name: 'In-Reply-To', value: job.inReplyTo }] };
      records.push(draft); if (loseDraft) throw new Error('Response lost after draft creation fixture-token'); return Response.json({ id: draft.id }, { status: 201 });
    }
    if (url.pathname.endsWith('/send')) {
      expect(init?.method).toBe('POST'); expect(init?.body).toBeUndefined();
      const draft = records.find(m => m.id === decodeURIComponent(url.pathname.split('/').at(-2)!))!;
      expect(draft).toBeDefined(); const job = replies.replies(productId).find(j => j.acceptedId === draft.id)!; expect(job.attemptedAt).not.toBeNull();
      expect(job.status).toBe('dispatching'); if (!delayedSent) { draft.isDraft = false; draft.parentFolderId = 'sentitems'; }
      if (loseSend) throw new Error('Response lost after accepted send fixture-token'); return new Response(null, { status: 202 });
    }
    expect(init?.method ?? 'GET').toBe('GET');
    if (url.pathname.includes('/mailFolders/')) return Response.json({ id: url.pathname.split('/').at(-1) });
    if (url.pathname === '/v1.0/me/messages') return Response.json({ value: [incoming, ...records] });
    const record = [incoming, ...records].find(m => m.id === decodeURIComponent(url.pathname.split('/').at(-1)!));
    return record ? Response.json(record) : new Response(null, { status: 404 });
  });
  connection = new ConnectionService(app, vault, undefined, send); app.connections = connection; productId = connection.view().products[0]!.id;
  await connection.connect({ productId, provider: 'outlook', label: 'Sales Outlook', credential: 'fixture-token' }); accountId = connection.accounts()[0]!.id;
  const account = connection.accounts()[0]!; app.db.update(settings).set({ value: { ...account, grantedScopes: ['Mail.Read', 'Mail.ReadWrite', 'Mail.Send'] } }).where(eq(settings.key, `connections.account.${accountId}`)).run();
  await connection.connect({ productId, provider: 'signal-blog', label: 'Website', credential: 'fixture-blog-token' }); const website = connection.accounts().find(a => a.provider === 'signal-blog')!;
  app.operations = new OperationsService(app); app.operations.configure(productId, { objective: 'Help buyers find useful product capabilities.', accountIds: [website.id], intervalHours: 24, dailyLimit: 1 });
  const llm = { complete, available: () => ({ ready: true }) }; sales = new SalesService(app, llm); app.sales = sales;
  sales.configure(productId, { accountId, since: clock.now() - DAY, autoSync: true, aiTriage: true });
  replies = new SalesReplyService(app, llm, async (_app, url) => ({ url, title: 'Lemonade', body: fact, observedAt: clock.now(), trust: 'Untrusted page text.' })); app.salesReplies = replies;
  replies.configure(productId, { enabled: true, accountIds: [accountId], dailyLimit: 5, delayMinutes: 1 }); clock.advance(2000); incoming = rawMessage(clock.now() - 1000);
  await sales.sync(productId, accountId); await sales.triage(productId, sales.messages(productId)[0]!.id);
});
afterEach(async () => { await replies.stop(); await sales.stop(); app.close(); vi.unstubAllEnvs(); __setConfigForTests(null); });
const prepare = () => replies.prepare(productId, sales.messages(productId)[0]!.id);
const writes = (suffix: string) => send.mock.calls.filter(([url, init]) => String(url).endsWith(suffix) && init?.method === 'POST');
const dispatch = async () => { app.operations!.run(productId); clock.advance(60000); await replies.tick(); };

it('researches and reviews an inquiry, saves the immutable draft ID, then confirms the sent copy', async () => {
  await prepare(); expect(replies.replies(productId)[0]!.status).toBe('queued'); expect(complete.mock.calls.some(([r]) => r.task === 'sales.reply-review')).toBe(true);
  await dispatch(); expect(replies.replies(productId)[0]).toMatchObject({ status: 'sent', acceptedId: 'immutable+1=' }); expect(sales.messages(productId)[0]!.reviewedAt).not.toBeNull();
  expect(writes('/createReply')).toHaveLength(1); expect(writes('/send')).toHaveLength(1); expect(JSON.stringify(replies.view())).not.toContain('fixture-token');
  await replies.tick(); expect(writes('/send')).toHaveLength(1);
});
it('reconciles a lost send response after restart without creating or sending again', async () => {
  await prepare(); loseSend = true; await dispatch(); const job = replies.replies(productId)[0]!; expect(job).toMatchObject({ status: 'attention', acceptedId: 'immutable+1=' });
  const restarted = new SalesReplyService(app); await restarted.reconcile(productId, job.id); expect(restarted.replies(productId)[0]!.status).toBe('sent'); expect(writes('/send')).toHaveLength(1); expect(writes('/createReply')).toHaveLength(1);
});
it('does not send or recreate a draft when the createReply response was lost', async () => {
  await prepare(); loseDraft = true; await dispatch(); const job = replies.replies(productId)[0]!;
  expect(job).toMatchObject({ status: 'attention', acceptedId: null }); expect(job.attemptedAt).not.toBeNull(); expect(records[0]!.isDraft).toBe(true);
  await replies.reconcile(productId, job.id); await replies.tick(); expect(writes('/createReply')).toHaveLength(1); expect(writes('/send')).toHaveLength(0); await expect(prepare()).rejects.toThrow();
});
it('waits for eventual Sent Items appearance without treating the draft as delivered', async () => {
  await prepare(); delayedSent = true; await dispatch(); const job = replies.replies(productId)[0]!; expect(job.status).toBe('attention');
  await replies.reconcile(productId, job.id); expect(replies.replies(productId)[0]!.status).toBe('attention');
  records[0]!.isDraft = false; records[0]!.parentFolderId = 'sentitems'; await replies.reconcile(productId, job.id);
  expect(replies.replies(productId)[0]!.status).toBe('sent'); expect(writes('/send')).toHaveLength(1);
});
it.each(['cc', 'bcc', 'replyTo', 'sender', 'body', 'subject', 'deleted', 'automated', 'recipient', 'newActivity'])('blocks changed %s before draft creation', async fault => {
  await prepare();
  if (fault === 'cc') incoming.ccRecipients = [addr('third@example.com')]; if (fault === 'bcc') incoming.bccRecipients = [addr('third@example.com')]; if (fault === 'replyTo') incoming.replyTo = [addr('third@example.com')]; if (fault === 'sender') incoming.sender = addr('third@example.com');
  if (fault === 'body') incoming.body.content += ' One more question.'; if (fault === 'subject') incoming.subject = 'Different question'; if (fault === 'deleted') incoming.parentFolderId = 'deleteditems'; if (fault === 'automated') incoming.internetMessageHeaders.push({ name: 'Auto-Submitted', value: 'auto-generated' }); if (fault === 'recipient') incoming.toRecipients.push(addr('third@example.com'));
  if (fault === 'newActivity') records.push({ ...rawMessage(clock.now()), id: 'human+reply=' });
  await dispatch(); expect(writes('/createReply')).toHaveLength(0); expect(writes('/send')).toHaveLength(0); expect(replies.replies(productId)[0]!.status).toBe('attention');
});
it.each(['draftBody', 'draftRecipient', 'draftAttachment', 'newActivity', 'pause', 'policy', 'optOut', 'disconnect'])('stops after draft creation if %s changes', async fault => {
  await prepare(); const original = send.getMockImplementation()!;
  send.mockImplementation(async (url, init) => { const result = await original(url, init); if (String(url).endsWith('/createReply')) {
    if (fault === 'draftBody') records[0]!.body.content = 'Unreviewed text'; if (fault === 'draftRecipient') records[0]!.toRecipients = [addr('third@example.com')]; if (fault === 'draftAttachment') records[0]!.hasAttachments = true;
    if (fault === 'newActivity') records.push({ ...rawMessage(clock.now()), id: 'human+reply=' });
    if (fault === 'pause') app.operations!.pause(productId);
    if (fault === 'policy') replies.configure(productId, { enabled: false, accountIds: [accountId], dailyLimit: 5, delayMinutes: 1 });
    if (fault === 'optOut') { const lead = app.db.select().from(studioLeads).where(eq(studioLeads.productId, productId)).get()!; app.db.update(studioLeads).set({ value: { ...lead.value, permission: 'do-not-contact' } }).where(eq(studioLeads.id, lead.id)).run(); }
    if (fault === 'disconnect') connection.disconnect(productId, accountId);
  } return result; });
  await dispatch(); expect(writes('/createReply')).toHaveLength(1); expect(writes('/send')).toHaveLength(0); expect(records[0]!.isDraft).toBe(true);
});
it('rejects incomplete conversation pages without following an untrusted next link', async () => {
  await prepare(); const original = send.getMockImplementation()!;
  send.mockImplementation(async (url, init) => String(url).includes('conversationId+eq') ? Response.json({ value: [incoming], '@odata.nextLink': 'https://attacker.example' }) : original(url, init));
  await dispatch(); expect(writes('/createReply')).toHaveLength(0); expect(send.mock.calls.some(([u]) => String(u).includes('attacker'))).toBe(false);
});
it.each(['body', 'recipient', 'folder', 'replyHeader', 'id'])('never confirms a mismatched sent %s', async fault => {
  await prepare(); loseSend = true; await dispatch(); const job = replies.replies(productId)[0]!;
  if (fault === 'body') records[0]!.body.content = 'Other message'; if (fault === 'recipient') records[0]!.toRecipients.push(addr('third@example.com')); if (fault === 'folder') records[0]!.parentFolderId = 'deleteditems'; if (fault === 'replyHeader') records[0]!.internetMessageHeaders = []; if (fault === 'id') records[0]!.id = 'different';
  await replies.reconcile(productId, job.id); expect(replies.replies(productId)[0]!.status).toBe('attention'); expect(writes('/send')).toHaveLength(1);
});
it('requires both Outlook permissions and accepts documented bare and URL grant forms', () => {
  expect(PUBLISH_SCOPES.outlook).toEqual(['https://graph.microsoft.com/Mail.ReadWrite', 'https://graph.microsoft.com/Mail.Send']);
  for (const grantedScopes of [['Mail.Read', 'Mail.Send'], ['Mail.ReadWrite'], ['Mail.Send.Shared', 'Mail.ReadWrite.Shared']]) expect(replyAccountCanSend({ provider: 'outlook', grantedScopes })).toBe(false);
  expect(replyAccountCanSend({ provider: 'outlook', grantedScopes: ['Mail.ReadWrite', 'Mail.Send'] })).toBe(true); expect(replyAccountCanSend({ provider: 'outlook', grantedScopes: PUBLISH_SCOPES.outlook! })).toBe(true);
  const account = connection.accounts().find(a => a.id === accountId)!; app.db.update(settings).set({ value: { ...account, grantedScopes: ['Mail.Read', 'Mail.Send'] } }).where(eq(settings.key, `connections.account.${accountId}`)).run();
  expect(() => replies.configure(productId, { enabled: true, accountIds: [accountId], dailyLimit: 5, delayMinutes: 1 })).toThrow('Mail.ReadWrite');
});
it('validates the business and original mailbox before exposing Outlook credentials', async () => {
  await prepare(); const job = replies.replies(productId)[0]!;
  await expect(connection.reconcileSalesReply({ ...job, productId: connection.view().products[1]!.id }, new AbortController().signal)).rejects.toThrow();
  const adapter = new OutlookReplyDelivery('fixture-token', send, new AbortController().signal, () => {});
  await expect(adapter.send({ ...job, attemptedAt: clock.now() }, () => {}, () => {}, () => {})).rejects.toThrow('Reconciliation'); expect(writes('/createReply')).toHaveLength(0);
});

async function enableSequence(days = [1, 1]) {
  replies.configure(productId, { enabled: true, accountIds: [accountId], dailyLimit: 5, delayMinutes: 1, followUpDays: days }); clock.advance(2000);
  incoming.receivedDateTime = new Date(clock.now() - 1000).toISOString(); incoming.createdDateTime = incoming.receivedDateTime; incoming.sentDateTime = incoming.receivedDateTime;
  const source = sales.messages(productId)[0]!; app.db.update(settings).set({ value: { ...source, receivedAt: clock.now() - 1000 } }).where(eq(settings.key, `sales.message.${source.id}`)).run();
  let generated = 0; const original = complete.getMockImplementation()!;
  complete.mockImplementation(async request => { const response = await original(request); if (request.task === 'sales.reply' && ++generated > 1) return { ...response, text: JSON.stringify({ decision: 'reply', body: `For your next step ${generated}, start with a project file you need to find. Lemonade helps find project files. You can learn more at https://siplemona.de.`, reason: 'Useful next step.' }) }; return response; });
  await prepare(); await dispatch(); expect(replies.sequences.list(productId)[0]!.status).toBe('active');
}
async function prepareFollowUp() { clock.advance(DAY + 2000); await sales.sync(productId, accountId); await replies.tick(); }
async function sendFollowUp() { clock.advance(60000); await sales.sync(productId, accountId); await replies.tick(); }
it('completes two Outlook follow-ups using confirmed immutable sent history', async () => {
  await enableSequence();
  await prepareFollowUp(); expect(replies.replies(productId).find(j => j.followUp?.step === 1)!.status).toBe('queued'); await sendFollowUp();
  expect(replies.sequences.list(productId)[0]!.completedSteps).toBe(1);
  await prepareFollowUp(); await sendFollowUp(); expect(replies.sequences.list(productId)[0]).toMatchObject({ status: 'completed', completedSteps: 2, nextAt: null });
  expect(writes('/send')).toHaveLength(3); expect(writes('/createReply')).toHaveLength(3); expect(records.every(r => !r.isDraft)).toBe(true);
});
it('does not send the next follow-up if its previous sent message was edited', async () => {
  await enableSequence(); await prepareFollowUp(); records[0]!.body.content = 'Changed in the mailbox'; await sendFollowUp();
  expect(writes('/send')).toHaveLength(1); expect(replies.replies(productId).find(j => j.followUp)!.status).toBe('attention');
});
it('advances an uncertain follow-up only once after its sent copy is reconciled', async () => {
  await enableSequence([1]); await prepareFollowUp(); loseSend = true; await sendFollowUp(); const followUp = replies.replies(productId).find(j => j.followUp)!;
  expect(followUp.status).toBe('attention'); expect(replies.sequences.list(productId)[0]!.completedSteps).toBe(0);
  await replies.reconcile(productId, followUp.id); await replies.reconcile(productId, followUp.id);
  expect(replies.sequences.list(productId)[0]).toMatchObject({ completedSteps: 1, status: 'completed' }); expect(writes('/send')).toHaveLength(2);
});
it('stops follow-ups when another human message arrives in the mailbox', async () => {
  await enableSequence(); clock.advance(5000); records.push({ ...rawMessage(clock.now() - 1000), id: 'new+incoming=', internetMessageId: '<new@example.com>', body: { contentType: 'text', content: 'Thanks, I will try it.' } });
  await sales.sync(productId, accountId); await replies.tick(); expect(replies.sequences.list(productId)[0]!.status).toBe('stopped'); expect(writes('/send')).toHaveLength(1);
});
it('sends an exact owner answer to a held Outlook follow-up without restarting its stopped sequence', async () => {
  await enableSequence([1, 1]); const original = complete.getMockImplementation()!;
  complete.mockImplementation(async request => request.task === 'sales.reply' ? { ...await original(request), text: JSON.stringify({ decision: 'handoff', body: '', reason: 'Owner details needed.' }) } : original(request));
  await prepareFollowUp(); const job = replies.replies(productId).find(j => j.followUp)!; expect(job.status).toBe('handoff');
  replies.queueOwnerReply(productId, job.messageId, 'I checked your question personally. Here is the next step we agreed to discuss.', job.id);
  await sendFollowUp(); expect(replies.replies(productId).find(j => j.id === job.id)!.status).toBe('sent');
  expect(replies.sequences.list(productId)[0]).toMatchObject({ status: 'stopped', completedSteps: 0, nextAt: null }); expect(writes('/send')).toHaveLength(2);
});
