import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { reviewFixture } from './review-fixture.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { ConnectionService, type CredentialVault } from '../../src/core/connections/service.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { OperationImages, imageCid, imageDigest, imageWorkflow } from '../../src/core/operations/images.js';
import { growthTasks, marketingToolCalls, marketingMedia, marketingWorkflows, settings } from '../../src/core/db/schema.js';
import { pollMedia, standardImageWorkflow } from '../../src/core/marketing/comfy.js';
import type { ConnectedAccount } from '../../src/shared/connections.js';
import type { Delivery, DeliveryInput } from '../../src/shared/operations.js';
import { ScriptedLlmClient } from '../../src/core/llm/client.js';
import { imageDimensions } from '../../src/core/operations/image-format.js';
import { hasPendingMedia } from '../../src/core/marketing/store.js';
import { runtimeSettings, saveRuntimeSettings } from '../../src/core/runtime/settings.js';
import { BRAND_CARD_WORKFLOW } from '../../src/shared/brand-card.js';
import { GrowthEngine } from '../../src/core/growth/engine.js';

vi.mock('../../src/core/marketing/web.js', () => ({ publicPage: async (app: App, url: string) => ({ url: new URL(url).toString(), title: 'Product facts', body: 'Work with local documents and check the cited source.', observedAt: app.clock.now() }), searchWeb: async () => ({ results: [] }) }));

let app: App; let operations: OperationsService; let product: string; let folder: string; let clock: ReturnType<typeof fixedClock>;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>; let transport: ReturnType<typeof vi.fn<typeof fetch>>;
let llm: ScriptedLlmClient; let renders: number; let uploads: number; let posts: number; let remote: Record<string, unknown> | null;
const bytes = Buffer.from('jpeg-image-fixture'.repeat(20));
const approved = { approved: true, issues: [], description: 'An editorial illustration of two document stacks beside a magnifying glass.', relevant: true, polished: true, misleading: false, readable: true };
const vault: CredentialVault = { available: () => true, get: key => key.startsWith('account.') ? JSON.stringify({ accessToken: 'secret-bsky-key' }) : undefined, set: () => {}, delete: () => {} };
const input = (): DeliveryInput => ({ accountId: 'bsky', title: 'Compare conflicting source documents', description: 'Check the cited source before relying on a document answer.', body: 'Compare the cited source before relying on an answer. Our app helps you work with local documents: https://siplemona.de/', evidence: ['https://siplemona.de/'], visual: { prompt: 'A polished editorial illustration of two paper stacks and a magnifying glass, warm yellow palette, no lettering.' } });
beforeEach(() => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); clock = fixedClock(1789600000000); app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger }); folder = mkdtempSync(join(tmpdir(), 'signal-images-'));
  renders = 0; uploads = 0; posts = 0; remote = null;
  transport = vi.fn(async (url, init) => {
    if (String(url).includes('getSession')) return Response.json({ did: 'did:plc:test' });
    if (String(url).includes('getRecord')) return remote ? Response.json({ uri: `at://did:plc:test/app.bsky.feed.post/${operations.deliveries()[0]!.recordKey}`, value: remote }) : Response.json({ error: 'RecordNotFound' }, { status: 400 });
    if (String(url).includes('uploadBlob')) { uploads++; expect(Buffer.from(init!.body as Uint8Array)).toEqual(bytes); return Response.json({ blob: { $type: 'blob', ref: { $link: imageCid(imageDigest(bytes)) }, mimeType: 'image/jpeg', size: bytes.length } }); }
    if (String(url).includes('createRecord')) { posts++; const body = JSON.parse(String(init!.body)); remote = body.record; return Response.json({ uri: `at://did:plc:test/app.bsky.feed.post/${body.rkey}`, cid: 'post-cid' }); }
    throw new Error('Unexpected external request');
  });
  app.connections = new ConnectionService(app, vault, undefined, transport); product = app.connections.view().products[0]!.id;
  const account: ConnectedAccount = { id: 'bsky', productId: product, provider: 'bluesky', label: 'Business Bluesky', site: '', username: 'brand.test', identity: 'brand.test', status: 'verified', detail: '', checkedAt: clock.now(), expiresAt: null, refreshable: false, grantedScopes: [], createdAt: clock.now() };
  app.db.insert(settings).values({ key: 'connections.account.bsky', value: account }).run();
  app.db.insert(marketingWorkflows).values({ id: 'image-workflow', productId: product, name: 'Local illustration', workflow: standardImageWorkflow('installed.safetensors') }).run();
  llm = new ScriptedLlmClient([JSON.stringify(approved)]); app.operationImages = new OperationImages(app, folder, () => ({ bytes, width: 1024, height: 1024 }), llm);
  operations = new OperationsService(app); app.operations = operations;
  fetcher = vi.fn(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/object_info') return Response.json(Object.fromEntries(Object.values(standardImageWorkflow('installed')).map(n => [n.class_type, { python_module: 'nodes' }])));
    if (path === '/prompt') { renders++; expect(String(init!.body)).toContain('Editorial illustration'); return Response.json({ prompt_id: 'render-one' }); }
    if (path === '/history/render-one') return Response.json({ 'render-one': { status: { completed: true, status_str: 'success' }, outputs: { '7': { images: [{ filename: 'image.png', subfolder: 'Signal', type: 'output' }] } } } });
    if (path === '/queue') return Response.json({ queue_running: [], queue_pending: [] });
    if (path === '/free') return new Response(null, { status: 200 });
    if (path === '/view') return new Response(new Uint8Array(bytes));
    throw new Error(`Unexpected local request ${path}`);
  }); vi.stubGlobal('fetch', fetcher);
});
afterEach(async () => { await operations.stop(); app.close(); rmSync(folder, { recursive: true, force: true }); vi.unstubAllGlobals(); vi.unstubAllEnvs(); __setConfigForTests(null); });
function start(value = input(), workflow = 'image-workflow') {
  operations.configure(product, { objective: 'Help buyers check their source documents.', accountIds: ['bsky'], intervalHours: 24, dailyLimit: 1, imageWorkflowId: workflow }); operations.run(product); operations.schedule();
  const taskId = operations.state(product).taskId!; app.db.update(growthTasks).set({ status: 'running' }).where(eq(growthTasks.id, taskId)).run();
  app.db.insert(marketingToolCalls).values({ id: 'evidence', productId: product, taskId, name: 'product.inspect', status: 'done', result: JSON.stringify({ url: 'https://siplemona.de/', body: 'Work with local documents and check cited sources.' }), createdAt: clock.now() }).run();
  const id = operations.enqueue(product, taskId, value).id; app.db.update(growthTasks).set({ status: 'done' }).where(eq(growthTasks.id, taskId)).run(); return id;
}
async function ready() { await operations.tick(); await pollMedia(app); }
function job() { return operations.deliveries()[0]!; }
function save(value: Delivery) { app.db.update(settings).set({ value }).where(eq(settings.key, `operations.delivery.${value.id}`)).run(); }

