import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock, DAY } from '../../src/core/lib/clock.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { ConnectionService, type CredentialVault } from '../../src/core/connections/service.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { SalesService } from '../../src/core/sales/service.js';
import { SalesReplyService } from '../../src/core/sales/reply-service.js';
import { SalesHandoffs } from '../../src/core/sales/handoffs.js';
import type { SalesHandoff } from '../../src/shared/handoffs.js';
import { settings, studioLeads } from '../../src/core/db/schema.js';
import type { LlmClient } from '../../src/core/llm/client.js';
import type { SalesReply } from '../../src/shared/sales-replies.js';


class Vault implements CredentialVault { data = new Map<string, string>(); available() { return true; } get(k: string) { return this.data.get(k); } set(k: string, v: string) { this.data.set(k, v); } delete(k: string) { this.data.delete(k); } }
let app: App; let clock: ReturnType<typeof fixedClock>; let connection: ConnectionService; let sales: SalesService; let replies: SalesReplyService;
let send: ReturnType<typeof vi.fn<typeof fetch>>; let complete: ReturnType<typeof vi.fn<LlmClient['complete']>>;
let productId: string; let accountId: string; let incoming: Record<string, unknown>; let sent: Record<string, unknown> | null; let loseSend: boolean;
const sourceBody = 'Lemonade helps you find project files.';
const ask = 'Can I try Lemonade to find my project files?';
const headers = (job: SalesReply) => [{ name: 'Message-ID', value: job.internetId }, { name: 'In-Reply-To', value: job.inReplyTo }, { name: 'From', value: job.from }, { name: 'To', value: job.to }, { name: 'Subject', value: job.subject }];
beforeEach(async () => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); clock = fixedClock(1789610000000); app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger }); sent = null; loseSend = false;
  complete = vi.fn(async request => ({ text: JSON.stringify(request.task === 'sales-triage' ? { category: 'inquiry', summary: 'A buyer asks to try Lemonade.', evidence: ask } : request.task === 'sales.reply-review' ? { approved: true, reason: 'Supported answer.', quotes: [sourceBody] } : { decision: 'reply', body: 'You can try Lemonade to find your project files. Start at https://siplemona.de.', reason: 'Direct answer.' }), model: 'fixture', inputTokens: 1, outputTokens: 1, stopReason: 'stop' }));
  send = vi.fn(async (input, init) => {
    const url = new URL(String(input)); expect(init?.redirect).toBe('error');
    if (url.hostname === 'siplemona.de') return Response.json({ error: 'Post not found' }, { status: 404 });
    if (url.pathname.endsWith('/profile')) return Response.json({ emailAddress: 'sales@example.org' });
    if (url.pathname.endsWith('/messages/send')) {
      expect(init?.method).toBe('POST'); const job = replies.replies(productId)[0]!; expect(job.attemptedAt).not.toBeNull();
      const body = JSON.parse(String(init?.body)) as { raw: string; threadId: string }; const raw = Buffer.from(body.raw, 'base64url').toString(); expect(raw).toContain(`Message-ID: ${job.internetId}`); expect(raw).toContain('Auto-Submitted: auto-replied'); expect(raw).not.toContain('Bcc:'); expect(body.threadId).toBe(job.threadId);
      sent = { id: 'sent1', threadId: job.threadId, internalDate: String(clock.now()), labelIds: ['SENT'], payload: { mimeType: 'text/plain', headers: headers(job), body: { data: Buffer.from(job.body).toString('base64url') } } };
      if (loseSend) throw new Error('Simulated response lost after Gmail accepted the send.');
      return Response.json({ id: 'sent1', threadId: job.threadId });
    }
    expect(init?.method ?? 'GET').toBe('GET');
    if (url.pathname.includes('/threads/')) return Response.json({ id: 'thread1', messages: [incoming, ...(sent ? [sent] : [])] });
    if (url.pathname.endsWith('/messages')) return Response.json({ messages: url.searchParams.get('q')?.includes('rfc822msgid:') ? sent ? [{ id: 'sent1' }] : [] : [{ id: 'incoming1' }] });
    if (url.pathname.endsWith('/incoming1')) return Response.json(incoming);
    if (url.pathname.endsWith('/sent1') && sent) return Response.json(sent);
    throw new Error('Unexpected fixture request');
  });
  connection = new ConnectionService(app, new Vault(), undefined, send); app.connections = connection; productId = connection.view().products[0]!.id;
  await connection.connect({ productId, provider: 'gmail', label: 'Sales Gmail', credential: 'fixture-secret-token' }); accountId = connection.accounts()[0]!.id;
  const account = connection.accounts()[0]!; app.db.update(settings).set({ value: { ...account, grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'] } }).where(eq(settings.key, `connections.account.${accountId}`)).run();
  await connection.connect({ productId, provider: 'signal-blog', label: 'Website', credential: 'fixture-blog-token' }); const website = connection.accounts().find(a => a.provider === 'signal-blog')!;
  app.operations = new OperationsService(app); app.operations.configure(productId, { objective: 'Help buyers find useful product capabilities.', accountIds: [website.id], intervalHours: 24, dailyLimit: 1 });
  const llm = { complete, available: () => ({ ready: true }) }; sales = new SalesService(app, llm); app.sales = sales;
  sales.configure(productId, { accountId, since: clock.now() - DAY, autoSync: true, aiTriage: true });
  replies = new SalesReplyService(app, llm, async (_app, url) => ({ url, title: 'Lemonade', body: sourceBody, observedAt: clock.now(), trust: 'Untrusted page text.' })); app.salesReplies = replies;
  replies.configure(productId, { enabled: true, accountIds: [accountId], dailyLimit: 5, delayMinutes: 1 }); clock.advance(2000);
  incoming = { id: 'incoming1', threadId: 'thread1', internalDate: String(clock.now() - 1000), labelIds: ['INBOX'], payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'buyer@example.com' }, { name: 'To', value: 'sales@example.org' }, { name: 'Subject', value: 'Trying Lemonade' }, { name: 'Message-ID', value: '<inquiry@example.com>' }], body: { data: Buffer.from(ask).toString('base64url') } } };
  await sales.sync(productId, accountId); await sales.triage(productId, sales.messages(productId)[0]!.id);
});
afterEach(async () => { await replies.stop(); await sales.stop(); app.close(); vi.unstubAllEnvs(); __setConfigForTests(null); });
const prepare = () => replies.prepare(productId, sales.messages(productId)[0]!.id);
const posts = () => send.mock.calls.filter(([url, init]) => String(url).endsWith('/messages/send') && init?.method === 'POST');
async function dispatch() { app.operations!.run(productId); clock.advance(60000); await replies.tick(); }

