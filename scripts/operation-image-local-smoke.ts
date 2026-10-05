import { app as electron } from 'electron';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { ConnectionService, type CredentialVault } from '../src/core/connections/service.js';
import { OperationsService } from '../src/core/operations/service.js';
import { OperationImages, imageCid, imageDigest } from '../src/core/operations/images.js';
import { normalizeCampaignImage } from '../electron/main/campaign-images.js';
import { inspectRecipe, type NodeInfo } from '../src/core/marketing/media-presets.js';
import { marketingToolCalls, marketingWorkflows, settings } from '../src/core/db/schema.js';
import { pollMedia } from '../src/core/marketing/comfy.js';
import { GrowthEngine } from '../src/core/growth/engine.js';
import { runtimeSettings, saveRuntimeSettings } from '../src/core/runtime/settings.js';
import { LocalRuntime } from '../src/core/runtime/manager.js';
import { agentClient } from '../src/core/runtime/client.js';
import type { ConnectedAccount } from '../src/shared/connections.js';
import { marketingSettings, saveMarketingSettings } from '../src/core/marketing/store.js';

async function main() {
const folder = resolve('data/operation-images-validation'); mkdirSync(folder, { recursive: true });
await electron.whenReady();
const app = createApp({ databaseUrl: ':memory:', logger: silentLogger });
const runtime = new LocalRuntime(app);
let owned: ReturnType<typeof spawn> | undefined; let posts = 0; let uploads = 0;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
try {
  if (runtimeSettings(app).provider !== 'local' || app.env.SIGNAL_OFFLINE === '1') throw new Error('This smoke requires local inference with network access for public research.');
  if (process.env['SIGNAL_SMOKE_VISION_MODEL']) saveRuntimeSettings(app, { ...runtimeSettings(app), localVisionModel: process.env['SIGNAL_SMOKE_VISION_MODEL'] });
  if (process.env['SIGNAL_SMOKE_MARKETING_MODEL']) saveMarketingSettings(app, { ...marketingSettings(app), model: process.env['SIGNAL_SMOKE_MARKETING_MODEL'] });
  await runtime.start(); console.log('Installed local agent runtime is ready.');
  const probe = () => fetch('http://127.0.0.1:8188/object_info', { signal: AbortSignal.timeout(4000) }).then(r => r.json() as Promise<Record<string, NodeInfo>>);
  let info: Record<string, NodeInfo> | undefined;
  try { info = await probe(); } catch { /* Start only the explicitly supplied installation. */ }
  if (!info) {
    const root = process.env['SIGNAL_COMFY_SMOKE_ROOT']; if (!root) throw new Error('Start ComfyUI or set SIGNAL_COMFY_SMOKE_ROOT to its installed portable root.');
    owned = spawn(join(root, 'python_embeded', 'python.exe'), ['-s', join(root, 'ComfyUI', 'main.py'), '--windows-standalone-build', '--disable-auto-launch', '--listen', '127.0.0.1', '--port', '8188', '--disable-all-custom-nodes', '--reserve-vram', '1', '--output-directory', join(folder, 'renders')], { cwd: root, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    owned.stdout?.on('data', bytes => appendFileSync(join(folder, 'comfy.log'), bytes)); owned.stderr?.on('data', bytes => appendFileSync(join(folder, 'comfy.log'), bytes));
    for (let i = 0; i < 60 && !info; i++) { await pause(1000); try { info = await probe(); } catch { /* Loading. */ } }
  }
  if (!info) throw new Error('The installed ComfyUI did not become ready.');
  const recipe = inspectRecipe('krea2', info); if (recipe.missing.length) throw new Error(`Krea requirements missing: ${recipe.missing.join(', ')}`);
  const vault: CredentialVault = { available: () => true, get: key => key.startsWith('account.') ? JSON.stringify({ accessToken: 'simulated-token' }) : undefined, set: () => {}, delete: () => {} };
  let remote: unknown; let bytes: Buffer | undefined;
  app.connections = new ConnectionService(app, vault, undefined, async (url, init) => {
    const route = String(url);
    if (route.includes('getSession')) return Response.json({ did: 'did:plc:fixture' });
    if (route.includes('getRecord')) return remote ? Response.json({ uri: `at://did:plc:fixture/app.bsky.feed.post/${app.operations!.deliveries()[0]!.recordKey}`, value: remote }) : Response.json({ error: 'RecordNotFound' }, { status: 400 });
    if (route.includes('uploadBlob')) { uploads++; bytes = Buffer.from(init!.body as Uint8Array); return Response.json({ blob: { $type: 'blob', ref: { $link: imageCid(imageDigest(bytes)) }, mimeType: 'image/jpeg', size: bytes.length } }); }
    if (route.includes('createRecord')) { posts++; const body = JSON.parse(String(init!.body)); remote = body.record; return Response.json({ uri: `at://did:plc:fixture/app.bsky.feed.post/${body.rkey}`, cid: 'simulated-post-cid' }); }
    throw new Error('Unexpected simulated publication request');
  });
  const business = process.env['SIGNAL_SMOKE_BUSINESS'] ?? 'Lemonade'; const product = app.connections.view().products.find(p => p.name === business); if (!product) throw new Error('Unknown business');
  const account: ConnectedAccount = { id: 'simulated-bluesky', productId: product.id, provider: 'bluesky', label: 'Simulated Bluesky transport', site: '', username: 'fixture.test', identity: 'fixture.test', status: 'verified', detail: 'No actual account access', checkedAt: Date.now(), expiresAt: null, refreshable: false, grantedScopes: [], createdAt: Date.now() };
  app.db.insert(settings).values({ key: `connections.account.${account.id}`, value: account }).run();
  app.db.insert(marketingWorkflows).values({ id: 'installed-krea', productId: product.id, name: 'Installed Krea 2', workflow: recipe.workflow }).run();
  const client = agentClient(app);
  const recordedClient = { available: () => client.available(), complete: async (request: Parameters<typeof client.complete>[0]) => { const result = await client.complete(request); appendFileSync(join(folder, `responses-${business.toLowerCase()}.jsonl`), JSON.stringify({ task: request.task, text: result.text }) + '\n'); return result; } };
  const operations = new OperationsService(app); app.operations = operations; app.operationImages = new OperationImages(app, join(folder, 'approved'), normalizeCampaignImage, recordedClient);
  operations.configure(product.id, { objective: `Show one concrete buyer problem ${business} can help solve. Use an appealing editorial illustration specific to that problem, clear composition, warm cinematic light, no typography.`, accountIds: [account.id], intervalHours: 24, dailyLimit: 1, imageWorkflowId: 'installed-krea' });
  operations.run(product.id); operations.schedule();
  const engine = new GrowthEngine(app, recordedClient); await engine.runNext(['marketing']);
  writeFileSync(join(folder, `agent-${business.toLowerCase()}.json`), JSON.stringify({ tasks: operations.view().tasks, tools: app.db.select().from(marketingToolCalls).all() }, null, 2));
  if (!operations.deliveries().length) throw new Error(`Agent did not queue a campaign: ${JSON.stringify(operations.view().tasks)}`);
  for (let i = 0; i < 300; i++) {
    await pollMedia(app); await operations.tick(); const job = operations.deliveries()[0]!;
    if (i % 5 === 0) console.log(JSON.stringify({ status: job.status, image: job.image?.phase, detail: job.image?.detail }));
    if (['published', 'attention', 'cancelled'].includes(job.status)) break; await pause(4000);
  }
  const job = operations.deliveries()[0]!; const result = { business, realLocalAgent: true, realLocalRender: true, realVisualReview: true, simulatedUploads: uploads, simulatedPosts: posts, realPublication: false, job };
  writeFileSync(join(folder, `local-${business.toLowerCase()}.json`), JSON.stringify(result, null, 2)); if (bytes) writeFileSync(join(folder, `local-${business.toLowerCase()}.jpg`), bytes);
  if (job.status !== 'published' || posts !== 1 || uploads !== 1 || !job.image?.asset) throw new Error(`Image campaign did not complete: ${job.detail} ${job.image?.detail}`);
  console.log(JSON.stringify({ ok: true, business, image: job.image.asset, simulatedPosts: posts, realPublication: false }));
} catch (error) { console.error(String(error)); process.exitCode = 1; }
finally { owned?.kill(); runtime.stop(); app.close(); electron.exit(process.exitCode ?? 0); }

}
void main().catch(error => { console.error(String(error)); electron.exit(1); });
