import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { createApp, type App } from '../../src/core/app.js';
import { initializeMarketing, marketingView, saveMarketingSettings, DEFAULT_MARKETING, hasPendingMedia } from '../../src/core/marketing/store.js';
import { marketingAction } from '../../src/core/marketing/actions.js';
import { cancelMedia, comfyStatus, creativeExecutionError, pollMedia, standardImageWorkflow, submitMedia } from '../../src/core/marketing/comfy.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { GrowthEngine } from '../../src/core/growth/engine.js';
import { marketingMedia } from '../../src/core/db/schema.js';
import { eq } from 'drizzle-orm';

let server: Server; let app: App; let complete = false; let running = false;
let received: Record<string, unknown>[] = [];
let loseAcknowledgement = false;
beforeEach(async () => {
  complete = false; running = false; received = []; loseAcknowledgement = false;
  server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += String(chunk);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/system_stats') res.end('{}');
    else if (req.url === '/object_info/CheckpointLoaderSimple') res.end(JSON.stringify({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [['test.safetensors']] } } } }));
    else if (req.url === '/object_info') res.end(JSON.stringify(Object.fromEntries(Object.values(standardImageWorkflow('test.safetensors')).map((n) => [n.class_type, { python_module: 'nodes' }]))));
    else if (req.url === '/prompt') { received.push(JSON.parse(body) as Record<string, unknown>); if (loseAcknowledgement) res.destroy(); else res.end('{"prompt_id":"our-job"}'); }
    else if (req.url === '/history?max_items=100') res.end(JSON.stringify({ 'our-job': { prompt: [0, 'our-job', {}, { client_id: received[0]?.['client_id'] }] } }));
    else if (req.url === '/history/our-job') res.end(complete ? JSON.stringify({ 'our-job': { status: { completed: true, status_str: 'success' }, outputs: { '7': { images: [{ filename: 'image.png', subfolder: 'Signal/test', type: 'output' }] } } } }) : '{}');
    else if (req.url === '/queue') { if (req.method === 'POST') received.push(JSON.parse(body) as Record<string, unknown>); res.end(JSON.stringify({ queue_running: running ? [[0, 'our-job']] : [] })); }
    else { res.statusCode = 404; res.end('{}'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test server');
  app = createApp({ databaseUrl: ':memory:', logger: silentLogger }); initializeMarketing(app);
  saveMarketingSettings(app, { ...DEFAULT_MARKETING, comfyUrl: `http://127.0.0.1:${address.port}` });
  const p = marketingView(app).products[0]!;
  await marketingAction(app, { type: 'workflow', productId: p.id, name: 'Fixture image', workflow: standardImageWorkflow('test.safetensors') });
});
afterEach(async () => { app.close(); server.close(); await once(server, 'close'); });
it('discovers local capabilities, persists queued jobs, pauses model work, and reads only completed outputs', async () => {
  expect(await comfyStatus(app)).toMatchObject({ ok: true, checkpoints: ['test.safetensors'] });
  const view = marketingView(app); const p = view.products[0]!;
  await submitMedia(app, p.id, view.workflows[0]!.id, 'A useful local illustration');
  expect(hasPendingMedia(app)).toBe(true);
  expect(await new GrowthEngine(app).runNext()).toBe(false);
  expect(marketingView(app).media[0]).toMatchObject({ status: 'queued', promptId: 'our-job', outputs: [] });
  const sent = JSON.stringify(received[0]); expect(sent).toContain('A useful local illustration'); expect(sent).not.toContain('{{prompt}}');
  running = true; await pollMedia(app); expect(marketingView(app).media[0]!.status).toBe('running');
  complete = true; await pollMedia(app);
  expect(marketingView(app).media[0]).toMatchObject({ status: 'done', outputs: [{ filename: 'image.png', type: 'output', nodeId: '7' }] });
  expect(hasPendingMedia(app)).toBe(false);
});
it('cancels only its queued prompt and refuses a global interrupt for a running job', async () => {
  const view = marketingView(app); await submitMedia(app, view.products[0]!.id, view.workflows[0]!.id, 'test');
  const job = marketingView(app).media[0]!; running = true;
  await expect(cancelMedia(app, job.id)).rejects.toThrow('Stop it in ComfyUI');
  running = false; await cancelMedia(app, job.id);
  expect(received.at(-1)).toEqual({ delete: ['our-job'] });
  expect(marketingView(app).media[0]!.status).toBe('cancelled');
});
it('reserves the GPU lane before any asynchronous server validation', async () => {
  const view = marketingView(app); const product = view.products[0]!.id; const workflow = view.workflows[0]!.id;
  const results = await Promise.allSettled([submitMedia(app, product, workflow, 'first'), submitMedia(app, product, workflow, 'second')]);
  expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect(received).toHaveLength(1);
  expect(marketingView(app).media).toHaveLength(1);
});
it('recovers a lost submission acknowledgement without submitting duplicate media', async () => {
  loseAcknowledgement = true;
  const view = marketingView(app);
  await expect(submitMedia(app, view.products[0]!.id, view.workflows[0]!.id, 'survive disconnect')).rejects.toThrow();
  const job = marketingView(app).media[0]!;
  expect(job.status).toBe('submitting'); expect(hasPendingMedia(app)).toBe(true);
  app.db.update(marketingMedia).set({ createdAt: app.clock.now() - 40000 }).where(eq(marketingMedia.id, job.id)).run();
  complete = true; await pollMedia(app);
  expect(marketingView(app).media[0]).toMatchObject({ status: 'done', promptId: 'our-job' });
  expect(received).toHaveLength(1);
});
it('starts the owned runtime with the media lane reserved before sending a prompt', async () => {
  const start = vi.fn(async () => { expect(hasPendingMedia(app)).toBe(true); expect(received).toHaveLength(0); }); app.ensureCreativeRuntime = start;
  const view = marketingView(app); await submitMedia(app, view.products[0]!.id, view.workflows[0]!.id, 'owned image');
  expect(start).toHaveBeenCalledOnce(); expect(received).toHaveLength(1);
});
it('records a startup failure without posting a render or retaining the media lane', async () => {
  app.ensureCreativeRuntime = async () => { throw new Error('Engine setup required'); };
  const view = marketingView(app); await expect(submitMedia(app, view.products[0]!.id, view.workflows[0]!.id, 'owned image')).rejects.toThrow('Engine setup required');
  expect(hasPendingMedia(app)).toBe(false); expect(received).toHaveLength(0); expect(marketingView(app).media[0]?.status).toBe('failed');
});
it('cancels a running render in Signal only after its owned runtime confirms stopping', async () => {
  const view = marketingView(app); await submitMedia(app, view.products[0]!.id, view.workflows[0]!.id, 'owned image'); running = true;
  const cancel = vi.fn(async () => true); app.cancelCreativeRender = cancel;
  const job = marketingView(app).media[0]!; await cancelMedia(app, job.id);
  expect(cancel).toHaveBeenCalledExactlyOnceWith(view.settings.comfyUrl, 'our-job'); expect(marketingView(app).media[0]?.status).toBe('cancelled');
});
it('keeps a running render pending when owned shutdown fails', async () => {
  const view = marketingView(app); await submitMedia(app, view.products[0]!.id, view.workflows[0]!.id, 'owned image'); running = true;
  app.cancelCreativeRender = async () => { throw new Error('Shutdown not confirmed'); };
  const job = marketingView(app).media[0]!; await expect(cancelMedia(app, job.id)).rejects.toThrow('Shutdown not confirmed'); expect(hasPendingMedia(app)).toBe(true);
});
it('shows bounded node failure details inside Signal', () => {
  expect(creativeExecutionError([['execution_error', { node_type: 'VAELoader', exception_message: 'Missing VAE\nInstall the matching decoder.' }]])).toBe('VAELoader: Missing VAE Install the matching decoder.');
  expect(creativeExecutionError([['execution_error', { exception_message: 'x'.repeat(5000) }]]).length).toBeLessThan(1250);
  expect(creativeExecutionError({ unexpected: true })).toContain('Check its required models');
});
