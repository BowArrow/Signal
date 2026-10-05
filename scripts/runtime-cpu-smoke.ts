// Isolated text-only CPU validation. No business credentials or outbound writes.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { agentClient } from '../src/core/runtime/client.js';
import { LocalRuntime } from '../src/core/runtime/manager.js';
import { runtimeSettings, saveRuntimeSettings } from '../src/core/runtime/settings.js';

const app = createApp({ databaseUrl: ':memory:', logger: silentLogger });
const runtime = new LocalRuntime(app), controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), 180000);
const observations: { name: string; sizeVram: number }[] = [];
let finished = false;
const read = async (path: string) => {
  const response = await fetch('http://127.0.0.1:11434' + path, { signal: AbortSignal.timeout(5000) });
  assert(response.ok); return response.json() as Promise<{ models?: { name: string; size_vram: number }[]; version?: string }>;
};
try {
  saveRuntimeSettings(app, { ...runtimeSettings(app), localDevice: 'cpu' });
  await runtime.start();
  const status = await runtime.status(), version = await read('/api/version');
  const model = process.argv[2] ?? 'gemma4:e4b';
  assert(status.models.includes(model), 'Choose an installed local model');
  const before = await read('/api/ps');
  assert.equal(before.models?.length ?? 0, 0, 'Run this probe only when Ollama is idle');
  console.log(JSON.stringify({ stage: 'start', model, version: version.version, device: 'cpu' }));
  const started = Date.now();
  const completion = agentClient(app, controller.signal).complete({ model, task: 'runtime.cpu-probe',
    prompt: 'Return exactly this JSON: {"ready":true}. No other text.', expectsJson: true, maxTokens: 64,
    jsonSchema: { type: 'object', properties: { ready: { type: 'boolean', const: true } }, required: ['ready'], additionalProperties: false },
  }).finally(() => { finished = true; });
  const monitor = (async () => {
    while (!finished) {
      for (const running of (await read('/api/ps')).models ?? []) {
        if (running.name !== model) continue;
        observations.push({ name: running.name, sizeVram: running.size_vram });
        if (running.size_vram !== 0) { controller.abort(); throw Error('Probe reported GPU allocation'); }
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  })();
  const [result] = await Promise.all([completion, monitor]);
  assert.deepEqual(JSON.parse(result.text), { ready: true });
  assert(observations.length > 0, 'No loaded model was observed; CPU use is unproven');
  const report = { ok: true, model, version: version.version, localDevice: 'cpu', observations,
    elapsedMs: Date.now() - started, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
  mkdirSync('data/runtime-validation', { recursive: true });
  writeFileSync('data/runtime-validation/cpu-probe.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, observations: observations.length, sizeVram: 0 }));
} finally { clearTimeout(deadline); controller.abort(); runtime.stop(); app.close(); }
