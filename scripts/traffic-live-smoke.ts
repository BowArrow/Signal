// Real CPU inference and current product inspection; all analytics and publishing are synthetic.
import { mkdirSync, writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import assert from 'node:assert/strict';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { LocalRuntime } from '../src/core/runtime/manager.js';
import { runtimeSettings, saveRuntimeSettings } from '../src/core/runtime/settings.js';
import { marketingSettings, saveMarketingSettings } from '../src/core/marketing/store.js';
import { ConnectionService } from '../src/core/connections/service.js';
import { GrowthEngine } from '../src/core/growth/engine.js';
import { OperationsService } from '../src/core/operations/service.js';
import { growthTasks, marketingToolCalls, settings } from '../src/core/db/schema.js';
import { seedTrafficFixture } from './traffic-fixture.js';
import type { ConnectedAccount } from '../src/shared/connections.js';

const runId = Date.now(), folder = 'data/operations-validation'; mkdirSync(folder, { recursive: true });
const trace: unknown[] = [], originalFetch = globalThis.fetch; let call = 0;
globalThis.fetch = async (url, init) => {
  if (String(url) !== 'http://127.0.0.1:11434/api/chat') return originalFetch(url, init);
  const request = JSON.parse(String(init?.body)); assert.equal(request.options.num_gpu, 0);
  const id = ++call, started = Date.now(), kind = request.messages[0]?.content.includes('CURRENT_SOURCE_TEXT:') ? 'review' : request.messages[0]?.content.includes('Compare the reader actions') ? 'followup-review' : 'compose';
  console.log(JSON.stringify({ stage: 'model-start', call: id, kind, model: request.model }));
  const response = await originalFetch(url, init);
  trace.push({ call: id, kind, elapsedMs: Date.now() - started, response: await response.clone().json() });
  writeFileSync(`${folder}/traffic-cpu-trace-${runId}.json`, JSON.stringify(trace, null, 2));
  console.log(JSON.stringify({ stage: 'model-finished', call: id, kind, elapsedMs: Date.now() - started })); return response;
};
const app = createApp({ databaseUrl: ':memory:', logger: silentLogger });
const runtime = new LocalRuntime(app), engine = new GrowthEngine(app); let taskId: string | null = null;
const timeout = setTimeout(() => { if (taskId) engine.cancel(taskId); }, 20 * 60000);
let posts = 0;
try {
  saveRuntimeSettings(app, { ...runtimeSettings(app), localDevice: 'cpu', provider: 'local' });
  if (process.argv[3]) saveMarketingSettings(app, { ...marketingSettings(app), model: process.argv[3] });
  app.connections = new ConnectionService(app, { available: () => true, get: key => key.startsWith('account.') ? JSON.stringify({ accessToken: 'fixture-only' }) : undefined, set: () => {}, delete: () => {} }, undefined, async (url, init) => {
    if (String(url).includes('getSession')) return Response.json({ did: 'did:plc:fixture' });
    if (String(url).includes('getRecord')) return Response.json({ error: 'RecordNotFound' }, { status: 400 });
    if (String(url).includes('createRecord')) { posts++; const value = JSON.parse(String(init!.body)); return Response.json({ uri: `at://did:plc:fixture/app.bsky.feed.post/${value.rkey}`, cid: 'fixture-cid' }); }
    throw Error('Unexpected publication request');
  });
  const product = app.connections.view().products.find(p => p.name.toLowerCase() === (process.argv[2] ?? 'cinegen').toLowerCase()); if (!product) throw Error('Unknown business');
  const account: ConnectedAccount = { id: 'fixture-social', productId: product.id, provider: 'bluesky', label: 'Simulated Bluesky', site: '', username: '', identity: 'Fixture only', status: 'verified', detail: '', checkedAt: Date.now(), createdAt: Date.now(), expiresAt: null, refreshable: false, grantedScopes: [] };
  app.db.insert(settings).values({ key: `connections.account.${account.id}`, value: account }).run();
  const operations = new OperationsService(app); app.operations = operations;
  operations.configure(product.id, { objective: 'Help buyers try a concrete workflow supported by current product facts. Use the measured selection decision to choose a distinct next task.', accountIds: [account.id], intervalHours: 24, dailyLimit: 1 });
  for (const delivery of seedTrafficFixture(app, product.id, account.id)) app.db.insert(settings).values({ key: `operations.delivery.${delivery.id}`, value: delivery }).run();
  await runtime.start(); assert.ok((await runtime.status()).models.includes(marketingSettings(app).model));
  operations.run(product.id); operations.schedule(); taskId = operations.state(product.id).taskId;
  assert.equal(operations.state(product.id).learning?.mode, 'test-interest'); console.log(JSON.stringify({ stage: 'selected', business: product.name, learning: operations.state(product.id).learning, simulatedTraffic: true }));
  await engine.runNext(['marketing']); await operations.tick();
  const task = app.db.select().from(growthTasks).where(eq(growthTasks.id, taskId!)).get();
  const calls = app.db.select().from(marketingToolCalls).where(eq(marketingToolCalls.taskId, taskId!)).all();
  const delivery = operations.deliveries().find(d => d.taskId === taskId);
  writeFileSync(`${folder}/traffic-cpu-${product.name.toLowerCase()}-${runId}.json`, JSON.stringify({ testMode: 'Real CPU inference and current source; synthetic analytics and simulated publication', task, calls, delivery, simulatedPublications: posts }, null, 2));
  console.log(JSON.stringify({ stage: 'finished', task: task?.status, error: task?.error, body: delivery?.body, simulatedPublications: posts, delivery: delivery?.status }));
  assert.equal(task?.status, 'done'); assert.equal(delivery?.status, 'published'); assert.equal(delivery?.learning?.mode, 'test-interest'); assert.equal(posts, 1);
} finally { clearTimeout(timeout); await engine.stop(); runtime.stop(); app.close(); globalThis.fetch = originalFetch; }
