import { and, eq, inArray } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { App } from '../app.js';
import { growthTasks, marketingMedia, marketingWorkflows } from '../db/schema.js';
import { newId } from '../lib/id.js';
import { localUrl } from '../../shared/marketing.js';
import { marketingSettings, requireProduct } from './store.js';

async function json(base: string, route: string, init?: RequestInit): Promise<unknown> {
  localUrl.parse(base);
  const response = await fetch(`${base.replace(/\/$/, '')}${route}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json' } });
  if (!response.ok) throw new Error(`ComfyUI ${response.status}: ${(await response.text()).slice(0, 250)}`);
  return response.json();
}
const nodeSchema = z.object({ class_type: z.string(), inputs: z.record(z.unknown()), _meta: z.unknown().optional() });
export function parseWorkflow(value: unknown) {
  const nodes = z.record(nodeSchema).parse(value);
  if (!Object.keys(nodes).length || Object.keys(nodes).length > 100) throw new Error('Use an API-format workflow with 1–100 nodes');
  const serialized = JSON.stringify(nodes);
  if (serialized.length > 200000 || /https?:\/\/|api_key|auth_token|execute|shell_command/i.test(serialized)) throw new Error('Use a local workflow without remote APIs, credentials or command execution');
  return nodes;
}
export async function comfyStatus(app: App) {
  if (app.env.SIGNAL_OFFLINE === '1') return { ok: false, detail: 'Offline mode', checkpoints: [] as string[] };
  try {
    const base = marketingSettings(app).comfyUrl;
    await json(base, '/system_stats');
    const info = await json(base, '/object_info/CheckpointLoaderSimple') as Record<string, { input?: { required?: { ckpt_name?: unknown[] } } }>;
    const checkpoints = z.array(z.string()).catch([]).parse(info['CheckpointLoaderSimple']?.input?.required?.ckpt_name?.[0]);
    return { ok: true, detail: 'ComfyUI is reachable. Workflows use only installed local nodes and models.', checkpoints };
  } catch (error) {
    return { ok: false, detail: `ComfyUI is not ready: ${String(error)}. Start ComfyUI, then check again.`, checkpoints: [] as string[] };
  }
}
export function standardImageWorkflow(checkpoint: string) {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}', clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: 'watermark, illegible text, low quality', clip: ['1', 1] } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    '5': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0] } },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'Signal' } },
  };
}
export async function submitMedia(app: App, productId: string, workflowId: string, prompt: string, owningTaskId?: string, operation?: { id: string; check: () => void }) {
  requireProduct(app, productId);
  if (app.video?.agentBusy()) throw new Error('Wait for the active video job before starting another local render.');
  if (!operation && app.operations?.imageBusy?.()) throw new Error('Wait for the active campaign image review before starting another render.');
  if (app.env.SIGNAL_OFFLINE === '1') throw new Error('Offline mode');
  const active = app.db.select().from(growthTasks).where(eq(growthTasks.status, 'running')).get();
  if (active && (active.id !== owningTaskId || active.kind !== 'marketing')) throw new Error('Wait for the current local model task before starting media generation.');
  if (app.db.select().from(marketingMedia).where(inArray(marketingMedia.status, ['submitting', 'queued', 'running'])).get()) throw new Error('A media job is already pending. Finish it before starting another.');
  const workflow = app.db.select().from(marketingWorkflows).where(and(eq(marketingWorkflows.id, workflowId), eq(marketingWorkflows.productId, productId))).get();
  if (!workflow) throw new Error('Choose a workflow for this product first');
  const base = marketingSettings(app).comfyUrl;
  const nodes = parseWorkflow(workflow.workflow);
  const id = operation?.id ?? newId();
  operation?.check();
  for (const node of Object.values(nodes)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (typeof value === 'string') node.inputs[key] = value.replaceAll('{{prompt}}', prompt);
      if (key === 'filename_prefix') node.inputs[key] = `Signal/${id}`;
    }
  }
  const workflowHash = createHash('sha256').update(JSON.stringify(nodes)).digest('hex');
  app.db.transaction(() => {
    if (app.db.select().from(marketingMedia).where(inArray(marketingMedia.status, ['submitting', 'queued', 'running'])).get()) throw new Error('A media job is already pending. Finish it before starting another.');
    const task = app.db.select().from(growthTasks).where(eq(growthTasks.status, 'running')).get();
    if (task && (task.id !== owningTaskId || task.kind !== 'marketing')) throw new Error('Wait for the current local model task before starting media generation.');
    app.db.insert(marketingMedia).values({ id, productId, workflowId, status: 'submitting', prompt, baseUrl: base, workflowHash, createdAt: app.clock.now() }).run();
  });
  let attempted = false;
  try {
    if (app.ensureCreativeRuntime) await app.ensureCreativeRuntime(AbortSignal.timeout(200000));
    operation?.check();
    const info = await json(base, '/object_info') as Record<string, { python_module?: string; api_node?: boolean }>;
    for (const node of Object.values(nodes)) {
      const metadata = info[node.class_type];
      if (!metadata || metadata.api_node || !(metadata.python_module === 'nodes' || metadata.python_module?.startsWith('comfy_extras.'))) throw new Error(`Workflow node ${node.class_type} is missing or is not a supported built-in local node. Custom and paid API nodes are disabled.`);
    }
    operation?.check();
    attempted = true;
    const result = z.object({ prompt_id: z.string().min(1) }).parse(await json(base, '/prompt', { method: 'POST', body: JSON.stringify({ prompt: nodes, client_id: `signal-${id}` }) }));
    app.db.update(marketingMedia).set({ status: 'queued', promptId: result.prompt_id }).where(eq(marketingMedia.id, id)).run();
    return { id, promptId: result.prompt_id, status: 'queued', note: 'Queued in local ComfyUI. Signal pauses model work until this media job finishes.' };
  } catch (error) {
    const uncertain = attempted && !/ComfyUI \d{3}:/.test(String(error));
    app.db.update(marketingMedia).set({ status: uncertain ? 'submitting' : 'failed', error: uncertain ? 'Submission acknowledgement lost. Signal is reconciling the ComfyUI queue before allowing another job.' : String(error) }).where(eq(marketingMedia.id, id)).run();
    throw error;
  }
}
export async function pollMedia(app: App): Promise<void> {
  if (app.env.SIGNAL_OFFLINE === '1') return;
  for (const job of app.db.select().from(marketingMedia).where(eq(marketingMedia.status, 'submitting')).all()) {
    if (app.clock.now() - job.createdAt < 30000) continue;
    try {
      const queue = await json(job.baseUrl, '/queue') as { queue_running?: unknown[][]; queue_pending?: unknown[][] };
      const history = await json(job.baseUrl, '/history?max_items=100') as Record<string, { prompt?: unknown[] }>;
      const candidates = [...(queue.queue_running ?? []), ...(queue.queue_pending ?? []), ...Object.values(history).map(item => item.prompt ?? [])];
      const match = candidates.find(row => (row[3] as { client_id?: string } | undefined)?.client_id === `signal-${job.id}`);
      if (typeof match?.[1] === 'string') app.db.update(marketingMedia).set({ promptId: match[1], status: 'queued', error: null }).where(eq(marketingMedia.id, job.id)).run();
      else if (app.clock.now() - job.createdAt > 120000) app.db.update(marketingMedia).set({ status: 'failed', error: 'No matching job exists in ComfyUI queue or recent history. Submission was interrupted; you can generate again.' }).where(eq(marketingMedia.id, job.id)).run();
    } catch { /* Keep the lane reserved until the actual server state can be checked. */ }
  }
  const jobs = app.db.select().from(marketingMedia).where(inArray(marketingMedia.status, ['queued', 'running'])).all();
  for (const job of jobs) {
    if (!job.promptId) continue;
    try {
      const response = await json(job.baseUrl, `/history/${encodeURIComponent(job.promptId)}`) as Record<string, { status?: { status_str?: string; completed?: boolean; messages?: unknown }; outputs?: Record<string, Record<string, unknown>> }>;
      const result = response[job.promptId];
      if (!result) {
        const queue = await json(job.baseUrl, '/queue') as { queue_running?: unknown[][] };
        const running = queue.queue_running?.some((r) => r[1] === job.promptId);
        app.db.update(marketingMedia).set({ status: running ? 'running' : 'queued', error: 'Waiting for ComfyUI output. If the job was removed outside Signal, cancel it here.' }).where(eq(marketingMedia.id, job.id)).run();
        continue;
      }
      if (result.status?.status_str === 'error') {
        app.db.update(marketingMedia).set({ status: 'failed', error: creativeExecutionError(result.status.messages) }).where(eq(marketingMedia.id, job.id)).run();
        continue;
      }
      if (!result.status?.completed) continue;
      const outputs: { filename: string; subfolder: string; type: string; nodeId: string }[] = [];
      for (const [nodeId, output] of Object.entries(result.outputs ?? {})) for (const items of Object.values(output)) if (Array.isArray(items)) {
        for (const item of items) {
          const parsed = z.object({ filename: z.string(), subfolder: z.string().default(''), type: z.enum(['output', 'temp']).default('output') }).safeParse(item);
          if (parsed.success) outputs.push({ ...parsed.data, nodeId });
        }
      }
      app.db.update(marketingMedia).set({ status: outputs.length ? 'done' : 'failed', outputs, error: outputs.length ? null : 'Workflow finished without saved media. Add a Save node.' }).where(eq(marketingMedia.id, job.id)).run();
    } catch (error) {
      // Keep the GPU lane held when the server may still be generating.
      app.db.update(marketingMedia).set({ error: `Cannot check ComfyUI: ${String(error)}. Reconnect or cancel the job.` }).where(eq(marketingMedia.id, job.id)).run();
    }
  }
}
export function creativeExecutionError(messages: unknown): string {
  const rows = z.array(z.tuple([z.string(), z.unknown()])).safeParse(messages);
  const failure = rows.success ? rows.data.findLast(row => row[0] === 'execution_error')?.[1] : undefined;
  const parsed = z.object({ node_type: z.string().max(120).optional(), exception_message: z.string().max(50000) }).safeParse(failure);
  if (!parsed.success) return 'The local workflow failed. Check its required models and try a smaller image or clip.';
  const message = Array.from(parsed.data.exception_message.slice(0, 1200), char => char.charCodeAt(0) < 32 ? ' ' : char).join('');
  return `${parsed.data.node_type ?? 'Local workflow'}: ${message}`;
}
export async function cancelMedia(app: App, id: string): Promise<void> {
  const job = app.db.select().from(marketingMedia).where(eq(marketingMedia.id, id)).get();
  if (!job?.promptId || !['queued', 'running'].includes(job.status)) throw new Error('No pending media job');
  const queue = await json(job.baseUrl, '/queue') as { queue_running?: unknown[][] };
  if (queue.queue_running?.some((r) => r[1] === job.promptId)) {
    if (!await app.cancelCreativeRender?.(job.baseUrl, job.promptId)) throw new Error('This job is rendering in an external server. Stop it in ComfyUI, then cancel here.');
    app.db.update(marketingMedia).set({ status: 'cancelled', error: null }).where(eq(marketingMedia.id, id)).run(); return;
  }
  await json(job.baseUrl, '/queue', { method: 'POST', body: JSON.stringify({ delete: [job.promptId] }) }).catch((e: unknown) => { if (!(e instanceof SyntaxError)) throw e; });
  app.db.update(marketingMedia).set({ status: 'cancelled', error: null }).where(eq(marketingMedia.id, id)).run();
}
