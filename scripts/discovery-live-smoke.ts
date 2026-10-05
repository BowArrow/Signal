import { mkdirSync, writeFileSync } from 'node:fs';
import { createApp } from '../src/core/app.js';
import { LocalRuntime } from '../src/core/runtime/manager.js';
import { ConnectionService, type CredentialVault } from '../src/core/connections/service.js';
import { OperationsService } from '../src/core/operations/service.js';
import { GrowthEngine } from '../src/core/growth/engine.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { growthTasks, marketingToolCalls } from '../src/core/db/schema.js';
import { eq } from 'drizzle-orm';
import { parseDiscoveryQueries, suggestedDiscoveryQueries } from '../src/shared/discovery.js';
import { runtimeSettings, saveRuntimeSettings } from '../src/core/runtime/settings.js';
import { marketingSettings, saveMarketingSettings } from '../src/core/marketing/store.js';

// Real CPU-only local inference and public website research; every publication request is
// intercepted by this in-memory transport. No installed credentials are loaded.
const runId = Date.now();
const traceFile = `data/operations-validation/discovery-cpu-trace-${runId}.json`;
mkdirSync('data/operations-validation', { recursive: true });
const originalFetch = globalThis.fetch;
const completions: unknown[] = [];
let completionIndex = 0;
globalThis.fetch = async (url, init) => {
  if (String(url) !== 'http://127.0.0.1:11434/api/chat') return originalFetch(url, init);
  const request = JSON.parse(String(init?.body)) as { model: string; options: { num_gpu?: number }; messages: { content: string }[] };
  if (request.options.num_gpu !== 0) throw new Error('This validation requires CPU-only requests');
  const call = ++completionIndex, started = Date.now();
  const kind = request.messages[0]?.content.includes('CURRENT_SOURCE_TEXT:') ? 'review' : 'compose';
  console.log(JSON.stringify({ stage: 'model-start', call, kind, model: request.model }));
  const response = await originalFetch(url, init);
  const result: unknown = await response.clone().json();
  completions.push({ call, kind, elapsedMs: Date.now() - started, status: response.status, result });
  writeFileSync(traceFile, JSON.stringify(completions, null, 2));
  console.log(JSON.stringify({ stage: 'model-finished', call, kind, elapsedMs: Date.now() - started }));
  return response;
};
let researchOffset = 0;
const app = createApp({ databaseUrl: ':memory:', logger: silentLogger, clock: { now: () => Date.now() + researchOffset } }); const runtime = new LocalRuntime(app);
saveRuntimeSettings(app, { ...runtimeSettings(app), localDevice: 'cpu' });
if (process.argv[3]) saveMarketingSettings(app, { ...marketingSettings(app), model: process.argv[3] });
const engine = new GrowthEngine(app);
let taskId: string | undefined;
const deadline = setTimeout(() => { if (taskId) engine.cancel(taskId); }, 20 * 60000);
const credentials = new Map<string, string>(); const vault: CredentialVault = { available: () => true, get: key => credentials.get(key), set: (key, value) => { credentials.set(key, value); }, delete: key => { credentials.delete(key); } };
let accepted = 0;
const transport: typeof fetch = async (_url, init) => {
  if (init?.method === 'PUT') { accepted++; const post = JSON.parse(String(init.body)) as Record<string, unknown>; return Response.json({ slug: post.slug, status: 'published', version: 1 }); }
  return Response.json({ error: 'Post not found' }, { status: 404 });
};
try {
  await runtime.start(); const status = await runtime.status(); console.log(JSON.stringify({ stage: 'runtime', ...status }));
  if (!status.models.includes(marketingSettings(app).model)) throw new Error('Choose an installed local model');
  const accounts = new ConnectionService(app, vault, undefined, transport); app.connections = accounts;
  const products = accounts.view().products;
  const product = products.find(p => p.name.toLowerCase() === (process.argv[2] ?? 'lemonade').toLowerCase()); if (!product) throw new Error('Unknown business');
  await accounts.connect({ productId: product.id, provider: 'signal-blog', credential: 'fixture-credential-only', label: 'Simulated publication destination' });
  const operations = new OperationsService(app); app.operations = operations;
  operations.configure(product.id, { objective: 'Create a genuinely useful short guide for a specific buyer problem. Verify the current product website, explain a concrete workflow without inventing product features, and include a relevant next step to try the product.', accountIds: [accounts.accounts()[0]!.id], intervalHours: 24, dailyLimit: 1, discovery: { enabled: true, queries: parseDiscoveryQueries(suggestedDiscoveryQueries(product.name)) } });
  operations.run(product.id); for (let i = 0; i < 4; i++) { await operations.tick(false); researchOffset += 60001; } const discovery = operations.discovery.snapshot(operations.state(product.id)); console.log(JSON.stringify({ stage: 'research', searches: discovery.searches, findings: discovery.findings.length, titles: discovery.findings.slice(0, 6).map(f => f.title) })); operations.schedule(); console.log(JSON.stringify({ stage: 'agent', product: product.name }));
  taskId = operations.state(product.id).taskId ?? undefined;
  await engine.runNext(['marketing']);
  const task = app.db.select().from(growthTasks).where(eq(growthTasks.id, operations.state(product.id).taskId!)).get();
  const calls = app.db.select().from(marketingToolCalls).where(eq(marketingToolCalls.taskId, task!.id)).all();
  console.log(JSON.stringify({ stage: 'generated', task: task?.status, error: task?.error, tools: calls.map(c => ({ name: c.name, status: c.status, ...(c.status === 'failed' ? { result: c.result } : {}) })) }));
  await operations.tick(); const delivery = operations.deliveries()[0];
  mkdirSync('data/operations-validation', { recursive: true });
  const report = JSON.stringify({ testMode: 'Real CPU-only local inference; simulated publication', task, calls, delivery, discovery, traceFile }, null, 2);
  writeFileSync(`data/operations-validation/discovery-cpu-${product.name.toLowerCase()}-${runId}.json`, report);
  writeFileSync(`data/operations-validation/discovery-cpu-${product.name.toLowerCase()}.json`, report);
  console.log(JSON.stringify({ stage: 'finished', product: product.name, liveInference: true, simulatedPublications: accepted, delivery: delivery?.status, title: delivery?.title, demand: delivery?.demand }));
  if (task?.status !== 'done' || delivery?.status !== 'published' || accepted !== 1 || !delivery.demand || discovery.searches[0]?.status !== 'ok') process.exitCode = 1;
} finally { clearTimeout(deadline); await engine.stop(); runtime.stop(); app.close(); globalThis.fetch = originalFetch; }