it('renders, reviews actual bytes, uploads the approved image and publishes the matching embed', async () => {
  start(); await operations.tick(); expect(renders).toBe(1); expect(posts).toBe(0); expect(job().attempts).toBe(0);
  await pollMedia(app); await operations.tick();
  expect(job()).toMatchObject({ status: 'published', image: { phase: 'ready', asset: { sha256: imageDigest(bytes), alt: approved.description } } });
  expect(llm.calls[0]!.images).toEqual([{ mime: 'image/jpeg', base64: bytes.toString('base64') }]); expect(uploads).toBe(1); expect(posts).toBe(1);
  expect(remote).toMatchObject({ embed: { $type: 'app.bsky.embed.images', images: [{ alt: approved.description, aspectRatio: { width: 1024, height: 1024 } }] } });
  expect(operations.imagePreview(product, job().id)).toContain(bytes.toString('base64')); expect(JSON.stringify(operations.view())).not.toContain('secret-bsky-key');
});
it('uses the separately configured local vision model for pixel review', async () => {
  saveRuntimeSettings(app, { ...runtimeSettings(app), localVisionModel: 'installed-vision-model' });
  start(); await ready(); await operations.tick(); expect(llm.calls[0]!.model).toBe('installed-vision-model'); expect(job().status).toBe('published');
});
it('requires business-scoped image workflows and an explicit image brief', () => {
  expect(() => imageWorkflow(app, app.connections!.view().products[1]!.id, 'image-workflow')).toThrow('business');
  expect(() => start({ ...input(), visual: undefined })).toThrow('requires an image');
});
it('rejects video, private input files and batch output workflows for this image delivery path', () => {
  for (const class_type of ['SaveVideo', 'LoadImage', 'CustomImageNode']) {
    app.db.update(marketingWorkflows).set({ workflow: { ...standardImageWorkflow('x'), '8': { class_type, inputs: {} } } }).where(eq(marketingWorkflows.id, 'image-workflow')).run();
    expect(() => imageWorkflow(app, product, 'image-workflow')).toThrow('built-in');
  }
  const workflow = standardImageWorkflow('x'); workflow['4'].inputs.batch_size = 2; app.db.update(marketingWorkflows).set({ workflow }).where(eq(marketingWorkflows.id, 'image-workflow')).run(); expect(() => imageWorkflow(app, product, 'image-workflow')).toThrow('one image');
});
it('recovers the original render after restart and never generates a second image', async () => {
  start(); await operations.tick(); const id = job().image!.mediaId; operations = new OperationsService(app); app.operations = operations;
  await operations.tick(); expect(renders).toBe(1); expect(job().image!.mediaId).toBe(id); await pollMedia(app); await operations.tick(); expect(posts).toBe(1);
});
it('retains a lost submission acknowledgement without another render', async () => {
  start(); const original = fetcher.getMockImplementation()!; fetcher.mockImplementation(async (url, init) => { if (new URL(String(url)).pathname === '/prompt') { renders++; throw new Error('Response lost'); } return original(url, init); });
  await operations.tick(); expect(job().status).toBe('queued'); await operations.tick(); expect(renders).toBe(1); expect(job().image!.phase).toBe('rendering'); expect(posts).toBe(0);
});
it('does not publish an image rejected by visual review', async () => {
  app.operationImages = new OperationImages(app, folder, () => ({ bytes, width: 1024, height: 1024 }), new ScriptedLlmClient([JSON.stringify({ ...approved, approved: false, issues: ['Distorted objects'] })]));
  start(); save({ ...job(), image: { ...job().image!, renderAttempts: 3 } }); await ready(); await operations.tick(); expect(job()).toMatchObject({ status: 'attention', attempts: 0, image: { phase: 'attention' } }); expect(uploads).toBe(0);
});
it('cannot silently fall back to text if the decoder or vision model fails', async () => {
  app.operationImages = new OperationImages(app, folder, () => { throw new Error('Invalid image'); }, llm); start(); await ready(); await operations.tick(); expect(job().status).toBe('attention'); expect(llm.calls).toHaveLength(0); expect(posts).toBe(0);
});
it('rejects multiple outputs and traversal paths before fetching image bytes', async () => {
  start(); await ready(); const mediaId = job().image!.mediaId;
  app.db.update(marketingMedia).set({ outputs: [{ filename: 'image.png', subfolder: '../private', type: 'output', nodeId: '7' }] }).where(eq(marketingMedia.id, mediaId)).run();
  await operations.tick(); expect(job().status).toBe('attention'); expect(fetcher.mock.calls.some(c => String(c[0]).includes('/view'))).toBe(false);
});
it('preserves approved image identity when publication acknowledgement is lost', async () => {
  start(); await ready(); const original = transport.getMockImplementation()!; transport.mockImplementation(async (url, init) => { const result = await original(url, init); if (String(url).includes('createRecord')) throw new Error('Response lost'); return result; });
  await operations.tick(); expect(job().status).toBe('retry'); clock.advance(180000); await operations.tick(); expect(job().status).toBe('published'); expect(renders).toBe(1); expect(uploads).toBe(1); expect(posts).toBe(1);
});
it('rejects a changed remote image instead of reporting it as this campaign', async () => {
  start(); await ready(); await operations.tick(); const sent = job(); const changed = JSON.parse(JSON.stringify(remote)); changed.embed.images[0].alt = 'A different image'; remote = changed; save({ ...sent, status: 'retry', receipt: null, nextAttemptAt: clock.now() }); await operations.tick(); expect(job().status).toBe('attention'); expect(posts).toBe(1);
});
it('checks saved image bytes before upload', async () => {
  start(); await ready(); const original = transport.getMockImplementation()!; transport.mockImplementation(async (url, init) => { if (String(url).includes('getRecord')) { writeFileSync(join(folder, `${imageDigest(bytes)}.jpg`), 'changed'); } return original(url, init); });
  await operations.tick(); expect(uploads).toBe(0); expect(job().status).toBe('attention');
});
it('pauses during vision review without uploading or losing the original render', async () => {
  app.operationImages = new OperationImages(app, folder, () => ({ bytes, width: 1024, height: 1024 }), { available: () => ({ ready: true }), complete: async () => { operations.pause(product); return { text: JSON.stringify(approved), inputTokens: 0, outputTokens: 0, model: 'vision', stopReason: 'stop' }; } });
  start(); await ready(); await operations.tick(); expect(posts).toBe(0); expect(job().image!.mediaId).toBeTruthy(); expect(operations.state(product).running).toBe(false);
});
it('waits for active generation and runtime readiness before claiming GPU work', async () => {
  start(); await operations.tick(false); expect(renders).toBe(0);
  app.db.update(growthTasks).set({ status: 'running' }).where(eq(growthTasks.id, operations.state(product).taskId!)).run(); await operations.tick(); expect(renders).toBe(0);
});
it('waits for sales reasoning before starting the vision model', async () => {
  start(); await ready(); app.sales = { agentBusy: () => true } as NonNullable<App['sales']>;
  await operations.tick(); expect(llm.calls).toHaveLength(0); expect(posts).toBe(0);
  delete app.sales; await operations.tick(); expect(posts).toBe(1);
});
it('serializes image preparation across competing workers', async () => {
  start(); await Promise.all([operations.tick(), new OperationsService(app).tick()]); expect(renders).toBe(1); await pollMedia(app); await Promise.all([operations.tick(), new OperationsService(app).tick()]); expect(llm.calls).toHaveLength(1); expect(posts).toBe(1);
});
it('rejects malformed and oversized image dimensions before native decoding', () => {
  expect(() => imageDimensions(Buffer.from('<svg>not a raster</svg>'))).toThrow('PNG or JPEG');
  const png = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.write('IHDR', 12); png.writeUInt32BE(1024, 16); png.writeUInt32BE(512, 20);
  expect(imageDimensions(png)).toEqual({ width: 1024, height: 512 }); png.writeUInt32BE(1000000, 16); expect(() => imageDimensions(png)).toThrow('4096');
  const jpeg = Buffer.from([255, 216, 255, 192, 0, 11, 8, 2, 0, 4, 0, 1, 1, 0, 0]); expect(imageDimensions(jpeg)).toEqual({ width: 1024, height: 512 });
  expect(() => imageDimensions(jpeg.subarray(0, 8))).toThrow('PNG or JPEG');
});
it('will not unload ComfyUI memory while other jobs are queued', async () => {
  start(); await ready(); const original = fetcher.getMockImplementation()!; fetcher.mockImplementation(async (url, init) => new URL(String(url)).pathname === '/queue' ? Response.json({ queue_running: [], queue_pending: [['external-job']] }) : original(url, init));
  await operations.tick(); expect(job().image!.phase).toBe('rendering'); expect(llm.calls).toHaveLength(0); expect(fetcher.mock.calls.some(c => String(c[0]).includes('/free'))).toBe(false); expect(posts).toBe(0);
});
it('preserves a completed render while its source campaign is cancelled', async () => {
  start(); await operations.tick(); operations.cancel(product, job().id); await pollMedia(app); await operations.tick(); expect(job().status).toBe('cancelled'); expect(posts).toBe(0); expect(app.db.select().from(marketingMedia).get()!.status).toBe('done');
});
it('revises an unsuitable image with bounded visual feedback before publishing', async () => {
  const replacementPrompt = 'Two plain yellow folders arranged side by side on a clean ivory desk, a silver magnifier between them, warm studio light.';
  llm = new ScriptedLlmClient([JSON.stringify({ ...approved, approved: false, issues: ['Simplify the cluttered composition.'], replacementPrompt }), JSON.stringify(approved)]);
  app.operationImages = new OperationImages(app, folder, () => ({ bytes, width: 1024, height: 1024 }), llm);
  start(); const originalId = job().image!.mediaId; await ready(); await operations.tick();
  expect(job().image).toMatchObject({ phase: 'pending', renderAttempts: 2, feedback: 'Simplify the cluttered composition.' }); expect(job().image!.mediaId).not.toBe(originalId); expect(posts).toBe(0);
  operations = new OperationsService(app); app.operations = operations;
  await ready(); await operations.tick(); expect(job().status).toBe('published'); expect(renders).toBe(2); expect(posts).toBe(1);
  const rendered = String(fetcher.mock.calls.filter(call => new URL(String(call[0])).pathname === '/prompt')[1]![1]!.body);
  expect(rendered).toContain(replacementPrompt); expect(rendered).not.toContain(input().visual!.prompt);
  expect(rendered).not.toContain('Simplify the cluttered composition.');
});
it('holds a rejected image when the model supplies no usable replacement composition', async () => {
  app.operationImages = new OperationImages(app, folder, () => ({ bytes, width: 1024, height: 1024 }), new ScriptedLlmClient([JSON.stringify({ ...approved, approved: false, issues: ['Invented document figures.'] })]));
  start(); await ready(); await operations.tick(); expect(job().status).toBe('attention'); expect(renders).toBe(1); expect(posts).toBe(0);
});
it('reserves the model slot during image review and releases it after completion', async () => {
  let reserved = false;
  app.operationImages = new OperationImages(app, folder, () => ({ bytes, width: 1024, height: 1024 }), { available: () => ({ ready: true }), complete: async () => { reserved = hasPendingMedia(app); return { text: JSON.stringify(approved), inputTokens: 0, outputTokens: 0, model: 'vision', stopReason: 'stop' }; } });
  start(); await ready(); await operations.tick(); expect(reserved).toBe(true); expect(hasPendingMedia(app)).toBe(false);
});
it('adds the configured product link and affiliation to a concise social caption', () => {
  start({ ...input(), body: 'Compare conflicting dates across reports and check the cited source.' });
  expect(job().body).toContain('Our app: Compare'); expect(job().body).toContain('https://siplemona.de/');
});
it('rejects evidence from a different uninspected page', () => {
  expect(() => start({ ...input(), evidence: ['https://siplemona.de/other-page'] })).toThrow('cite its returned URL');
});
it('accepts the same inspected origin with an implicit slash', () => {
  start({ ...input(), evidence: ['https://siplemona.de'] }); expect(job().status).toBe('queued');
});
it('encodes the raw SHA256 content identifier independently of the upload response', () => {
  expect(imageCid('0'.repeat(64))).toBe('bafkrei' + 'a'.repeat(52));
});
it('publishes a branded card from the exact reviewed copy without diffusion or vision requests', async () => {
  const render = vi.fn(async () => bytes);
  app.operationImages = new OperationImages(app, folder, () => ({ bytes, width: 1200, height: 675 }), llm, render);
  start({ ...input(), visual: undefined }, BRAND_CARD_WORKFLOW); await operations.tick();
  expect(render).toHaveBeenCalledWith({ brand: 'Lemonade', title: input().title, description: input().description, domain: 'siplemona.de', theme: 'lemonade' }, expect.any(AbortSignal));
  expect(fetcher).not.toHaveBeenCalled(); expect(llm.calls).toHaveLength(0); expect(renders).toBe(0); expect(uploads).toBe(1); expect(posts).toBe(1);
  expect(job()).toMatchObject({ status: 'published', image: { phase: 'ready', asset: { sha256: imageDigest(bytes), model: 'Local layout check v1' } } });
  expect(job().image!.asset!.alt).toContain(input().title); expect(job().image!.asset!.alt).toContain(input().description);
  expect(remote).toMatchObject({ embed: { images: [{ aspectRatio: { width: 1200, height: 675 } }] } });
});
it('keeps branded card publication paused during rendering and can resume after restart', async () => {
  const render = vi.fn(async () => { operations.pause(product); return bytes; });
  app.operationImages = new OperationImages(app, folder, () => ({ bytes, width: 1200, height: 675 }), llm, render);
  start({ ...input(), visual: undefined }, BRAND_CARD_WORKFLOW); await operations.tick();
  expect(posts).toBe(0); expect(uploads).toBe(0); expect(job().image!.asset).toBeUndefined();
  render.mockImplementation(async () => bytes); operations = new OperationsService(app); app.operations = operations; operations.run(product); await operations.tick();
  expect(job().status).toBe('published'); expect(posts).toBe(1);
});
it('holds a failed card for attention without publishing a text-only fallback', async () => {
  app.operationImages = new OperationImages(app, folder, () => ({ bytes, width: 1200, height: 675 }), llm, async () => { throw new Error('The brand card copy does not fit.'); });
  start({ ...input(), visual: undefined }, BRAND_CARD_WORKFLOW); await operations.tick();
  expect(job()).toMatchObject({ status: 'attention', image: { phase: 'attention', detail: 'The brand card copy does not fit.' } }); expect(posts).toBe(0); expect(uploads).toBe(0);
});
it('reuses the saved branded image after losing publication acknowledgement', async () => {
  const render = vi.fn(async () => bytes);
  app.operationImages = new OperationImages(app, folder, () => ({ bytes, width: 1200, height: 675 }), llm, render);
  start({ ...input(), visual: undefined }, BRAND_CARD_WORKFLOW);
  const original = transport.getMockImplementation()!; transport.mockImplementation(async (url, init) => { const response = await original(url, init); if (String(url).includes('createRecord')) throw new Error('Response lost'); return response; });
  await operations.tick(); expect(job().status).toBe('retry'); operations = new OperationsService(app); app.operations = operations; clock.advance(180000); await operations.tick();
  expect(job().status).toBe('published'); expect(render).toHaveBeenCalledTimes(1); expect(uploads).toBe(1); expect(posts).toBe(1);
});
it('offers branded cards for each business without requesting an image model', () => {
  saveRuntimeSettings(app, { ...runtimeSettings(app), localVisionModel: 'unavailable-vision' });
  start({ ...input(), visual: undefined }, BRAND_CARD_WORKFLOW);
  expect(operations.agentModels(product)).not.toContain('unavailable-vision');
  expect(operations.readiness(product).activities.find(a => a.label === 'Campaign images')).toMatchObject({ ready: true, detail: expect.stringContaining('local branded card') });
  expect(operations.view().imageWorkflows!.filter(w => w.id === BRAND_CARD_WORKFLOW).map(w => w.productId)).toEqual(operations.view().products.map(p => p.id));
});
it('rejects art direction that would be ignored by branded cards', () => {
  expect(() => start(input(), BRAND_CARD_WORKFLOW)).toThrow('Omit visual');
});
it('composes, independently reviews, renders and queues a branded image through the operating agent', async () => {
  let reviewed = false; let composed = false;
  const render = vi.fn(async () => { expect(reviewed).toBe(true); return bytes; });
  app.operationImages = new OperationImages(app, folder, () => ({ bytes, width: 1200, height: 675 }), llm, render);
  operations.configure(product, { objective: 'Help buyers check their source documents.', accountIds: ['bsky'], intervalHours: 24, dailyLimit: 1, imageWorkflowId: BRAND_CARD_WORKFLOW }); operations.run(product); operations.schedule();
  const engine = new GrowthEngine(app, { available: () => ({ ready: true }), complete: async request => {
    let response: unknown;
    if (request.task === 'operations.review') {
      reviewed = true; response = reviewFixture(request);
    } else {
      composed = true; expect(request.prompt).toContain('Do not include visual.'); expect(JSON.stringify(request.jsonSchema)).not.toContain('"visual"');
      response = { message: 'Queueing a short campaign with a branded card.', actions: [{ tool: 'operations.enqueue', input: { ...input(), visual: undefined } }] };
    }
    return { text: JSON.stringify(response), model: 'fixture', inputTokens: 0, outputTokens: 0, stopReason: 'stop' };
  } });
  await engine.runNext(['marketing']); expect(composed).toBe(true); expect(reviewed).toBe(true);
  expect(job()).toMatchObject({ status: 'queued', image: { workflowId: BRAND_CARD_WORKFLOW, phase: 'pending' } }); expect(posts).toBe(0);
  await operations.tick(); expect(job().status).toBe('published'); expect(render).toHaveBeenCalledTimes(1); expect(posts).toBe(1);
});