let handoffs: SalesHandoffs;
beforeEach(() => { handoffs = new SalesHandoffs(app); app.salesHandoffs = handoffs; });
const target = (row: SalesHandoff) => ({ productId: row.productId, id: row.id, revision: row.revision });
async function held() { const original = complete.getMockImplementation()!; complete.mockImplementation(async request => request.task === 'sales.reply' ? { ...await original(request), text: JSON.stringify({ decision: 'handoff', body: '', reason: 'Owner knowledge required.' }) } : original(request)); await prepare(); handoffs.sync(); return handoffs.list(productId)[0]!; }

it('opens and deduplicates a durable owner handoff without any send', async () => {
  const row = await held(); expect(row).toMatchObject({ kind: 'reply', status: 'open', uncertain: false }); expect(row.messageId).toBe(sales.messages(productId)[0]!.id);
  handoffs.sync(); expect(handoffs.list(productId)).toHaveLength(1); expect(new SalesHandoffs(app).list(productId)[0]).toEqual(row); expect(posts()).toHaveLength(0);
});
it('tracks inbox handoffs independently of whether they have a sales lead', async () => {
  const message = sales.messages(productId)[0]!; app.db.update(settings).set({ value: { ...message, category: 'handoff', leadId: null } }).where(eq(settings.key, `sales.message.${message.id}`)).run();
  handoffs.sync(); expect(handoffs.list(productId)[0]!.kind).toBe('message'); expect(handoffs.view().cases[0]!.canReply).toBe(true);
  sales.review(productId, message.id); handoffs.sync(); expect(handoffs.list(productId)[0]!.resolution).toBe('condition-cleared');
});
it('persists reminder notes and brings a snoozed handoff back into the due count', async () => {
  const row = await held(); const until = clock.now() + 4 * 3600000;
  await handoffs.action({ type: 'snooze', ...target(row), until, note: 'Check the answer after discussing the product.' }); handoffs.sync();
  expect(handoffs.summary(productId)).toMatchObject({ open: 1, due: 0 }); clock.advance(4 * 3600000);
  const restarted = new SalesHandoffs(app); restarted.sync(); expect(restarted.summary(productId).due).toBe(1); expect(restarted.list(productId)[0]!.history.at(-1)!.note).toContain('discussing');
});
it('rejects stale revisions, cross-business decisions and invalid reminder times', async () => {
  const row = await held(); await handoffs.action({ type: 'snooze', ...target(row), until: clock.now() + 1000, note: 'Review shortly.' });
  await expect(handoffs.action({ type: 'resolve', ...target(row), outcome: 'no-response-needed', note: 'Already handled.' })).rejects.toThrow('changed');
  const current = handoffs.list(productId)[0]!;
  await expect(handoffs.action({ type: 'resolve', ...target(current), productId: connection.view().products[1]!.id, outcome: 'no-response-needed', note: 'Already handled.' })).rejects.toThrow('changed');
  await expect(handoffs.action({ type: 'snooze', ...target(current), until: clock.now() + 8 * DAY, note: 'Review later.' })).rejects.toThrow('seven days'); expect(handoffs.list(productId)[0]!.status).toBe('snoozed');
});
it('records an external answer without inventing a receipt or restarting the agent', async () => {
  const row = await held(); await handoffs.action({ type: 'resolve', ...target(row), outcome: 'answered-externally', note: 'I answered the question in the original mailbox.' });
  expect(handoffs.list(productId)[0]).toMatchObject({ status: 'resolved', resolution: 'answered-externally' }); expect(replies.replies(productId)[0]!.status).toBe('handoff');
  expect(sales.messages(productId)[0]!.reviewedAt).not.toBeNull(); await dispatch(); expect(posts()).toHaveLength(0); handoffs.sync(); expect(handoffs.list(productId)[0]!.status).toBe('resolved');
});
it('queues and sends the exact owner response without using a model or enrolling follow-ups', async () => {
  const row = await held(); const calls = complete.mock.calls.length; const body = 'Thanks for asking. The annual plan is not available yet; I can explain the current options.';
  app.db.insert(settings).values({ key: `sales.reply-policy.${productId}`, value: { ...replies.policy(productId), followUpDays: [1] } }).onConflictDoUpdate({ target: settings.key, set: { value: { ...replies.policy(productId), followUpDays: [1] } } }).run();
  await handoffs.action({ type: 'reply', ...target(row), body }); const job = replies.replies(productId)[0]!;
  expect(job.status).toBe('queued'); expect(job.body).toBe(`${body}\n\nLemonade team - sent with Signal`); expect(job.ownerApproval?.bodyHash).toBe(job.bodyHash); expect(complete.mock.calls).toHaveLength(calls);
  expect(handoffs.summary(productId)).toMatchObject({ waiting: 1, open: 0 }); await dispatch(); handoffs.sync();
  expect(replies.replies(productId)[0]!.status).toBe('sent'); expect(replies.sequences.list(productId)).toHaveLength(0); expect(handoffs.list(productId)[0]!.resolution).toBe('sent-copy-confirmed'); expect(posts()).toHaveLength(1);
});
it('lets an owner answer a triaged handoff and an existing customer without reclassifying it as a buying lead', async () => {
  const message = sales.messages(productId)[0]!; const lead = app.db.select().from(studioLeads).where(eq(studioLeads.id, message.leadId!)).get()!;
  app.db.update(studioLeads).set({ value: { ...lead.value, stage: 'customer' } }).where(eq(studioLeads.id, lead.id)).run();
  app.db.update(settings).set({ value: { ...message, category: 'handoff' } }).where(eq(settings.key, `sales.message.${message.id}`)).run(); handoffs.sync();
  await handoffs.action({ type: 'reply', ...target(handoffs.list(productId)[0]!), body: 'I checked your request personally. Please use the instructions we discussed in our last conversation.' });
  await dispatch(); expect(replies.replies(productId)[0]!.status).toBe('sent'); expect(sales.messages(productId)[0]!.category).toBe('handoff'); expect(app.db.select().from(studioLeads).where(eq(studioLeads.id, lead.id)).get()!.value.stage).toBe('customer');
});
it('preserves uncertain send evidence when the owner acknowledges a case', async () => {
  await prepare(); loseSend = true; await dispatch(); handoffs.sync(); const row = handoffs.list(productId)[0]!;
  expect(row.uncertain).toBe(true); expect(handoffs.view().cases[0]!.canReply).toBe(false);
  await expect(handoffs.action({ type: 'resolve', ...target(row), outcome: 'answered-externally', note: 'Someone handled it.' })).rejects.toThrow('Reconcile');
  await expect(handoffs.action({ type: 'reply', ...target(row), body: 'This should never be queued while sending is uncertain.' })).rejects.toThrow('cannot queue');
  await handoffs.action({ type: 'resolve', ...target(row), outcome: 'uncertainty-acknowledged', note: 'I will investigate the original mailbox before taking another action.' });
  const job = replies.replies(productId)[0]!; expect(job.status).toBe('attention'); expect(job.attemptedAt).not.toBeNull(); expect(posts()).toHaveLength(1);
  handoffs.sync(); expect(handoffs.list(productId)[0]!.status).toBe('resolved');
});
it('reconciles a held delivery with reads only and closes its handoff', async () => {
  await prepare(); loseSend = true; await dispatch(); handoffs.sync(); const row = handoffs.list(productId)[0]!;
  await handoffs.action({ type: 'reconcile', ...target(row) }); expect(handoffs.list(productId)[0]!.resolution).toBe('sent-copy-confirmed'); expect(posts()).toHaveLength(1);
});
it('never bypasses suppression or mailbox permissions for an owner approval', async () => {
  const row = await held(); sales.suppress(productId, 'buyer@example.com', 'The buyer requested no further contact.');
  await expect(handoffs.action({ type: 'reply', ...target(row), body: 'An owner-written answer is still subject to contact suppression.' })).rejects.toThrow('suppressed'); expect(posts()).toHaveLength(0);
});
it('rejects approving a response twice and prevents AI rewriting an owner response', async () => {
  const row = await held(); await handoffs.action({ type: 'reply', ...target(row), body: 'Here is the answer I have personally checked for this specific question.' });
  const job = replies.replies(productId)[0]!;
  expect(() => replies.queueOwnerReply(productId, job.messageId, 'This duplicate approval must not replace a response already in the queue.', job.id)).toThrow('queued');
  replies.cancel(productId, job.id); await expect(replies.prepare(productId, job.messageId)).rejects.toThrow('owner-written'); expect(() => replies.retryReply(productId, job.id)).toThrow('owner-written'); expect(posts()).toHaveLength(0);
});
it('holds expired owner approval until the exact response is reviewed again', async () => {
  const row = await held(); const body = 'This is the response I have checked personally for the buyer.';
  await handoffs.action({ type: 'reply', ...target(row), body }); clock.advance(DAY + 1000); await sales.sync(productId, accountId); await dispatch();
  expect(posts()).toHaveLength(0); expect(replies.replies(productId)[0]!.status).toBe('attention'); handoffs.sync();
  await handoffs.action({ type: 'reply', ...target(handoffs.list(productId)[0]!), body }); clock.advance(60000); await replies.tick(); expect(posts()).toHaveLength(1);
});
it('stops a queued owner reply when policy changes and keeps the case visible', async () => {
  const row = await held(); await handoffs.action({ type: 'reply', ...target(row), body: 'This owner response is ready once the policy and account remain valid.' });
  replies.configure(productId, { enabled: true, accountIds: [accountId], dailyLimit: 4, delayMinutes: 1 }); handoffs.sync();
  expect(replies.replies(productId)[0]!.status).toBe('cancelled'); expect(handoffs.summary(productId).open).toBe(1); await dispatch(); expect(posts()).toHaveLength(0);
});
it('expires private decision notes without reopening a resolved persistent condition', async () => {
  const row = await held(); await handoffs.action({ type: 'resolve', ...target(row), outcome: 'no-response-needed', note: 'Private owner note with context.' });
  clock.advance(91 * DAY); handoffs.sync(); handoffs.sync(); const saved = handoffs.list(productId)[0]!;
  expect(saved.status).toBe('resolved'); expect(JSON.stringify(saved.history)).not.toContain('Private owner note');
});
it('does not turn a transient automatic preparation retry into an immediate owner task', async () => {
  complete.mockRejectedValue(new Error('Temporary model failure')); await prepare(); handoffs.sync(); expect(handoffs.list(productId)).toHaveLength(0);
  const job = replies.replies(productId)[0]!; app.db.update(settings).set({ value: { ...job, prepareAttempts: 3, retryAt: null } }).where(eq(settings.key, `sales.reply.${job.id}`)).run(); handoffs.sync(); expect(handoffs.summary(productId).open).toBe(1);
});
it('does not enroll a sequence when an acknowledged uncertain initial send is later confirmed', async () => {
  const policy = { ...replies.policy(productId), followUpDays: [1] }; app.db.update(settings).set({ value: policy }).where(eq(settings.key, `sales.reply-policy.${productId}`)).run();
  await prepare(); loseSend = true; await dispatch(); handoffs.sync(); const row = handoffs.list(productId)[0]!;
  await handoffs.action({ type: 'resolve', ...target(row), outcome: 'uncertainty-acknowledged', note: 'Owner took over this conversation for investigation.' });
  const job = replies.replies(productId)[0]!; await replies.reconcile(productId, job.id); await replies.tick(); handoffs.sync();
  expect(replies.replies(productId)[0]!.status).toBe('sent'); expect(replies.sequences.list(productId)).toHaveLength(0); expect(handoffs.list(productId)[0]).toMatchObject({ uncertain: false, resolution: 'sent-copy-confirmed' });
});
it('rejects an owner-approved body that was modified after approval', async () => {
  const row = await held(); await handoffs.action({ type: 'reply', ...target(row), body: 'This exact response has been approved for the buyer.' });
  const job = replies.replies(productId)[0]!; app.db.update(settings).set({ value: { ...job, body: 'An unreviewed replacement message must not be sent.' } }).where(eq(settings.key, `sales.reply.${job.id}`)).run();
  await dispatch(); expect(posts()).toHaveLength(0); expect(replies.replies(productId)[0]!.status).toBe('attention');
});
it('reconciles a receipt after the inbox record has expired without reviving follow-ups', async () => {
  await prepare(); loseSend = true; await dispatch(); handoffs.sync(); const row = handoffs.list(productId)[0]!;
  await handoffs.action({ type: 'resolve', ...target(row), outcome: 'uncertainty-acknowledged', note: 'The owner will investigate this delivery separately.' });
  app.db.delete(settings).where(eq(settings.key, `sales.message.${row.messageId}`)).run(); clock.advance(91 * DAY);
  await replies.reconcile(productId, row.sourceId); handoffs.sync(); expect(replies.replies(productId)[0]!.status).toBe('sent'); expect(handoffs.list(productId)[0]!.resolution).toBe('sent-copy-confirmed');
});
