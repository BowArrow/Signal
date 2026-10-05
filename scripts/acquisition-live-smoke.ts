// Bounded CPU-only model qualification. Synthetic requests, in-memory DB, no delivery.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { initializeMarketing } from '../src/core/marketing/store.js';
import { products } from '../src/core/db/schema.js';
import { LocalRuntime } from '../src/core/runtime/manager.js';
import { agentClient } from '../src/core/runtime/client.js';
import { runtimeSettings, saveRuntimeSettings } from '../src/core/runtime/settings.js';
import { assessAcquisition } from '../src/core/operations/acquisition.js';
import type { OperationState } from '../src/shared/operations.js';
import type { DemandFinding } from '../src/shared/discovery.js';

const app = createApp({ databaseUrl: ':memory:', logger: silentLogger });
const runtime = new LocalRuntime(app), controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 8 * 60000);
const runId = Date.now(), model = process.argv[2] ?? 'gemma4:e4b';
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  if (String(url) === 'http://127.0.0.1:11434/api/chat') { const request = JSON.parse(String(init?.body)); assert.equal(request.options.num_gpu, 0); assert.ok(request.options.num_thread <= 2); }
  return originalFetch(url, init);
};
try {
  initializeMarketing(app); saveRuntimeSettings(app, { ...runtimeSettings(app), provider: 'local', localDevice: 'cpu' });
  const product = app.db.select().from(products).all().find(p => p.key === 'lemonade')!;
  const cases = [
    { id: 'documents', title: 'Can I ask questions about my local documents?', excerpt: 'I use Windows 11 on my own computer. I want to ask questions about a folder of my documents and inspect the original source before relying on an answer.', expected: true },
    { id: 'mac', title: 'Need a native Mac app for local documents', excerpt: 'I only have a MacBook running macOS. I need a native macOS application to ask questions about my PDFs, without Windows or Linux.', expected: false },
    { id: 'team', title: 'Need a shared server for 50 office staff', excerpt: 'I need one centrally hosted server for 50 simultaneous employees, with SAML single sign-on, role-based access controls and a compliance audit log.', expected: false },
    { id: 'promotion', title: 'Looking for a way to summarize PDFs?', excerpt: 'Looking for a way to summarize PDFs? We just launched our own PDF summarizer. Try our product at our website and sign up for our newsletter today!', expected: false },
    { id: 'download', title: 'Can anyone recommend a PDF download site?', excerpt: 'Can anyone recommend a website where I can download the full text of a textbook that is not in my library? I need the book itself, not a tool to read documents I already own.', expected: false },
  ];
  const state: OperationState = { productId: product.id, mode: 'acquisition', ownedAudience: false, objective: 'Find supported document workflows for individual small-business owners.', accountIds: [], intervalHours: 24, dailyLimit: 1, running: true, revision: 1, authorizedAt: Date.now(), lastCycleAt: null, taskId: 'isolated-acquisition-smoke', demandEvidence: cases.map(c => ({ id: c.id, title: c.title, excerpt: c.excerpt, kind: 'hn', url: 'https://news.ycombinator.com/', query: 'synthetic validation only', postedAt: Date.now(), observedAt: Date.now(), requestLanguage: true })) };
  const realRequests = process.argv.includes('--public-requests');
  if (realRequests) {
    const saved = JSON.parse(readFileSync('data/operations-validation/public-requests.json', 'utf8')) as { capturedAt: number; findings: DemandFinding[] };
    assert.ok(Date.now() - saved.capturedAt < 3600000, 'Capture fresh public requests first.');
    assert.ok(saved.findings.length > 0 && saved.findings.length <= 6, 'Use one bounded qualification batch.');
    state.demandEvidence = saved.findings;
  }
  await runtime.start(); assert.ok((await runtime.status()).models.includes(model));
  console.log(JSON.stringify({ stage: 'qualifying', model, device: 'cpu', cases: state.demandEvidence!.length, realRequests }));
  mkdirSync('data/operations-validation', { recursive: true });
  const client = agentClient(app, controller.signal);
  const { cycle } = await assessAcquisition(app, state, { available: () => client.available(), complete: async request => {
    const response = await client.complete(request);
    writeFileSync(`data/operations-validation/acquisition-trace-${runId}.json`, JSON.stringify({ prompt: request.prompt, response: response.text }, null, 2));
    return response;
  } }, model, controller.signal, () => controller.signal.throwIfAborted());
  const results = cases.map(c => ({ id: c.id, expected: c.expected, assessment: cycle.assessments.find(a => a.findingId === c.id) }));
  mkdirSync('data/operations-validation', { recursive: true });
  writeFileSync(`data/operations-validation/acquisition-live-${runId}.json`, JSON.stringify({ model, cycle, results }, null, 2));
  if (!realRequests) {
    assert.equal(cycle.status, 'awaiting-access');
    for (const test of results) assert.equal(test.assessment?.suitable, test.expected, test.id);
  }
  console.log(JSON.stringify({ ok: true, checked: cycle.assessments.length, status: cycle.status, suitable: cycle.assessments.filter(a => a.suitable).length, model, device: 'cpu', externalDeliveries: 0, elapsedMs: Date.now() - runId }));
} finally { clearTimeout(timer); runtime.stop(); app.close(); globalThis.fetch = originalFetch; }
