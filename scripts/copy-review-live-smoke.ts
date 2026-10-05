// Real CPU editorial judgments against today's product source; no publishing/account credentials.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { initializeMarketing } from '../src/core/marketing/store.js';
import { publicPage } from '../src/core/marketing/web.js';
import { marketingToolCalls, products } from '../src/core/db/schema.js';
import { LocalRuntime } from '../src/core/runtime/manager.js';
import { agentClient } from '../src/core/runtime/client.js';
import { runtimeSettings, saveRuntimeSettings } from '../src/core/runtime/settings.js';
import { reviewOperationCopy } from '../src/core/operations/review.js';
import type { LlmClient } from '../src/core/llm/client.js';

const runId = Date.now(), taskId = `copy-review-${runId}`, model = process.argv[2] ?? 'gemma4:e4b';
const app = createApp({ databaseUrl: ':memory:', logger: silentLogger }), runtime = new LocalRuntime(app), controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 12 * 60000), report: unknown[] = [], trace: unknown[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  if (String(url) === 'http://127.0.0.1:11434/api/chat') assert.equal(JSON.parse(String(init?.body)).options.num_gpu, 0);
  return originalFetch(url, init);
};
mkdirSync('data/operations-validation', { recursive: true });
try {
  saveRuntimeSettings(app, { ...runtimeSettings(app), provider: 'local', localDevice: 'cpu' }); initializeMarketing(app);
  const product = app.db.select().from(products).all().find(p => p.key === 'cinegen')!;
  const source = await publicPage(app, product.utmBase, controller.signal);
  app.db.insert(marketingToolCalls).values({ id: taskId, productId: product.id, taskId, name: 'product.inspect', status: 'done', result: JSON.stringify(source), createdAt: Date.now() }).run();
  await runtime.start(); assert.ok((await runtime.status()).models.includes(model));
  const client = agentClient(app, controller.signal);
  const llm: LlmClient = { available: () => client.available(), complete: async request => {
    const result = await client.complete(request); trace.push({ task: request.task, text: result.text });
    writeFileSync(`data/operations-validation/copy-review-trace-${runId}.json`, JSON.stringify({ model, source, trace }, null, 2)); return result;
  } };
  let failures = 0;
  for (const test of [
    { name: 'supported-edit-and-export', expected: true, title: 'Arrange generated clips on the timeline', description: 'Use the browser timeline to arrange video clips and export your edit.', body: `Our app: After generating clips, arrange them in CineGen's timeline and export your edit. Explore the workspace at ${product.utmBase}` },
    { name: 'qualified-free-export', expected: true, title: 'Try the editor with a watermarked export', description: 'The free plan includes watermarked 720p exports from the browser timeline.', body: `Try our browser editor and export a watermarked 720p video on the free plan. Explore CineGen at ${product.utmBase}` },
    { name: 'invented-youtube-publishing', expected: false, title: 'Publish finished videos to YouTube automatically', description: 'CineGen uploads each finished video to your YouTube channel automatically.', body: `Our app automatically uploads your finished videos to YouTube for you. Start at ${product.utmBase}` },
    { name: 'unsupported-free-export-offer', expected: false, title: 'Export watermark-free 4K video on the free plan', description: 'The free plan includes watermark-free 4K exports without an upgrade.', body: `Our app lets every free account export watermark-free 4K video without upgrading. Try CineGen at ${product.utmBase}` },
  ]) {
    const started = Date.now(); let approved = false, detail: unknown;
    let checkedPassages: { passageId: string; verdict: string }[] = [];
    console.log(JSON.stringify({ stage: 'review-start', name: test.name, model }));
    try { const review = await reviewOperationCopy(app, product.id, taskId, { accountId: 'fixture', title: test.title, description: test.description, body: test.body, evidence: [source.url] }, llm, model); detail = review; checkedPassages = review.checks; approved = true; } catch (error) { detail = String(error); }
    const semanticRejection = !approved && typeof detail === 'string' && detail.startsWith('Error: Editorial review requires revision: Remove or correct this unsupported claim in ');
    // Each positive fixture explicitly makes factual claims in all three passages.
    // A correct overall approval must not hide a skipped claim labeled nonfactual.
    const factualCoverage = ['title-1', 'description-1', 'body-1'].every(id => checkedPassages.some(check => check.passageId === id && check.verdict === 'supported'));
    const result = { name: test.name, expected: test.expected, approved, passed: test.expected ? approved && factualCoverage : semanticRejection, factualCoverage: approved ? factualCoverage : null, elapsedMs: Date.now() - started, detail }; report.push(result); failures += Number(!result.passed);
    writeFileSync(`data/operations-validation/copy-review-${runId}.json`, JSON.stringify({ model, sourceUrl: source.url, report }, null, 2)); console.log(JSON.stringify({ name: test.name, expected: test.expected, approved, passed: result.passed, elapsedMs: result.elapsedMs, ...(approved ? {} : { error: String(detail).slice(0, 800) }) }));
  }
  assert.equal(failures, 0);
} finally { clearTimeout(timeout); runtime.stop(); app.close(); globalThis.fetch = originalFetch; }
