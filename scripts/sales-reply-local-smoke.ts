import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { fixedClock, DAY } from '../src/core/lib/clock.js';
import { settings } from '../src/core/db/schema.js';
import { ConnectionService, type CredentialVault } from '../src/core/connections/service.js';
import { OperationsService } from '../src/core/operations/service.js';
import { SalesService } from '../src/core/sales/service.js';
import { SalesReplyService } from '../src/core/sales/reply-service.js';
import { LocalRuntime } from '../src/core/runtime/manager.js';
import { agentClient, agentModel } from '../src/core/runtime/client.js';
import { runtimeSettings, saveRuntimeSettings } from '../src/core/runtime/settings.js';

// Live installed local inference and public product research. Mailbox and website
// account operations are intercepted; no owner credentials or real sends.
const outlook = process.argv[3] === 'outlook';
const clock = fixedClock(Date.now()); const app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger });
const runtime = new LocalRuntime(app); let replies: SalesReplyService | undefined; let sales: SalesService | undefined;
let incoming: Record<string, unknown>; const sent: Record<string, unknown>[] = []; let postCount = 0; let productId = '';
try {
  saveRuntimeSettings(app, { ...runtimeSettings(app), provider: 'local' }); await runtime.start();
  const model = agentModel(app, 'marketing'); assert((await runtime.status()).models.includes(model), 'Configured local model must already be installed.');
  console.log(JSON.stringify({ stage: 'runtime', model }));
  mkdirSync('data/sales-validation', { recursive: true });
  const client = agentClient(app); const recordedClient = { available: () => client.available(), complete: async (request: Parameters<typeof client.complete>[0]) => { const result = await client.complete(request); appendFileSync('data/sales-validation/local-model-responses.jsonl', JSON.stringify({ task: request.task, text: result.text }) + '\n'); return result; } };
  const data = new Map<string, string>(); const vault: CredentialVault = { available: () => true, get: key => data.get(key), set: (key, value) => { data.set(key, value); }, delete: key => { data.delete(key); } };
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal(init?.redirect, 'error');
    if (['siplemona.de', 'cinegenaimedia.com'].includes(url.hostname)) { assert.equal(init?.method ?? 'GET', 'GET'); return Response.json({ error: 'Post not found' }, { status: 404 }); }
    if (outlook) {
      assert.equal(url.origin, 'https://graph.microsoft.com');
      if (url.pathname === '/v1.0/me') return Response.json({ mail: 'sales@example.org' });
      assert(new Headers(init?.headers).get('prefer')?.includes('ImmutableId'));
      if (url.pathname.endsWith('/createReply')) {
        assert.equal(init?.method, 'POST'); const mime = Buffer.from(String(init?.body), 'base64').toString();
        const job = replies!.replies(productId).find(j => mime.includes(`Message-ID: ${j.internetId}\r\n`))!; assert.notEqual(job.attemptedAt, null);
        assert.equal(Buffer.from(mime.split('\r\n\r\n')[1]!, 'base64').toString().replace(/\r\n/g, '\n'), job.body);
        const id = `syntheticDraft${sent.length + 1}`; const address = (value: string) => ({ emailAddress: { address: value } }); const date = new Date(clock.now()).toISOString();
        sent.push({ id, conversationId: job.threadId, internetMessageId: `<exchange-${id}@example.org>`, parentFolderId: 'drafts', isDraft: true, hasAttachments: false, subject: job.subject, from: address(job.from), sender: address(job.from), toRecipients: [address(job.to)], ccRecipients: [], bccRecipients: [], replyTo: [], receivedDateTime: date, sentDateTime: date, createdDateTime: date, body: { contentType: 'text', content: job.body }, internetMessageHeaders: [{ name: 'In-Reply-To', value: job.inReplyTo }] });
        return Response.json({ id }, { status: 201 });
      }
      if (url.pathname.endsWith('/send')) {
        assert.equal(init?.method, 'POST'); const id = decodeURIComponent(url.pathname.split('/').at(-2)!); const draft = sent.find(m => m.id === id)!;
        assert(draft); assert(replies!.replies(productId).some(j => j.acceptedId === id && j.attemptedAt !== null));
        draft.isDraft = false; draft.parentFolderId = 'sentitems'; postCount++; return new Response(null, { status: 202 });
      }
      assert.equal(init?.method ?? 'GET', 'GET');
      if (url.pathname.includes('/mailFolders/')) return Response.json({ id: url.pathname.split('/').at(-1) });
      if (url.pathname === '/v1.0/me/messages') return Response.json({ value: [incoming, ...sent] });
      const found = [incoming, ...sent].find(m => m.id === decodeURIComponent(url.pathname.split('/').at(-1)!)); assert(found, 'Unexpected synthetic Outlook request'); return Response.json(found);
    }
    assert.equal(url.origin, 'https://gmail.googleapis.com');
    if (url.pathname.endsWith('/messages/send')) {
      assert.equal(init?.method, 'POST'); postCount++; const raw = Buffer.from((JSON.parse(String(init?.body)) as { raw: string }).raw, 'base64url').toString(); const job = replies!.replies(productId).find(j => raw.includes(`Message-ID: ${j.internetId}\r\n`))!; assert.notEqual(job.attemptedAt, null);
      const mime = JSON.parse(String(init?.body)) as { raw: string; threadId: string }; assert.equal(mime.threadId, job.threadId); assert(Buffer.from(mime.raw, 'base64url').toString().includes(`To: ${job.to}`));
      const id = `syntheticSent${postCount}`; sent.push({ id, threadId: job.threadId, internalDate: String(clock.now()), labelIds: ['SENT'], payload: { mimeType: 'text/plain', headers: [{ name: 'Message-ID', value: job.internetId }, { name: 'In-Reply-To', value: job.inReplyTo }, { name: 'From', value: job.from }, { name: 'To', value: job.to }, { name: 'Subject', value: job.subject }], body: { data: Buffer.from(job.body).toString('base64url') } } });
      return Response.json({ id, threadId: job.threadId });
    }
    assert.equal(init?.method ?? 'GET', 'GET');
    if (url.pathname.endsWith('/profile')) return Response.json({ emailAddress: 'sales@example.org' });
    if (url.pathname.includes('/threads/')) return Response.json({ id: 'syntheticThread', messages: [incoming, ...sent] });
    if (url.pathname.endsWith('/messages')) return Response.json({ messages: url.searchParams.get('q')?.includes('rfc822msgid:') ? sent.filter(r => (r.payload as { headers: { name: string; value: string }[] }).headers.some(h => h.name === 'Message-ID' && url.searchParams.get('q')!.includes(h.value))).map(r => ({ id: r.id })) : [{ id: 'syntheticInquiry' }] });
    if (url.pathname.endsWith('/syntheticInquiry')) return Response.json(incoming);
    const found = sent.find(r => url.pathname.endsWith(`/${String(r.id)}`)); if (found) return Response.json(found);
    throw new Error('Unexpected synthetic request');
  };
  const connection = new ConnectionService(app, vault, undefined, transport); app.connections = connection; const product = connection.view().products.find(p => p.name.toLowerCase() === (process.argv[2] ?? 'lemonade').toLowerCase()); assert(product, 'Unknown business'); productId = product.id;
  await connection.connect({ productId, provider: outlook ? 'outlook' : 'gmail', label: 'Synthetic sales inbox', credential: 'synthetic-token' }); const account = connection.accounts()[0]!;
  app.db.update(settings).set({ value: { ...account, grantedScopes: outlook ? ['Mail.Read', 'Mail.ReadWrite', 'Mail.Send'] : ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'] } }).where(eq(settings.key, `connections.account.${account.id}`)).run();
  await connection.connect({ productId, provider: 'signal-blog', label: 'Synthetic website account', credential: 'synthetic-blog-token' });
  app.operations = new OperationsService(app); app.operations.configure(productId, { objective: 'Help buyers understand the product.', accountIds: [connection.accounts().find(a => a.provider === 'signal-blog')!.id], intervalHours: 24, dailyLimit: 1 });
  sales = new SalesService(app); app.sales = sales; sales.configure(productId, { accountId: account.id, since: clock.now() - DAY, autoSync: true, aiTriage: true });
  replies = new SalesReplyService(app, recordedClient); app.salesReplies = replies; replies.configure(productId, { enabled: true, accountIds: [account.id], dailyLimit: 5, delayMinutes: 1, followUpDays: [1] }); clock.advance(2000);
  const completePreparation = async (followUp: boolean) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const job = replies!.replies(productId).find(j => Boolean(j.followUp) === followUp);
      if (!job || job.status !== 'attention' || job.retryAt === null || job.prepareAttempts >= 3) return job;
      clock.set(job.retryAt); await sales!.sync(productId, account.id); await replies!.tick();
    }
    return replies!.replies(productId).find(j => Boolean(j.followUp) === followUp);
  };
  incoming = { id: 'syntheticInquiry', threadId: 'syntheticThread', internalDate: String(clock.now() - 1000), labelIds: ['INBOX'], payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'buyer@example.com' }, { name: 'To', value: 'sales@example.org' }, { name: 'Subject', value: `Learning about ${product.name}` }, { name: 'Message-ID', value: '<synthetic-inquiry@example.com>' }], body: { data: Buffer.from(product.name === 'Lemonade' ? 'I waste time searching for project files. Can Lemonade help me find them, and where can I learn more?' : 'I want to create a video for my business. What can CineGen help me do, and where can I learn more?').toString('base64url') } } };
  if (outlook) {
    const payload = incoming.payload as { body: { data: string } }; const address = (value: string) => ({ emailAddress: { address: value } }); const date = new Date(clock.now() - 1000).toISOString();
    incoming = { id: 'syntheticInquiry', conversationId: 'syntheticThread', internetMessageId: '<synthetic-inquiry@example.com>', parentFolderId: 'inbox', isDraft: false, hasAttachments: false, subject: `Learning about ${product.name}`, from: address('buyer@example.com'), sender: address('buyer@example.com'), toRecipients: [address('sales@example.org')], ccRecipients: [], bccRecipients: [], replyTo: [], receivedDateTime: date, sentDateTime: date, createdDateTime: date, body: { contentType: 'text', content: Buffer.from(payload.body.data, 'base64url').toString() }, internetMessageHeaders: [] };
  }
  await sales.sync(productId, account.id); await sales.triage(productId, sales.messages(productId)[0]!.id); console.log(JSON.stringify({ stage: 'triage', category: sales.messages(productId)[0]!.category }));
  assert.equal(sales.messages(productId)[0]!.category, 'inquiry'); app.operations.run(productId); await replies.tick();
  const prepared = await completePreparation(false);
  mkdirSync('data/sales-validation', { recursive: true }); writeFileSync(`data/sales-validation/local-reply-${outlook ? 'outlook-' : ''}${product.name.toLowerCase()}.json`, JSON.stringify({ syntheticMailbox: true, realEmailSent: false, model, reply: prepared }, null, 2));
  console.log(JSON.stringify({ stage: 'prepared', status: prepared?.status, evidenceCount: prepared?.evidence.length })); assert.equal(prepared?.status, 'queued');
  clock.advance(60000); await replies.tick(); assert.equal(replies.replies(productId)[0]!.status, 'sent'); await replies.tick(); assert.equal(postCount, 1);
  clock.advance(DAY); await sales.sync(productId, account.id); await replies.tick(); const followUp = await completePreparation(true);
  writeFileSync(`data/sales-validation/local-followup-${outlook ? 'outlook-' : ''}${product.name.toLowerCase()}.json`, JSON.stringify({ syntheticMailbox: true, realEmailSent: false, model, followUp }, null, 2));
  console.log(JSON.stringify({ stage: 'followup', status: followUp?.status, evidenceCount: followUp?.evidence.length })); assert.equal(followUp?.status, 'queued');
  clock.advance(60000); await replies.tick(); assert.equal(replies.sequences.list(productId)[0]!.status, 'completed'); assert.equal(postCount, 2);
  console.log(JSON.stringify({ ok: true, product: product.name, mailbox: outlook ? 'outlook' : 'gmail', model, liveProductResearch: true, simulatedSends: postCount, completedSequence: true, realEmailSent: false }));
} finally { await replies?.stop(); await sales?.stop(); runtime.stop(); app.close(); }
