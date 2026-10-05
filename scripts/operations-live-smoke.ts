import { mkdirSync, writeFileSync } from 'node:fs';
import { createApp } from '../src/core/app.js';
import { LocalRuntime } from '../src/core/runtime/manager.js';
import { ConnectionService, type CredentialVault } from '../src/core/connections/service.js';
import { OperationsService } from '../src/core/operations/service.js';
import { GrowthEngine } from '../src/core/growth/engine.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { growthTasks, marketingToolCalls, settings } from '../src/core/db/schema.js';
import { eq } from 'drizzle-orm';
import assert from 'node:assert/strict';
import { freemem } from 'node:os';
import { runtimeSettings, saveRuntimeSettings } from '../src/core/runtime/settings.js';
import { marketingSettings, saveMarketingSettings } from '../src/core/marketing/store.js';

// Real local inference and public website research; every publication request is
// intercepted by this in-memory transport. No installed credentials are loaded.
const app = createApp({ databaseUrl: ':memory:', logger: silentLogger }); const runtime = new LocalRuntime(app);
const engine = new GrowthEngine(app);
const startedAt = Date.now();
const folder = `data/operations-validation/cpu-${startedAt}`;
mkdirSync(folder, { recursive: true });
const originalFetch = globalThis.fetch;
let nativeCalls = 0;
const traces: unknown[] = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  const method = init?.method ?? 'GET';
  if (method !== 'GET') {
    assert.equal(url.origin, 'http://127.0.0.1:11434', 'Only CPU local inference may reach the network with a write method');
    assert.equal(url.pathname, '/api/chat');
    assert.equal(method, 'POST');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.options.num_gpu, 0); assert.equal(body.options.num_thread, 2);
    assert(freemem() >= 6 * 1024 ** 3, 'Preserve memory headroom');
    const sequence = ++nativeCalls;
    console.log(JSON.stringify({ stage: 'model-request', sequence, model: body.model, threads: body.options.num_thread }));
    const response = await originalFetch(input, init);
    const result = await response.clone().json();
    traces.push({ sequence, model: body.model, prompt: body.messages, result });
    writeFileSync(`${folder}/model-trace.json`, JSON.stringify(traces, null, 2));
    console.log(JSON.stringify({ stage: 'model-response', sequence, outputTokens: result.eval_count, finish: result.done_reason }));
    return response;
  }
  return originalFetch(input, init);
};
saveRuntimeSettings(app, { ...runtimeSettings(app), provider: 'local', localDevice: 'cpu' });
saveMarketingSettings(app, { ...marketingSettings(app), model: process.argv[3] ?? 'gemma4:e4b' });
let resourceFailure = '';
let checkingResources = false;
const monitor = setInterval(() => {
  if (checkingResources || resourceFailure) return;
  checkingResources = true;
  void (async () => {
    assert(freemem() >= 6 * 1024 ** 3, 'Low available memory');
    const response = await originalFetch('http://127.0.0.1:11434/api/ps', { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const body = await response.json();
      assert((body.models ?? []).every((m: { size_vram: number }) => m.size_vram === 0), 'Unexpected GPU allocation');
    }
  })().catch(error => { resourceFailure = String(error); void engine.stop(); runtime.stop(); }).finally(() => { checkingResources = false; });
}, 2000);
const timeout = setTimeout(() => { resourceFailure = 'Diagnostic exceeded 12 minutes'; void engine.stop(); runtime.stop(); }, 12 * 60000);
const credentials = new Map<string, string>(); const vault: CredentialVault = { available: () => true, get: key => credentials.get(key), set: (key, value) => { credentials.set(key, value); }, delete: key => { credentials.delete(key); } };
let accepted = 0;
const requestMode = process.argv.includes('--request');
const buyer = 'did:plc:syntheticbuyer', actor = 'did:plc:syntheticbusiness', cid = 'bafyre' + 'a'.repeat(40);
const post = { uri: `at://${buyer}/app.bsky.feed.post/fixture`, cid, author: { did: buyer }, record: { $type: 'app.bsky.feed.post', text: 'Can anyone recommend a Windows 11 app for asking questions about my own local documents and checking the cited source? I work alone.', createdAt: new Date().toISOString() } };
let remote: { uri: string; value: unknown } | undefined;
const transport: typeof fetch = async (_url, init) => {
  if (requestMode) {
    const path = new URL(String(_url)).pathname;
    if (path.endsWith('getSession')) return Response.json({ did: actor });
    if (path.endsWith('searchPosts')) return Response.json({ posts: [post] });
    if (path.endsWith('getPostThread')) return Response.json({ thread: { post } });
    if (path.endsWith('getRecord')) return remote ? Response.json(remote) : Response.json({ error: 'RecordNotFound' }, { status: 404 });
    if (path.endsWith('createRecord')) {
      const input = JSON.parse(String(init?.body)); accepted++;
      assert.equal(input.record.reply.parent.uri, post.uri);
      remote = { uri: `at://${actor}/app.bsky.feed.post/${input.rkey}`, value: input.record };
      return Response.json({ uri: remote.uri, cid });
    }
    throw Error('Unexpected simulated endpoint');
  }
  if (init?.method === 'PUT') { accepted++; const post = JSON.parse(String(init.body)) as Record<string, unknown>; return Response.json({ slug: post.slug, status: 'published', version: 1 }); }
  return Response.json({ error: 'Post not found' }, { status: 404 });
};
try {
  assert(freemem() >= 12 * 1024 ** 3, 'Wait for 12 GiB available memory before loading the model');
  await runtime.start(); console.log(JSON.stringify({ stage: 'runtime', ...await runtime.status() }));
  const accounts = new ConnectionService(app, vault, undefined, transport); app.connections = accounts;
  const products = accounts.view().products;
  const product = products.find(p => p.name.toLowerCase() === (process.argv[2] ?? 'lemonade').toLowerCase()); if (!product) throw new Error('Unknown business');
  if (requestMode) {
    app.db.insert(settings).values({ key: 'connections.account.fixture', value: { id: 'fixture', productId: product.id, provider: 'bluesky', label: 'Simulated reply destination', site: 'https://bsky.social', username: '', identity: actor, status: 'verified', detail: '', checkedAt: Date.now(), expiresAt: null, refreshable: false, grantedScopes: [], createdAt: Date.now() } }).run();
    vault.set('account.fixture', JSON.stringify({ accessToken: 'fixture-only' }));
  } else await accounts.connect({ productId: product.id, provider: 'signal-blog', credential: 'fixture-credential-only', label: 'Simulated publication destination' });
  const operations = new OperationsService(app); app.operations = operations;
  operations.configure(product.id, { objective: 'Create a useful short guide for a specific buyer problem. Verify the current product website, explain a concrete workflow without inventing product features, and include a relevant next step to try the product.', accountIds: [accounts.accounts()[0]!.id], intervalHours: 24, dailyLimit: 1 });
  if (requestMode) operations.configure(product.id, { mode: 'acquisition', ownedAudience: false, replyToRequests: true, objective: 'Help solo Windows users check answers against their own document sources.', accountIds: ['fixture'], intervalHours: 1, dailyLimit: 1, discovery: { enabled: true, queries: [{ kind: 'bluesky', query: 'local documents' }] } });
  operations.run(product.id);
  if (requestMode) await operations.discovery.refresh(product.id);
  operations.schedule(); console.log(JSON.stringify({ stage: 'agent', product: product.name, requestMode }));
  await engine.runNext(['marketing']);
  const task = app.db.select().from(growthTasks).where(eq(growthTasks.id, operations.state(product.id).taskId!)).get();
  const calls = app.db.select().from(marketingToolCalls).where(eq(marketingToolCalls.taskId, task!.id)).all();
  console.log(JSON.stringify({ stage: 'generated', task: task?.status, error: task?.error, tools: calls.map(c => ({ name: c.name, status: c.status, ...(c.status === 'failed' ? { result: c.result } : {}) })) }));
  await operations.tick(); const delivery = operations.deliveries()[0];
  mkdirSync('data/operations-validation', { recursive: true });
  writeFileSync(`${folder}/result.json`, JSON.stringify({ testMode: 'Real CPU local inference; simulated publication', model: marketingSettings(app).model, resourceFailure, nativeCalls, elapsedMs: Date.now() - startedAt, task, calls, delivery }, null, 2));
  console.log(JSON.stringify({ stage: 'finished', product: product.name, liveInference: true, simulatedPublications: accepted, delivery: delivery?.status, title: delivery?.title }));
  if (resourceFailure || task?.status !== 'done' || delivery?.status !== 'published' || accepted !== 1) process.exitCode = 1;
} finally { clearInterval(monitor); clearTimeout(timeout); await engine.stop(); runtime.stop(); app.close(); globalThis.fetch = originalFetch; }
