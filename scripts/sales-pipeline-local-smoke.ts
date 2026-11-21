import { mkdirSync, writeFileSync } from 'node:fs';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { ConnectionService } from '../src/core/connections/service.js';
import { SalesPipeline } from '../src/core/sales/pipeline.js';
import { OpenAiCompatibleClient } from '../src/core/llm/openai-compatible.js';

// In-memory database, synthetic public pages, no mailbox, no sending worker.
const app = createApp({ databaseUrl: ':memory:', logger: silentLogger });
try {
  app.env.SIGNAL_OFFLINE = '0';
  app.connections = new ConnectionService(app, { available: () => false, get: () => undefined, set: () => {}, delete: () => {} });
  const productId = app.connections.view().products.find(p => p.name === 'Lemonade')!.id;
  const signal = 'I need a local AI tool to compare client reports and draft a summary without adding another subscription.';
  const pipeline = new SalesPipeline(app, new OpenAiCompatibleClient('http://127.0.0.1:11434/v1', silentLogger, { timeoutMs: 240000 }), async (_app, url) => ({ url, title: 'Synthetic smoke fixture', body: url.includes('example.org') ? signal + ' Contact: buyer@example.org' : 'Lemonade is a Windows desktop assistant. It can compare local source documents and prepare editable drafts. Local models run on your computer. Optional network tools are separate. No specific security, pricing, or performance claims are supported by this fixture.', observedAt: Date.now(), trust: 'Synthetic untrusted reference' }));
  app.salesPipeline = pipeline;
  pipeline.ingest(productId, { email: 'buyer@example.org', name: 'Synthetic document researcher', sourceUrl: 'https://example.org/request', sourceSignal: signal });
  for (let i = 0; i < 3; i++) { await pipeline.tick(); console.log(JSON.stringify({ step: i + 1, stage: pipeline.leads(productId)[0]!.stage, detail: pipeline.leads(productId)[0]!.detail })); }
  const view = pipeline.view(); const lead = view.leads[0]!;
  const receipt = { checkedAt: new Date().toISOString(), synthetic: true, sends: 0, localRuntime: 'Ollama', ok: lead.stage === 'DRAFT_READY' && lead.draft?.criticPassed === true, lead, runs: view.runs, metrics: view.metrics };
  mkdirSync('output/sales-pipeline-validation', { recursive: true }); writeFileSync('output/sales-pipeline-validation/local-model.json', JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ ok: receipt.ok, stage: lead.stage, calls: view.runs.length, sends: 0 }));
  if (!receipt.ok) process.exitCode = 1;
} finally { await app.salesPipeline?.stop(); app.close(); }
