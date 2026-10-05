// Real CPU review against the current product page. No outbound publishing or owner profile.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { initializeMarketing } from '../src/core/marketing/store.js';
import { publicPage } from '../src/core/marketing/web.js';
import { marketingToolCalls, products } from '../src/core/db/schema.js';
import { newId } from '../src/core/lib/id.js';
import { LocalRuntime } from '../src/core/runtime/manager.js';
import { agentClient } from '../src/core/runtime/client.js';
import { runtimeSettings, saveRuntimeSettings } from '../src/core/runtime/settings.js';
import { reviewOperationCopy } from '../src/core/operations/review.js';
import type { LlmClient } from '../src/core/llm/client.js';

const app = createApp({ databaseUrl: ':memory:', logger: silentLogger });
const runtime = new LocalRuntime(app), controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), 8 * 60000);
const report: unknown[] = [], trace: unknown[] = [];
const runId = Date.now(), model = process.argv[2] ?? 'gemma4:e4b';
mkdirSync('data/operations-validation', { recursive: true });
try {
  saveRuntimeSettings(app, { ...runtimeSettings(app), provider: 'local', localDevice: 'cpu' });
  initializeMarketing(app); await runtime.start();
  if (!(await runtime.status()).models.includes(model)) throw new Error('Select an installed local model');
  const product = app.db.select().from(products).all().find(row => row.key === 'lemonade');
  if (!product) throw new Error('Lemonade product missing');
  const source = await publicPage(app, product.utmBase, controller.signal), taskId = newId();
  app.db.insert(marketingToolCalls).values({ id: newId(), productId: product.id, taskId, name: 'product.inspect', status: 'done', result: JSON.stringify(source), createdAt: Date.now() }).run();
  const client = agentClient(app, controller.signal);
  const llm: LlmClient = { available: () => client.available(), complete: async request => {
    const response = await client.complete(request);
    trace.push({ response: response.text, inputTokens: response.inputTokens, outputTokens: response.outputTokens });
    writeFileSync(`data/operations-validation/editorial-cpu-trace-${runId}.json`, JSON.stringify(trace, null, 2));
    return response;
  } };
  for (const test of [
    { name: 'supported-workbook', shouldApprove: true, title: 'Create a workbook you can review', body: 'Lemonade creates editable Excel workbooks with working formulas. Try asking it to turn a small set of figures into a spreadsheet, then check the figures and formulas before using the result. Review and edit the file in the applications you already use. https://siplemona.de/' },
    { name: 'unsupported-publishing', shouldApprove: false, title: 'Schedule videos to your YouTube channel', body: 'Lemonade automatically schedules and publishes your finished videos to your YouTube channel from local files. Use its built-in YouTube scheduler to choose a posting time and have the upload happen automatically. https://siplemona.de/' },
  ]) {
    const started = Date.now(); console.log(JSON.stringify({ stage: 'review', name: test.name, model, device: 'cpu' }));
    let approved = false, detail = '';
    try {
      await reviewOperationCopy(app, product.id, taskId, { accountId: 'no-publication', title: test.title, description: test.title + ' using the current product capabilities.', body: test.body, evidence: [source.url] }, llm, model);
      approved = true;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('Editorial review requires revision:')) throw error;
      detail = error.message;
    }
    const row = { name: test.name, approved, expectedApproval: test.shouldApprove, passed: approved === test.shouldApprove, elapsedMs: Date.now() - started, detail };
    report.push(row); console.log(JSON.stringify(row));
    if (!row.passed) process.exitCode = 1;
  }
} finally {
  writeFileSync(`data/operations-validation/editorial-cpu-${runId}.json`, JSON.stringify({ model, device: 'cpu', report }, null, 2));
  clearTimeout(deadline); controller.abort(); runtime.stop(); app.close();
}
