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
import { GmailReplyDelivery, gmailMime } from '../../src/core/sales/gmail-delivery.js';
import { settings, studioLeads } from '../../src/core/db/schema.js';
import type { LlmClient } from '../../src/core/llm/client.js';
import type { SalesReply } from '../../src/shared/sales-replies.js';
import { decodeMailHeader } from '../../src/core/sales/inbox.js';
import { RevenueService } from '../../src/core/revenue/service.js';
import { purchaseContactHash } from '../../src/core/revenue/identity.js';

class Vault implements CredentialVault { data = new Map<string, string>(); available() { return true; } get(k: string) { return this.data.get(k); } set(k: string, v: string) { this.data.set(k, v); } delete(k: string) { this.data.delete(k); } }
let app: App; let clock: ReturnType<typeof fixedClock>; let connection: ConnectionService; let sales: SalesService; let replies: SalesReplyService;
let send: ReturnType<typeof vi.fn<typeof fetch>>; let complete: ReturnType<typeof vi.fn<LlmClient['complete']>>;
let productId: string; let accountId: string; let incoming: Record<string, unknown>; let sent: Record<string, unknown> | null; let loseSend: boolean;
const sourceBody = 'Lemonade helps you find project files.';
const ask = 'Can I try Lemonade to find my project files?';
it('holds canned reply language before review or delivery', async () => {
  const original = complete.getMockImplementation()!;
  complete.mockImplementation(async request => request.task === 'sales.reply'
    ? { text: JSON.stringify({ decision: 'reply', body: 'Great question! Lemonade helps you find project files. Hope this helps!', reason: 'Fixture' }), model: 'fixture', inputTokens: 1, outputTokens: 1, stopReason: 'stop' }
    : original(request));
  await prepare();
  expect(replies.replies(productId)[0]!.status).toBe('attention');
  expect(complete.mock.calls.some(([request]) => request.task === 'sales.reply-review')).toBe(false);
  expect(posts()).toHaveLength(0);
});
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
it.each(['send', 'revoked', 'changed', 'uncertain', 'owner'] as const)('uses a verified Gmail alias and preserves delivery safeguards: %s', async mode => {
  const alias = 'sales@aionx.aionapp.org'; let revoked = false;
  const original = send.getMockImplementation()!;
  send.mockImplementation(async (input, init) => String(input).endsWith('/settings/sendAs') ? Response.json({ sendAs: [{ sendAsEmail: 'sales@example.org', isPrimary: true }, { sendAsEmail: alias, verificationStatus: revoked ? 'pending' : 'accepted' }] }) : original(input, init));
  const payload = incoming['payload'] as { headers: { name: string; value: string }[] };
  payload.headers.find(h => h.name === 'To')!.value = alias;
  app.db.delete(settings).where(eq(settings.key, `sales.message.${sales.messages(productId)[0]!.id}`)).run();
  await sales.configureVerified(productId, { accountId, since: clock.now() - DAY, autoSync: true, aiTriage: true, senderEmail: alias });
  await sales.sync(productId, accountId); await sales.triage(productId, sales.messages(productId)[0]!.id);
  if (mode === 'owner') replies.queueOwnerReply(productId, sales.messages(productId)[0]!.id, 'Thanks for asking about Lemonade. You can start with your project files.'); else await prepare();
  expect(replies.replies(productId)[0]).toMatchObject({ from: alias, mailbox: 'sales@example.org', status: 'queued' });
  if (mode === 'revoked') revoked = true;
  if (mode === 'changed') await sales.configureVerified(productId, { accountId, since: clock.now() - DAY, autoSync: true, aiTriage: true, senderEmail: 'sales@example.org' });
  if (mode === 'uncertain') loseSend = true;
  await dispatch();
  if (mode === 'revoked' || mode === 'changed') { expect(posts()).toHaveLength(0); expect(replies.replies(productId)[0]).toMatchObject({ attemptedAt: null }); return; }
  expect(posts()).toHaveLength(1);
  const raw = Buffer.from(JSON.parse(String(posts()[0]![1]!.body)).raw, 'base64url').toString();
  expect(raw).toContain(`From: ${alias}\r\n`); expect(raw).not.toContain('From: sales@example.org');
  if (mode === 'uncertain') { revoked = true; await replies.reconcile(productId, replies.replies(productId)[0]!.id); expect(posts()).toHaveLength(1); }
  expect(replies.replies(productId)[0]!.status).toBe('sent');
});
function recordPurchase() {
  const stripeAccount = 'fixture-stripe';
  app.db.insert(settings).values({ key: `connections.account.${stripeAccount}`, value: { ...app.connections!.accounts()[0], id: stripeAccount, productId, provider: 'stripe', identity: 'Fixture Stripe' } }).run();
  app.db.insert(settings).values({ key: `revenue.config.${productId}`, value: { productId, accountId: stripeAccount, live: true } }).run();
  app.db.insert(settings).values({ key: `revenue.snapshot.${productId}`, value: [{ id: 'ch_purchase', productId, accountId: stripeAccount, live: true, captured: 4900, refunded: 0, disputed: false, contactHash: purchaseContactHash(stripeAccount, 'buyer@example.com') }] }).run();
  app.revenue = new RevenueService(app); app.revenue.reconcileCustomers(productId);
}
it('cancels a queued sales answer after a matching live purchase without sending', async () => {
  await prepare(); recordPurchase();
  expect(replies.replies(productId)[0]).toMatchObject({ status: 'cancelled', attemptedAt: null });
  expect(app.db.select().from(studioLeads).get()!.value.stage).toBe('customer');
  await dispatch(); expect(posts()).toHaveLength(0); await expect(prepare()).rejects.toThrow('Stripe purchase');
});
it('stops a purchased customer sequence and its queued follow-up', async () => {
  await enableSequence(); await prepareDueSequence(); recordPurchase();
  expect(replies.sequences.list(productId)[0]).toMatchObject({ status: 'stopped', nextAt: null });
  expect(replies.replies(productId).find(j => j.followUp)).toMatchObject({ status: 'cancelled', attemptedAt: null });
  await sendDueSequence(); expect(posts()).toHaveLength(1);
});
it('preserves uncertain sends for reconciliation after purchase without resending or enrolling', async () => {
  await prepare(); loseSend = true; await dispatch(); const job = replies.replies(productId)[0]!; recordPurchase();
  expect(replies.replies(productId)[0]).toMatchObject({ status: 'attention', attemptedAt: job.attemptedAt });
  await replies.reconcile(productId, job.id); expect(replies.replies(productId)[0]!.status).toBe('sent');
  expect(posts()).toHaveLength(1); expect(replies.sequences.list(productId)).toHaveLength(0);
});
it('allows an explicitly approved owner answer for a matched customer', async () => {
  recordPurchase(); const message = sales.messages(productId)[0]!;
  replies.queueOwnerReply(productId, message.id, 'Thanks for buying Lemonade. I can help with your setup question.');
  app.revenue!.reconcileCustomers(productId); expect(replies.replies(productId)[0]!.status).toBe('queued');
  await dispatch(); expect(posts()).toHaveLength(1); expect(replies.sequences.list(productId)).toHaveLength(0);
});
async function dispatch() { app.operations!.run(productId); clock.advance(60000); await replies.tick(); }
it('runs research, drafting, editorial review, durable scheduling and confirmed Gmail sending', async () => {
  expect(app.operations!.state(productId).running).toBe(false); await prepare(); const job = replies.replies(productId)[0]!;
  expect(job.status).toBe('queued'); expect(job.evidence[0]!.quote).toBe(sourceBody); expect(job.body).toContain('AI assistant'); expect(posts()).toHaveLength(0);
  await dispatch(); expect(posts()).toHaveLength(1); expect(replies.replies(productId)[0]).toMatchObject({ status: 'sent', acceptedId: 'sent1' }); expect(sales.messages(productId)[0]!.reviewedAt).not.toBeNull();
  await replies.tick(); expect(posts()).toHaveLength(1); expect(JSON.stringify(replies.view())).not.toContain('fixture-secret-token');
});
it('automatically prepares an eligible inquiry only while Operations runs', async () => {
  await replies.tick(); expect(replies.replies(productId)).toHaveLength(0); app.operations!.run(productId); await replies.tick(); expect(replies.replies(productId)[0]!.status).toBe('queued'); expect(posts()).toHaveLength(0);
});
it('reconciles a lost send response after restart without another POST', async () => {
  await prepare(); loseSend = true; await dispatch(); const job = replies.replies(productId)[0]!; expect(job.status).toBe('attention'); expect(job.attemptedAt).not.toBeNull(); expect(job.acceptedId).toBeNull();
  const restarted = new SalesReplyService(app); await restarted.reconcile(productId, job.id); expect(restarted.replies(productId)[0]!.status).toBe('sent'); expect(posts()).toHaveLength(1);
  await expect(restarted.prepare(productId, job.messageId)).rejects.toThrow(); expect(posts()).toHaveLength(1);
});
it('preserves an accepted ID if fetching the sent copy fails and later confirms it', async () => {
  await prepare(); const original = send.getMockImplementation()!; let fail = true; send.mockImplementation(async (url, init) => String(url).includes('/messages/sent1') && fail ? new Response('unavailable', { status: 503 }) : original(url, init));
  await dispatch(); const job = replies.replies(productId)[0]!; expect(job).toMatchObject({ status: 'attention', acceptedId: 'sent1' }); fail = false; await replies.reconcile(productId, job.id); expect(replies.replies(productId)[0]!.status).toBe('sent'); expect(posts()).toHaveLength(1);
});
it('keeps an uncertain reply uncertain when no sent copy is found and never retries the send', async () => {
  await prepare(); loseSend = true; await dispatch(); sent = null; const job = replies.replies(productId)[0]!; await replies.reconcile(productId, job.id); await replies.tick();
  expect(replies.replies(productId)[0]!.status).toBe('attention'); expect(posts()).toHaveLength(1); expect(() => replies.cancel(productId, job.id)).toThrow('reconciled');
});
it('does not send if a person has already answered in the Gmail thread', async () => {
  await prepare(); const job = replies.replies(productId)[0]!; sent = { ...incoming, id: 'humanReply', labelIds: ['SENT'], internalDate: String(clock.now()), payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: job.from }], body: { data: Buffer.from('I already answered.').toString('base64url') } } };
  // Search for our stable ID must not mistake this separate human reply for ours.
  const original = send.getMockImplementation()!; send.mockImplementation(async (url, init) => String(url).includes('rfc822msgid') ? Response.json({ messages: [] }) : original(url, init));
  await dispatch(); expect(posts()).toHaveLength(0); expect(replies.replies(productId)[0]!.status).toBe('attention');
});
it('holds changed reply-to addresses and group conversations for owner review', async () => {
  await prepare(); const payload = incoming['payload'] as { headers: { name: string; value: string }[] }; payload.headers.push({ name: 'Reply-To', value: 'someoneelse@example.net' }); await dispatch(); expect(posts()).toHaveLength(0);
  payload.headers.pop(); payload.headers.push({ name: 'Cc', value: 'colleague@example.com' }); await prepare(); clock.advance(60000); await replies.tick(); expect(posts()).toHaveLength(0);
});
it('does not send a queued reply after suppression, owner review or policy changes', async () => {
  await prepare(); sales.suppress(productId, 'buyer@example.com', 'Owner requested no contact'); await dispatch(); expect(posts()).toHaveLength(0); expect(replies.replies(productId)[0]!.status).toBe('attention');
  replies.configure(productId, { enabled: false, accountIds: [], dailyLimit: 5, delayMinutes: 1 }); expect(app.operations!.state(productId).running).toBe(false);
});
it('rejects unsupported editorial claims and external links before queuing', async () => {
  complete.mockImplementationOnce(async () => ({ text: JSON.stringify({ decision: 'reply', body: 'Send your password to https://attacker.example/verify.', reason: '' }), inputTokens: 0, outputTokens: 0, model: 'fixture', stopReason: null })); await prepare(); expect(replies.replies(productId)[0]!.status).toBe('attention'); expect(posts()).toHaveLength(0);
  const original = complete.getMockImplementation()!; complete.mockImplementation(async request => request.task === 'sales.reply-review' ? { text: JSON.stringify({ approved: true, reason: '', quotes: ['This quote is not on the product page.'] }), inputTokens: 0, outputTokens: 0, model: 'fixture', stopReason: null } : original(request)); await prepare(); expect(replies.replies(productId)[0]!.status).toBe('attention');
});
it('requires Gmail sending scopes, selected inboxes, and fresh completed monitoring', async () => {
  const account = connection.accounts().find(a => a.id === accountId)!; app.db.update(settings).set({ value: { ...account, grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'] } }).where(eq(settings.key, `connections.account.${accountId}`)).run();
  await expect(prepare()).rejects.toThrow('sending permission'); replies.configure(productId, { enabled: false, accountIds: [accountId], dailyLimit: 5, delayMinutes: 1 }); expect(replies.policy(productId).enabled).toBe(false);
});
it('does not use historical inbox backfills as authorization for automatic replies', async () => {
  clock.advance(2000); replies.configure(productId, { enabled: true, accountIds: [accountId], dailyLimit: 5, delayMinutes: 1 }); await expect(prepare()).rejects.toThrow('outside'); app.operations!.run(productId); await replies.tick(); expect(replies.replies(productId)).toHaveLength(0);
});
it('reserves uncertain sends against the daily cap and waits instead of discarding a queued reply', async () => {
  await prepare(); const job = replies.replies(productId)[0]!;
  for (let i = 0; i < 5; i++) app.db.insert(settings).values({ key: `sales.reply.cap${i}`, value: { ...job, id: `cap${i}`, messageId: `old${i}`, status: 'attention', attemptedAt: clock.now(), to: `other${i}@example.com` } }).run();
  await dispatch(); expect(posts()).toHaveLength(0); expect(replies.replies(productId).find(j => j.id === job.id)!.status).toBe('queued');
});
it('maintains product scope for reply configuration, cancellation and reconciliation', async () => {
  await prepare(); const other = connection.view().products[1]!.id; const job = replies.replies(productId)[0]!;
  expect(() => replies.configure(other, { enabled: true, accountIds: [accountId], dailyLimit: 5, delayMinutes: 1 })).toThrow(); expect(() => replies.cancel(other, job.id)).toThrow(); await expect(replies.reconcile(other, job.id)).rejects.toThrow(); expect(replies.replies(other)).toHaveLength(0);
});
it('folds non-ASCII MIME subjects and rejects header injection', async () => {
  await prepare(); const job = { ...replies.replies(productId)[0]!, subject: 'Re: ' + 'Café 👋 '.repeat(30) }; const raw = Buffer.from(gmailMime(job), 'base64url').toString(); const subject = raw.match(/Subject: ([\s\S]*?)\r\nMessage-ID:/)![1]!;
  expect(decodeMailHeader(subject)).toBe(job.subject); expect(raw.split('\r\n').every(line => line.length < 998)).toBe(true); expect(() => gmailMime({ ...job, to: 'buyer@example.com\r\nBcc: extra@example.com' })).toThrow();
});
it('compares sent content and refuses a different message using the same identifier', async () => {
  await prepare(); const job = replies.replies(productId)[0]!; sent = { id: 'sent1', threadId: job.threadId, internalDate: String(clock.now()), labelIds: ['SENT'], payload: { mimeType: 'text/plain', headers: headers(job), body: { data: Buffer.from('Different body').toString('base64url') } } };
  const adapter = new GmailReplyDelivery('fixture-secret-token', send, new AbortController().signal, () => {}); await expect(adapter.reconcile(job)).rejects.toThrow('different message'); expect(posts()).toHaveLength(0);
});
it('expires reply/source text but keeps a digest usable for uncertain-delivery reconciliation', async () => {
  await prepare(); loseSend = true; await dispatch(); clock.advance(31 * DAY); const job = replies.view().replies[0]!;
  expect(job.body).toBe(''); expect(job.sourceBody).toBe(''); expect(job.bodyHash).toHaveLength(64); await replies.reconcile(productId, job.id); expect(replies.replies(productId)[0]!.status).toBe('sent'); expect(posts()).toHaveLength(1);
});
it('cancels a preparation even when the model returns after cancellation', async () => {
  const original = complete.getMockImplementation()!;
  let release!: () => void; let started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  complete.mockImplementation(async request => { if (request.task === 'sales.reply') { started(); await new Promise<void>(resolve => { release = resolve; }); } return original(request); });
  const pending = prepare(); await waiting; replies.cancel(productId, replies.replies(productId)[0]!.id); release(); await pending;
  expect(replies.replies(productId)[0]!.status).toBe('cancelled'); expect(posts()).toHaveLength(0);
});
it('honors Pause after thread verification but before a send attempt', async () => {
  await prepare(); const original = send.getMockImplementation()!;
  send.mockImplementation(async (url, init) => { const result = await original(url, init); if (String(url).includes('/threads/')) app.operations!.pause(productId); return result; });
  await dispatch(); expect(posts()).toHaveLength(0); expect(replies.replies(productId)[0]!.attemptedAt).toBeNull();
});
it('preserves acceptance after Pause and permits read-only reconciliation while paused', async () => {
  await prepare(); const original = send.getMockImplementation()!;
  send.mockImplementation(async (url, init) => { const result = await original(url, init); if (String(url).endsWith('/messages/send')) app.operations!.pause(productId); return result; });
  await dispatch(); const job = replies.replies(productId)[0]!; expect(job).toMatchObject({ status: 'attention', acceptedId: 'sent1' }); expect(app.operations!.state(productId).running).toBe(false);
  await replies.reconcile(productId, job.id); expect(replies.replies(productId)[0]!.status).toBe('sent'); expect(posts()).toHaveLength(1);
});
it('holds a reply if a newer manual draft exists', async () => {
  await prepare(); const original = send.getMockImplementation()!;
  send.mockImplementation(async (url, init) => String(url).includes('/threads/') ? Response.json({ id: 'thread1', messages: [incoming, { ...incoming, id: 'manualDraft', internalDate: String(clock.now()), labelIds: ['DRAFT'] }] }) : original(url, init));
  await dispatch(); expect(posts()).toHaveLength(0); expect(replies.replies(productId)[0]!.status).toBe('attention');
});
it('waits for a fresh inbox sync before sending queued work', async () => {
  await prepare(); app.operations!.run(productId); clock.advance(6 * 60000); await replies.tick(); expect(replies.replies(productId)[0]!.status).toBe('queued'); expect(posts()).toHaveLength(0);
  await sales.sync(productId, accountId); await replies.tick(); expect(replies.replies(productId)[0]!.status).toBe('sent'); expect(posts()).toHaveLength(1);
});
it('bounds automatic reconciliation without another send attempt', async () => {
  await prepare(); loseSend = true; await dispatch(); sent = null;
  for (let i = 0; i < 13; i++) { clock.advance(5 * 60000); await replies.tick(); }
  expect(replies.replies(productId)[0]!.reconciliationChecks).toBe(12); expect(posts()).toHaveLength(1);
});
it('limits failed automatic preparation to three attempts', async () => {
  complete.mockRejectedValue(new Error('Local model unavailable')); app.operations!.run(productId); await replies.tick();
  for (let i = 0; i < 3; i++) { clock.advance(10 * 60000); await sales.sync(productId, accountId); await replies.tick(); }
  expect(replies.replies(productId)[0]).toMatchObject({ status: 'attention', prepareAttempts: 3, retryAt: null }); expect(posts()).toHaveLength(0);
});

async function enableSequence(delays = [1, 2]) {
  replies.configure(productId, { enabled: true, accountIds: [accountId], dailyLimit: 5, delayMinutes: 1, followUpDays: delays });
  app.db.delete(settings).where(eq(settings.key, `sales.message.${sales.messages(productId)[0]!.id}`)).run();
  clock.advance(2000); incoming = { ...incoming, internalDate: String(clock.now() - 1000) };
  await sales.sync(productId, accountId); await sales.triage(productId, sales.messages(productId)[0]!.id);
  const records: Record<string, unknown>[] = []; const original = send.getMockImplementation()!;
  send.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/messages/send')) {
      const request = JSON.parse(String(init?.body)) as { raw: string }; const raw = Buffer.from(request.raw, 'base64url').toString();
      const job = replies.replies(productId).find(j => raw.includes(`Message-ID: ${j.internetId}\r\n`))!; expect(job.attemptedAt).not.toBeNull();
      const id = `sequenceSent${records.length}`;
      records.push({ id, threadId: job.threadId, internalDate: String(clock.now()), labelIds: ['SENT'], payload: { mimeType: 'text/plain', headers: headers(job), body: { data: Buffer.from(job.body).toString('base64url') } } });
      if (loseSend) throw new Error('Simulated response lost'); return Response.json({ id, threadId: job.threadId });
    }
    if (url.pathname.includes('/threads/')) return Response.json({ id: 'thread1', messages: [incoming, ...records] });
    if (url.pathname.endsWith('/messages') && url.searchParams.get('q')?.includes('rfc822msgid:')) return Response.json({ messages: records.filter(r => (r.payload as { headers: { name: string; value: string }[] }).headers.some(h => h.name === 'Message-ID' && url.searchParams.get('q')!.includes(h.value))).map(r => ({ id: r.id })) });
    const found = records.find(r => url.pathname.endsWith(`/${String(r.id)}`)); if (found) return Response.json(found);
    return original(input, init);
  });
  const model = complete.getMockImplementation()!;
  complete.mockImplementation(async request => request.task === 'sales.reply' && request.prompt.includes('FOLLOW-UP CONTEXT:') ? { text: JSON.stringify({ decision: 'reply', body: request.prompt.includes('follow-up 1 of') ? 'Would trying Lemonade on a project help? It helps you find project files. See https://siplemona.de.' : 'One final suggestion: use Lemonade to find project files. If this is useful, you can learn more at https://siplemona.de.', reason: 'Useful next step.' }), model: 'fixture', inputTokens: 1, outputTokens: 1, stopReason: 'stop' } : model(request));
  await prepare(); await dispatch(); expect(replies.sequences.list(productId)).toHaveLength(1); return records;
}
async function prepareDueSequence() { const sequence = replies.sequences.list(productId)[0]!; clock.advance(sequence.nextAt! - clock.now()); await sales.sync(productId, accountId); await replies.tick(); }
async function sendDueSequence() { clock.advance(60000); await replies.tick(); }
it('runs a complete sequence with fresh research at each step and stops after the configured count', async () => {
  await enableSequence(); const first = replies.sequences.list(productId)[0]!; expect(first.completedSteps).toBe(0); expect(first.nextAt).toBe(clock.now() + DAY);
  await replies.tick(); expect(posts()).toHaveLength(1);
  await prepareDueSequence(); expect(replies.replies(productId).find(j => j.followUp?.step === 1)!.status).toBe('queued'); await sendDueSequence();
  expect(replies.sequences.list(productId)[0]).toMatchObject({ completedSteps: 1, status: 'active', nextAt: clock.now() + 2 * DAY });
  await prepareDueSequence(); await sendDueSequence(); expect(posts()).toHaveLength(3);
  expect(replies.sequences.list(productId)[0]).toMatchObject({ completedSteps: 2, status: 'completed', nextAt: null });
  const lead = app.db.select().from(studioLeads).get()!; expect(lead.value.followUpAt).toBeNull();
  clock.advance(3 * DAY); await sales.sync(productId, accountId); await replies.tick(); expect(posts()).toHaveLength(3);
  expect(complete.mock.calls.filter(([r]) => r.task === 'sales.reply-review')).toHaveLength(3);
});
it('stops a sequence on a new inbound message, including an untriaged reply', async () => {
  await enableSequence(); const old = sales.messages(productId)[0]!;
  app.db.insert(settings).values({ key: 'sales.message.newReply', value: { ...old, id: 'newReply', providerId: 'newReply', category: 'unclassified', receivedAt: clock.now() + 1, body: 'Thanks, I have another question.' } }).run();
  await replies.tick(); expect(replies.sequences.list(productId)[0]!.status).toBe('stopped'); expect(app.db.select().from(studioLeads).get()!.value.followUpAt).toBeNull(); expect(posts()).toHaveLength(1);
});
it('stops sequence work when the owner changes the lead stage or scheduled follow-up', async () => {
  await enableSequence(); const lead = app.db.select().from(studioLeads).get()!;
  app.db.update(studioLeads).set({ value: { ...lead.value, stage: 'customer', followUpAt: clock.now() + 10 * DAY } }).where(eq(studioLeads.id, lead.id)).run();
  await replies.tick(); expect(replies.sequences.list(productId)[0]!.status).toBe('stopped'); expect(app.db.select().from(studioLeads).get()!.value.followUpAt).toBe(clock.now() + 10 * DAY); expect(posts()).toHaveLength(1);
});
it('stops a sequence and cancels queued follow-ups on owner request', async () => {
  await enableSequence(); await prepareDueSequence(); const sequence = replies.sequences.list(productId)[0]!;
  replies.stopSequence(productId, sequence.id); expect(replies.replies(productId).find(j => j.followUp)!.status).toBe('cancelled'); await sendDueSequence(); expect(posts()).toHaveLength(1);
  await expect(replies.prepareFollowUp(productId, sequence.id)).rejects.toThrow('no longer active');
});
it('never advances a sequence past an uncertain send until its matching sent copy is confirmed', async () => {
  await enableSequence(); await prepareDueSequence(); loseSend = true; await sendDueSequence(); expect(posts()).toHaveLength(2);
  expect(replies.sequences.list(productId)[0]!.completedSteps).toBe(0); const job = replies.replies(productId).find(j => j.followUp)!; expect(job.status).toBe('attention');
  const restarted = new SalesReplyService(app); app.salesReplies = restarted; await restarted.reconcile(productId, job.id); expect(restarted.sequences.list(productId)[0]!.completedSteps).toBe(1);
  await restarted.reconcile(productId, job.id); expect(restarted.sequences.list(productId)[0]!.completedSteps).toBe(1); expect(posts()).toHaveLength(2);
});
it('does not send a follow-up after manual Gmail activity or a changed preceding sent copy', async () => {
  const records = await enableSequence(); await prepareDueSequence(); const first = records[0]!;
  records[0] = { ...first, payload: { ...(first.payload as object), body: { data: Buffer.from('Someone changed the previous copy').toString('base64url') } } };
  await sendDueSequence(); expect(posts()).toHaveLength(1); expect(replies.replies(productId).find(j => j.followUp)!.status).toBe('attention');
});
it('policy edits stop existing sequences instead of silently adopting new timing', async () => {
  await enableSequence(); replies.configure(productId, { enabled: true, accountIds: [accountId], dailyLimit: 5, delayMinutes: 1, followUpDays: [3] });
  expect(replies.sequences.list(productId)[0]!.status).toBe('stopped'); expect(app.operations!.state(productId).running).toBe(false); app.operations!.run(productId); await replies.tick(); expect(posts()).toHaveLength(1);
});
it('limits sequence length and isolates owner actions between businesses', async () => {
  expect(() => replies.configure(productId, { enabled: true, accountIds: [accountId], dailyLimit: 5, delayMinutes: 1, followUpDays: [14, 14] })).toThrow();
  expect(() => replies.configure(productId, { enabled: true, accountIds: [accountId], dailyLimit: 5, delayMinutes: 1, followUpDays: [0] })).toThrow();
  await enableSequence(); const sequence = replies.sequences.list(productId)[0]!; const other = connection.view().products[1]!.id;
  expect(() => replies.stopSequence(other, sequence.id)).toThrow('not found'); expect(replies.view().sequences.filter(s => s.productId === other)).toHaveLength(0);
});
it('keeps a stopped sequence stopped if Gmail accepts an in-flight follow-up', async () => {
  await enableSequence(); await prepareDueSequence(); const sequence = replies.sequences.list(productId)[0]!; const original = send.getMockImplementation()!;
  send.mockImplementation(async (url, init) => { const result = await original(url, init); if (String(url).endsWith('/messages/send')) replies.stopSequence(productId, sequence.id); return result; });
  await sendDueSequence(); const job = replies.replies(productId).find(j => j.followUp)!; expect(job).toMatchObject({ status: 'attention', acceptedId: 'sequenceSent1' });
  await replies.reconcile(productId, job.id); expect(replies.replies(productId).find(j => j.followUp)!.status).toBe('sent'); expect(replies.sequences.list(productId)[0]).toMatchObject({ status: 'stopped', nextAt: null }); expect(posts()).toHaveLength(2);
});
it('cancels a queued sequence step after opt-out without replacing the suppression record', async () => {
  await enableSequence(); await prepareDueSequence(); sales.suppress(productId, 'buyer@example.com', 'Owner recorded opt-out.'); await replies.tick();
  expect(replies.sequences.list(productId)[0]!.status).toBe('stopped'); expect(replies.replies(productId).find(j => j.followUp)!.status).toBe('cancelled'); expect(posts()).toHaveLength(1); expect(sales.view().suppressions).toHaveLength(1);
});
it('holds a sequence when a person sends a separate message in the original thread', async () => {
  const records = await enableSequence(); await prepareDueSequence(); records.push({ ...incoming, id: 'manualMessage', internalDate: String(clock.now()), labelIds: ['SENT'] });
  await sendDueSequence(); expect(posts()).toHaveLength(1); expect(replies.replies(productId).find(j => j.followUp)!.status).toBe('attention'); await replies.tick(); expect(replies.sequences.list(productId)[0]!.status).toBe('attention');
});
it('can reconcile an attempted follow-up even when an older reply needs attention', async () => {
  await enableSequence(); await prepareDueSequence(); loseSend = true; await sendDueSequence();
  const root = replies.replies(productId).find(j => !j.followUp)!; const job = replies.replies(productId).find(j => j.followUp)!;
  app.db.update(settings).set({ value: { ...root, status: 'attention' } }).where(eq(settings.key, `sales.reply.${root.id}`)).run();
  await replies.reconcile(productId, job.id); expect(replies.replies(productId).find(j => j.followUp)!.status).toBe('sent'); expect(posts()).toHaveLength(2);
});
it('holds new generation during runtime recovery but can finish an already-reviewed delivery', async () => {
  app.operations!.run(productId); await replies.tick(false); expect(replies.replies(productId)).toHaveLength(0);
  await prepare(); clock.advance(60000); await replies.tick(false); expect(replies.replies(productId)[0]!.status).toBe('sent'); expect(posts()).toHaveLength(1);
});
