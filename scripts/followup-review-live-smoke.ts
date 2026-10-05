// Focused live model regression: reject a paraphrase, allow a documented next action.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { initializeMarketing } from '../src/core/marketing/store.js';
import { publicPage } from '../src/core/marketing/web.js';
import { marketingToolCalls, products, settings } from '../src/core/db/schema.js';
import { LocalRuntime } from '../src/core/runtime/manager.js';
import { agentClient } from '../src/core/runtime/client.js';
import { runtimeSettings, saveRuntimeSettings } from '../src/core/runtime/settings.js';
import { OperationsService } from '../src/core/operations/service.js';
import { reviewOperationCopy } from '../src/core/operations/review.js';
import { extractJson, type LlmClient } from '../src/core/llm/client.js';

const runId = Date.now(), taskId = `review-${runId}`, model = process.argv[2] ?? 'gemma4:e4b';
const app = createApp({ databaseUrl: ':memory:', logger: silentLogger }), runtime = new LocalRuntime(app), controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 8 * 60000), report: unknown[] = [], trace: { task: string | undefined; text: string }[] = [];
mkdirSync('data/operations-validation', { recursive: true });
try {
  saveRuntimeSettings(app, { ...runtimeSettings(app), provider: 'local', localDevice: 'cpu' }); initializeMarketing(app);
  const product = app.db.select().from(products).all().find(p => p.key === 'cinegen')!;
  const source = await publicPage(app, product.utmBase, controller.signal);
  app.db.insert(marketingToolCalls).values({ id: taskId, productId: product.id, taskId, name: 'product.inspect', status: 'done', result: JSON.stringify(source), createdAt: Date.now() }).run();
  app.operations = new OperationsService(app); const state = app.operations.state(product.id);
  app.db.insert(settings).values({ key: `operations.policy.${product.id}`, value: { ...state, taskId, learning: { version: 1, cycle: 1, decidedAt: Date.now(), windowStart: 0, mode: 'test-interest', accountId: 'fixture', reason: 'Synthetic selection for isolated review', revenueObservedAt: null, accounts: [], traffic: { status: 'usable', detail: 'Synthetic fixture', observedAt: Date.now(), accounts: [], reference: { id: 'prior', title: 'Develop a concept into a storyboard', description: 'Describe your story to the AI Storyboarder to generate sequenced shots.', sessions: 35, engagedSessions: 20 } } } } }).run();
  await runtime.start(); assert.ok((await runtime.status()).models.includes(model));
  const client = agentClient(app, controller.signal);
  const llm: LlmClient = { available: () => client.available(), complete: async request => {
    const response = await client.complete(request); trace.push({ task: request.task, text: response.text });
    writeFileSync(`data/operations-validation/followup-review-trace-${runId}.json`, JSON.stringify(trace, null, 2)); return response;
  } };
  let failures = 0;
  for (const test of [
    { name: 'same-action-paraphrased', expected: false, title: 'Turn a concept into a shot sequence', description: 'Use the AI Storyboarder to describe your concept and generate sequenced shots.', body: `Our app: Describe a story in CineGen's AI Storyboarder to generate sequenced shots from your concept. Try it at ${product.utmBase}` },
    { name: 'documented-next-action', expected: true, title: 'Move generated shots into your master storyboard', description: 'After generating shot sequences, drag the shots into your master storyboard to organize your video plan.', body: `Our app: After prompting CineGen's AI Storyboarder, drag the generated shots into your master storyboard to organize the video plan. Try it at ${product.utmBase}` },
  ]) {
    const started = Date.now(), traceStart = trace.length; let approved = false, detail: unknown;
    console.log(JSON.stringify({ stage: 'review-start', name: test.name, model }));
    try { detail = await reviewOperationCopy(app, product.id, taskId, { accountId: 'fixture', title: test.title, description: test.description, body: test.body, evidence: [source.url] }, llm, model); approved = true; } catch (error) { detail = String(error); }
    const rejectedRepeat = !approved && typeof detail === 'string' && detail.startsWith('Error: Editorial review requires revision:') && trace.slice(traceStart).some(row => { if (row.task !== 'operations.followup-review') return false; try { return (extractJson(row.text) as { relationship?: unknown }).relationship === 'repeat'; } catch { return false; } });
    const result = { name: test.name, expected: test.expected, approved, passed: test.expected ? approved : rejectedRepeat, elapsedMs: Date.now() - started, detail }; report.push(result); failures += Number(!result.passed);
    writeFileSync(`data/operations-validation/followup-review-${runId}.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(result));
  }
  assert.equal(failures, 0);
} finally { clearTimeout(timeout); runtime.stop(); app.close(); }
