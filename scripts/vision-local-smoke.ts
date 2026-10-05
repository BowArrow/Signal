import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { LocalRuntime } from '../src/core/runtime/manager.js';
import { agentClient } from '../src/core/runtime/client.js';
import { extractJson } from '../src/core/llm/client.js';
import { runtimeSettings } from '../src/core/runtime/settings.js';

// Describe previously generated pixels without supplying the expected objects.
// This checks actual vision behavior, not just a model's advertised capability.
const app = createApp({ databaseUrl: ':memory:', logger: silentLogger });
const runtime = new LocalRuntime(app); const model = process.argv[2] ?? 'qwen3.5:9b';
try {
  assert.equal(runtimeSettings(app).provider, 'local'); await runtime.start();
  assert((await runtime.status()).models.includes(model), 'Install the selected model first.');
  const client = agentClient(app); const results = [];
  for (const fixture of [
    { file: 'local-lemonade.jpg', objects: /tablet|screen|device/i },
    { file: 'local-cinegen.jpg', objects: /paper|sheet/i },
  ]) {
    const startedAt = Date.now();
    const result = await client.complete({ model, task: 'operations.vision-check', prompt: 'Inspect only the attached pixels. Return JSON with description (a concise literal description of the visible objects), visibleFaces (integer count), and legibleText (array of strings actually readable in the image). Do not invent text or infer unseen people.', images: [{ mime: 'image/jpeg', base64: readFileSync(`data/operation-images-validation/${fixture.file}`).toString('base64') }], expectsJson: true, reasoningEffort: 'none', temperature: 0, maxTokens: 400 });
    const seen = z.object({ description: z.string(), visibleFaces: z.number().int(), legibleText: z.array(z.string()) }).parse(extractJson(result.text));
    results.push({ file: fixture.file, model: result.model, elapsedMs: Date.now() - startedAt, ...seen });
    writeFileSync('data/operation-images-validation/vision-local-check.json', JSON.stringify({ model, results }, null, 2));
    assert(fixture.objects.test(seen.description), 'The model did not identify the main visible object.');
    assert.equal(seen.visibleFaces, 0, 'The model invented a face.');
    assert.equal(seen.legibleText.length, 0, 'The model invented lettering.');
    console.log(JSON.stringify(results.at(-1)));
  }
  console.log(JSON.stringify({ ok: true, model, actualImagesChecked: results.length, realPublication: false }));
} finally { runtime.stop(); app.close(); }
