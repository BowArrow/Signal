import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { inspectRecipe, type NodeInfo } from '../src/core/marketing/media-presets.js';
import { marketingView } from '../src/core/marketing/store.js';
import { marketingAction } from '../src/core/marketing/actions.js';
import { pollMedia, submitMedia } from '../src/core/marketing/comfy.js';

const root = process.argv[2]; if (!root) throw new Error('Pass an existing ComfyUI Windows portable root.');
const folder = resolve('data/studio-validation'); mkdirSync(folder, { recursive: true });
const app = createApp({ databaseUrl: ':memory:', logger: silentLogger });
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let owned: ReturnType<typeof spawn> | undefined;
try {
  const probe = () => fetch('http://127.0.0.1:8188/object_info', { signal: AbortSignal.timeout(4000) }).then(r => r.json() as Promise<Record<string, NodeInfo>>);
  let info: Record<string, NodeInfo> | undefined;
  try { info = await probe(); } catch { /* Start installed local engine. */ }
  if (!info) {
    owned = spawn(join(root, 'python_embeded', 'python.exe'), ['-s', join(root, 'ComfyUI', 'main.py'), '--windows-standalone-build', '--disable-auto-launch', '--listen', '127.0.0.1', '--port', '8188', '--disable-all-custom-nodes', '--reserve-vram', '1', '--output-directory', join(folder, 'renders')], { cwd: root, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    owned.stdout?.on('data', data => appendFileSync(join(folder, 'comfy-live.log'), data)); owned.stderr?.on('data', data => appendFileSync(join(folder, 'comfy-live.log'), data));
    for (let i = 0; i < 60; i++) { await delay(1000); try { info = await probe(); break; } catch { /* initializing */ } }
  }
  if (!info) throw new Error('ComfyUI did not start. See data/studio-validation/comfy-live.log');
  const readiness = inspectRecipe('krea2', info); console.log(JSON.stringify({ recipe: 'krea2', missing: readiness.missing }));
  if (readiness.missing.length) throw new Error('Missing recipe requirements');
  const product = marketingView(app).products[0]!;
  await marketingAction(app, { type: 'workflow', productId: product.id, name: 'Krea 2 live validation', workflow: readiness.workflow });
  const workflow = marketingView(app).workflows[0]!;
  await submitMedia(app, product.id, workflow.id, 'A polished editorial photograph for a privacy-focused local AI desktop tool. A single compact brushed-aluminum workstation on a warm cream desk beside a vivid yellow lemon and a small green leaf. Sculptural soft afternoon sunlight from the left, crisp natural shadows, calm tactile materials, contemporary independent technology brand. The objects occupy the lower right half, with generous clean warm ivory negative space on the left for a headline that will be typeset separately. No screens, no interface, no text, no letters, no logos, no watermark. Professional product photography, subtle grain, 1:1 composition.');
  let media = marketingView(app).media[0]!;
  for (let i = 0; i < 240 && !['done', 'failed'].includes(media.status); i++) { await delay(4000); await pollMedia(app); media = marketingView(app).media[0]!; if (i % 8 === 0) console.log(JSON.stringify({ status: media.status, elapsedSeconds: (i + 1) * 4 })); }
  if (media.status !== 'done') throw new Error(JSON.stringify({ status: media.status, error: media.error }));
  const output = media.outputs[0]!; const url = new URL('http://127.0.0.1:8188/view'); for (const key of ['filename', 'subfolder', 'type'] as const) url.searchParams.set(key, output[key]);
  const response = await fetch(url); writeFileSync(join(folder, 'live-krea-image.png'), Buffer.from(await response.arrayBuffer()));
  console.log(JSON.stringify({ ok: true, output, path: join(folder, 'live-krea-image.png') }));
} finally { owned?.kill(); app.close(); }
