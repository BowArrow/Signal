import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { fixedClock } from '../src/core/lib/clock.js';
import { settings, studioLeads } from '../src/core/db/schema.js';
import { ConnectionService } from '../src/core/connections/service.js';
import { SalesService } from '../src/core/sales/service.js';
import { OutreachService } from '../src/core/sales/outreach-service.js';
import { OperationsService } from '../src/core/operations/service.js';
import { LocalRuntime } from '../src/core/runtime/manager.js';
import { agentClient, agentModel } from '../src/core/runtime/client.js';
import { runtimeSettings, saveRuntimeSettings } from '../src/core/runtime/settings.js';
import type { ConnectedAccount } from '../src/shared/connections.js';

const clock = fixedClock(Date.now()); const app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger }); const runtime = new LocalRuntime(app);
const folder = 'data/outreach-validation'; mkdirSync(folder, { recursive: true });
let sent: Record<string, unknown> | null = null; let sends = 0; let productId = '';
try {
  assert.notEqual(app.env.SIGNAL_OFFLINE, '1'); saveRuntimeSettings(app, { ...runtimeSettings(app), provider: 'local' }); await runtime.start();
  const model = agentModel(app, 'marketing'); assert((await runtime.status()).models.includes(model)); console.log(JSON.stringify({ stage: 'runtime', model }));
  const client = agentClient(app);
  const recorded = { available: () => client.available(), complete: async (request: Parameters<typeof client.complete>[0]) => { const result = await client.complete(request); appendFileSync(`${folder}/local-responses.jsonl`, JSON.stringify({ task: request.task, text: result.text }) + '\n'); return result; } };
  app.connections = new ConnectionService(app, { available: () => true, get: () => JSON.stringify({ accessToken: 'synthetic-token' }), set: () => {}, delete: () => {} }, undefined, async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, 'https://gmail.googleapis.com');
    if (url.pathname.endsWith('/messages/send')) {
      sends++; const job = app.outreach!.jobs(productId)[0]!; assert.notEqual(job.attemptedAt, null);
      const mime = Buffer.from(JSON.parse(String(init?.body)).raw, 'base64url').toString(); assert.equal(Buffer.from(mime.split('\r\n\r\n')[1]!, 'base64').toString().replace(/\r\n/g, '\n'), job.body);
      sent = { id: 'syntheticSent1', threadId: 'syntheticThread1', labelIds: ['SENT'], payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: job.from }, { name: 'To', value: job.to }, { name: 'Subject', value: job.subject }, { name: 'Message-ID', value: job.internetId }, { name: 'X-Signal-Outreach-ID', value: job.id }], body: { data: Buffer.from(job.body).toString('base64url') } } };
      return Response.json({ id: 'syntheticSent1' });
    }
    if (url.pathname.endsWith('/messages')) return Response.json({ messages: url.searchParams.get('q')?.includes('rfc822msgid:') && sent ? [{ id: 'syntheticSent1' }] : [] });
    if (url.pathname.endsWith('/syntheticSent1') && sent) return Response.json(sent);
    throw new Error('Unexpected synthetic transport request');
  });
  const product = app.connections.view().products.find(p => p.name.toLowerCase() === (process.argv[2] ?? 'lemonade').toLowerCase()); assert(product); productId = product.id;
  for (const id of ['inbox', 'website']) { const account: ConnectedAccount = { id, productId, provider: id === 'inbox' ? 'gmail' : 'signal-blog', label: 'Synthetic transport', identity: 'sales@example.org', username: '', site: '', status: 'verified', detail: 'No owner credentials or real send', createdAt: clock.now(), checkedAt: clock.now(), expiresAt: null, refreshable: false, grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'] }; app.db.insert(settings).values({ key: `connections.account.${id}`, value: account }).run(); }
  app.sales = new SalesService(app); app.sales.configure(productId, { accountId: 'inbox', since: clock.now() - 86400000, autoSync: true, aiTriage: true });
  const refresh = () => { const source = app.sales!.source(productId, 'inbox'); const value = { ...source, status: 'current', lastCompleteAt: clock.now() }; app.db.insert(settings).values({ key: 'sales.source.inbox', value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run(); }; refresh();
  app.operations = new OperationsService(app); app.operations.configure(productId, { objective: 'Help prospects try one useful task.', accountIds: ['website'], dailyLimit: 1, intervalHours: 24 });
  app.outreach = new OutreachService(app, recorded); app.outreach.configure(productId, { enabled: true, accountId: 'inbox', objective: 'Offer an approachable first product workflow to a new opted-in prospect.', mailingAddress: 'Synthetic Business, 123 Example Street, Example City', dailyLimit: 2, delayMinutes: 5 });
  app.db.insert(studioLeads).values({ id: 'synthetic-lead', productId, value: { name: 'Prospective customer', contact: 'prospect@example.test', permission: 'opted-in', stage: 'discovered', source: 'Synthetic signup for validation only', notes: '', followUpAt: null, campaignId: '' }, createdAt: clock.now() }).run();
  app.operations.run(productId); await app.outreach.tick();
  for (let attempt = 0; attempt < 3; attempt++) { const job = app.outreach.jobs(productId)[0]!; console.log(JSON.stringify({ status: job.status, detail: job.detail, prepareAttempts: job.prepareAttempts })); if (job.status === 'queued') break; if (job.retryAt === null) break; clock.advance(Math.max(1, job.retryAt - clock.now())); refresh(); await app.outreach.tick(); }
  let job = app.outreach.jobs(productId)[0]!; writeFileSync(`${folder}/local-${product.name.toLowerCase()}.json`, JSON.stringify({ model, realEmailSent: false, job }, null, 2)); assert.equal(job.status, 'queued');
  clock.advance(Math.max(1, job.dueAt - clock.now())); refresh(); await app.outreach.tick(); job = app.outreach.jobs(productId)[0]!;
  writeFileSync(`${folder}/local-${product.name.toLowerCase()}.json`, JSON.stringify({ model, realEmailSent: false, simulatedSends: sends, job }, null, 2)); assert.equal(job.status, 'sent'); assert.equal(sends, 1);
  console.log(JSON.stringify({ ok: true, business: product.name, model, prepareAttempts: job.prepareAttempts, realResearch: true, realLocalAgent: true, simulatedSends: sends, realEmailSent: false }));
} finally { await app.outreach?.stop(); runtime.stop(); app.close(); }
