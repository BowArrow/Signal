import { dialog, type IpcMain } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { LTX_LIMIT_ARGS, LTX_RUNTIME_ARGS } from '../../src/core/video/ltx.js';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { App } from '../../src/core/app.js';
import { IPC } from '../../src/shared/ipc.js';
import { localUrl } from '../../src/shared/marketing.js';
import type { CreativeView } from '../../src/shared/creative.js';
import { settings, marketingMedia } from '../../src/core/db/schema.js';
import { marketingSettings, saveMarketingSettings } from '../../src/core/marketing/store.js';
import { CreativeInstaller, modelPaths, portableReady, SIGNAL_COMFY_URL } from '../../src/core/runtime/creative-install.js';
import { marketingAction } from '../../src/core/marketing/actions.js';
import { MEDIA_RECIPES, inspectRecipe, type NodeInfo } from '../../src/core/marketing/media-presets.js';
import { trustedSignalFrame } from './runtime-handlers.js';

export function registerCreativeHandlers(ipc: IpcMain, app: App, userData: string, limiterScript: string, extractor: string) {
  let child: ChildProcess | null = null; let error = ''; let manuallyStopped = false;
  let runtimeModel: 'h3' | 'ltx25' | undefined;
  const installer = new CreativeInstaller(join(userData, 'runtime', 'creative'), extractor);
  const folder = () => { const row = app.db.select().from(settings).where(eq(settings.key, 'creative.portableFolder')).get(); return typeof row?.value === 'string' ? row.value : ''; };
  const owned = () => resolve(folder() || '.') === resolve(installer.root) && installer.installed();
  const source = () => [folder(), process.env['LOCALAPPDATA'] ? join(process.env['LOCALAPPDATA'], 'ai.dndrom.desktop', 'runtime', 'comfy-0.34.0', 'ComfyUI_windows_portable') : ''].find(path => path && resolve(path) !== resolve(installer.root) && portableReady(path)) ?? '';
  const busy = () => Boolean(child || automaticStart || app.video?.agentBusy() || app.db.select().from(marketingMedia).where(inArray(marketingMedia.status, ['submitting', 'queued', 'running'])).get());
  const saveFolder = (value: string) => app.db.insert(settings).values({ key: 'creative.portableFolder', value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
  const setupBusy = () => ['checking', 'copying', 'downloading', 'extracting'].includes(installer.progress.phase);
  const stopChild = async () => {
    const launched = child; if (!launched) return;
    await new Promise<void>((ok, fail) => {
      const timer = setTimeout(() => fail(new Error('The creative engine has not confirmed shutdown.')), 10000);
      launched.once('exit', () => { clearTimeout(timer); ok(); });
      if (!launched.kill()) { clearTimeout(timer); fail(new Error('Could not stop the creative engine.')); }
    });
    if (child === launched) child = null;
  };
  const info = async (): Promise<Record<string, NodeInfo>> => {
    if (app.env.SIGNAL_OFFLINE === '1') throw new Error('Offline test mode');
    const base = localUrl.parse(marketingSettings(app).comfyUrl);
    const response = await fetch(`${base.replace(/\/$/, '')}/object_info`, { redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`ComfyUI returned HTTP ${response.status}`);
    return await response.json() as Record<string, NodeInfo>;
  };
  const view = async (): Promise<CreativeView> => {
    let nodes: Record<string, NodeInfo> = {}; let ok = false; let detail = error;
    try { nodes = await info(); ok = true; detail = child ? 'Signal’s creative engine is running. Workflows use the installed local models.' : 'An external ComfyUI server is connected.'; }
    catch { detail ||= child ? 'Starting the creative engine. The first launch can take a few minutes.' : folder() ? 'Creative engine is stopped. Signal starts it when a local image workflow needs it.' : 'Set up Signal’s creative engine to run local workflows inside the app.'; }
    if (owned() && ok && !child) { ok = false; detail = 'Another process is using Signal’s creative port. Stop that instance before starting the owned engine.'; }
    return { ok, detail, managed: Boolean(child), folder: folder(), owned: owned(), ownedFolder: installer.root, setupSource: source(), supported: process.platform === 'win32', install: { ...installer.progress }, recipes: MEDIA_RECIPES.map(recipe => ({ ...recipe, missing: ok ? inspectRecipe(recipe.id, nodes).missing : ['Start the creative engine to check required models'] })) };
  };
  const start = async () => {
      if (app.env.SIGNAL_OFFLINE === '1') throw new Error('Offline test mode');
      if (setupBusy()) throw new Error('Wait for creative setup to finish.');
      if ((await view()).ok || child) return;
      const root = folder(); if (!root) throw new Error('Select your ComfyUI portable installation first.');
      const base = new URL(marketingSettings(app).comfyUrl);
      if (owned() && base.origin !== SIGNAL_COMFY_URL) throw new Error('Signal’s owned engine requires its dedicated local URL. Choose Use Signal engine to restore it.');
      if (owned()) { let occupied = false; try { await info(); occupied = true; } catch { /* stopped */ } if (occupied) throw new Error('Another ComfyUI server is using port 8190. Stop that instance first.'); }
      if (!['127.0.0.1', 'localhost'].includes(base.hostname) || base.pathname !== '/') throw new Error('Managed ComfyUI uses a localhost URL with no path.');
      const output = join(userData, 'creative-output'); mkdirSync(output, { recursive: true });
      const profile = join(userData, 'creative-profile'); mkdirSync(profile, { recursive: true });
      const database = 'sqlite:///' + join(profile, 'comfyui.db').replace(/\\/g, '/');
      const modelArgs: string[] = [];
      const roots = [...(owned() ? installer.modelRoots() : []), ...(process.env['LOCALAPPDATA'] ? [join(process.env['LOCALAPPDATA'], 'Signal', 'runtime', 'h3-models'), join(process.env['LOCALAPPDATA'], 'Signal', 'runtime', 'ltx25-models')] : [])];
      const paths = join(userData, 'creative-model-paths.yaml'); const yaml = modelPaths(roots);
      if (yaml) { writeFileSync(paths, yaml); modelArgs.push('--extra-model-paths-config', paths); }
      error = '';
      const limiter = join(userData, 'creative-limited-runtime.py');
      const limitStatus = join(userData, 'creative-limit-status.json');
      writeFileSync(limiter, readFileSync(limiterScript));
      runtimeModel = app.video?.config().localModel ?? 'h3';
      const ltx = runtimeModel === 'ltx25';
      const ltxEntry = join(userData, 'ltx_runtime.py');
      if (ltx) writeFileSync(ltxEntry, readFileSync(join(dirname(limiterScript), 'ltx_runtime.py')));
      if (ltx) writeFileSync(join(userData, 'ltx_upscaler.py'), readFileSync(join(dirname(limiterScript), 'ltx_upscaler.py')));
      const runtimeArgs = ltx ? [...LTX_RUNTIME_ARGS] : ['--disable-pinned-memory', '--disable-dynamic-vram', '--disable-cuda-malloc', '--disable-async-offload', '--lowvram', '--cpu-vae', '--fast-disk', '--cache-none', '--reserve-vram', '5'];
      const launched = spawn(join(root, 'python_embeded', 'python.exe'), ['-s', limiter, '--status', limitStatus, ...(ltx ? LTX_LIMIT_ARGS : []), '--', ...(ltx ? [ltxEntry] : []), join(root, 'ComfyUI', 'main.py'), '--windows-standalone-build', '--disable-auto-launch', '--listen', '127.0.0.1', '--port', base.port || '8188', '--disable-all-custom-nodes', '--disable-api-nodes', ...runtimeArgs, '--output-directory', output, '--user-directory', profile, '--database-url', database, ...modelArgs], { cwd: root, windowsHide: true, shell: false, stdio: 'ignore' });
      child = launched;
      launched.once('error', () => { error = 'ComfyUI could not start. Verify the selected portable installation.'; if (child === launched) child = null; });
      launched.once('exit', code => { if (child === launched) { child = null; if (code) { manuallyStopped = true; app.video?.runtimeStopped(base.origin); error = 'The capped renderer stopped. Check memory headroom, then start it again in Creative studio.'; try { const status = JSON.parse(readFileSync(limitStatus, 'utf8')) as { reason?: string }; if (status.reason) error = status.reason; } catch { /* retain bounded fallback */ } } } });
  };
  let automaticStart: Promise<void> | null = null;
  app.ensureCreativeRuntime = async signal => {
    signal.throwIfAborted();
    if (manuallyStopped) throw new Error('ComfyUI was stopped in Creative studio. Start it there to resume automatic images.');
    if (!automaticStart) automaticStart = (async () => {
      await start(); const deadline = Date.now() + 180000;
      while (Date.now() < deadline) { signal.throwIfAborted(); try { await info(); return; } catch { if (!child) break; } await new Promise(resolve => setTimeout(resolve, 1000)); }
      throw new Error('ComfyUI did not become ready. Check the installation selected in Creative studio.');
    })().finally(() => { automaticStart = null; });
    await automaticStart; signal.throwIfAborted();
  };
  app.ensureVideoRuntime = async (base, signal, model = 'h3') => {
    if (new URL(base).origin !== new URL(marketingSettings(app).comfyUrl).origin) throw new Error('Use the managed ComfyUI URL for capped video rendering.');
    await app.ensureCreativeRuntime!(signal);
    if (model !== runtimeModel) throw new Error('This queued shot uses a different local model. Save its model in Rendering setup, stop the creative engine, then resume the shot.');
    let capped = false;
    try {
      const status = JSON.parse(readFileSync(join(userData, 'creative-limit-status.json'), 'utf8')) as { state?: string; enforced?: boolean; supervisorPid?: number; updatedAt?: number };
      capped = Boolean(child?.pid && status.supervisorPid === child.pid && status.enforced && status.state === 'running' && Date.now() - (status.updatedAt ?? 0) < 10000);
    } catch { /* no verified limiter */ }
    if (!capped) throw new Error('Video requires Signal\'s capped renderer. Stop the external ComfyUI instance, then start ComfyUI from Creative studio.');
  };
  app.cancelCreativeRender = async (base, promptId) => {
    if (!owned() || !child || new URL(base).origin !== SIGNAL_COMFY_URL || app.video?.agentBusy()) return false;
    const response = await fetch(`${SIGNAL_COMFY_URL}/queue`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Could not check the owned render queue.');
    const queue = z.object({ queue_running: z.array(z.array(z.unknown())), queue_pending: z.array(z.array(z.unknown())) }).parse(await response.json());
    if (queue.queue_running.length !== 1 || queue.queue_running[0]?.[1] !== promptId || queue.queue_pending.length) throw new Error('The creative queue changed. Refresh before cancelling.');
    await stopChild(); manuallyStopped = false; error = '';
    return true;
  };
  ipc.handle(IPC.creative, event => { trustedSignalFrame(event); return view(); });
  ipc.handle(IPC.creativeAction, async (event, input: unknown) => {
    trustedSignalFrame(event);
    const action = z.discriminatedUnion('type', [z.object({ type: z.literal('install') }), z.object({ type: z.literal('cancelInstall') }), z.object({ type: z.literal('chooseFolder') }), z.object({ type: z.literal('start') }), z.object({ type: z.literal('stop') }), z.object({ type: z.literal('recipe'), id: z.string(), productId: z.string() })]).parse(input);
    if (action.type === 'install') {
      if (app.env.SIGNAL_OFFLINE === '1') throw new Error('Offline test mode: creative installation is disabled.');
      if (process.platform !== 'win32') throw new Error('Owned creative setup currently supports Windows.');
      if (busy()) throw new Error('Stop the engine and finish pending renders before changing its installation.');
      installer.begin(source(), root => {
        if (busy()) throw new Error('The engine is installed. Finish current creative work, then choose Use Signal engine.');
        app.db.transaction(() => {
          if (app.video) app.video.configure({ ...app.video.config(), comfyUrl: SIGNAL_COMFY_URL });
          saveFolder(root); saveMarketingSettings(app, { ...marketingSettings(app), comfyUrl: SIGNAL_COMFY_URL });
        });
        manuallyStopped = false; error = '';
      });
    }
    if (action.type === 'cancelInstall') await installer.stop();
    if (action.type === 'chooseFolder') {
      if (busy() || setupBusy()) throw new Error('Finish creative setup and stop the engine before changing installations.');
      const result = await dialog.showOpenDialog({ title: 'Select ComfyUI_windows_portable folder', properties: ['openDirectory'] });
      if (!result.canceled && result.filePaths[0]) {
        const value = result.filePaths[0];
        if (!existsSync(join(value, 'ComfyUI', 'main.py')) || !existsSync(join(value, 'python_embeded', 'python.exe'))) throw new Error('Choose the portable root containing ComfyUI/main.py and python_embeded/python.exe. Other installations can run externally using the configured URL.');
        saveFolder(value);
      }
    }
    if (action.type === 'start') { manuallyStopped = false; await start(); }
    if (action.type === 'stop') {
      if (app.video?.agentBusy()) throw new Error('Wait for the active video job before stopping ComfyUI.');
      if (app.db.select().from(marketingMedia).where(inArray(marketingMedia.status, ['submitting', 'queued', 'running'])).get()) throw new Error('Finish or cancel pending media before stopping ComfyUI.');
      manuallyStopped = true; await stopChild();
    }
    if (action.type === 'recipe') {
      const recipe = MEDIA_RECIPES.find(r => r.id === action.id); if (!recipe) throw new Error('Unknown media recipe');
      const readiness = inspectRecipe(action.id, await info());
      if (readiness.missing.length) throw new Error(`Install the missing nodes/models first: ${readiness.missing.join(', ')}`);
      await marketingAction(app, { type: 'workflow', productId: action.productId, name: recipe.name, workflow: readiness.workflow });
    }
    return view();
  });
  ipc.handle(IPC.creativePreview, async (event, id: unknown, index: unknown) => {
    trustedSignalFrame(event);
    const job = app.db.select().from(marketingMedia).where(and(eq(marketingMedia.id, z.string().parse(id)), eq(marketingMedia.status, 'done'))).get();
    const output = job?.outputs[z.number().int().min(0).max(100).parse(index)]; if (!job || !output) throw new Error('Media is not ready');
    const ext = output.filename.split('.').pop()?.toLowerCase() ?? '';
    const mime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', wav: 'audio/wav', mp3: 'audio/mpeg' };
    if (!mime[ext]) throw new Error('Use Save & open for this output type.');
    const base = localUrl.parse(job.baseUrl); const url = new URL(`${base.replace(/\/$/, '')}/view`);
    for (const key of ['filename', 'subfolder', 'type'] as const) url.searchParams.set(key, output[key]);
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok || !response.body) throw new Error('Cannot read ComfyUI output');
    const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 40 * 1024 * 1024) throw new Error('Preview limit is 40 MB. Use Save & open for larger media.'); chunks.push(chunk.value); } }
    finally { await reader.cancel(); }
    return { dataUrl: `data:${mime[ext]};base64,${Buffer.concat(chunks).toString('base64')}`, mime: mime[ext]!, filename: output.filename };
  });
  return { stop: async () => {
    manuallyStopped = true; await installer.stop();
    if (child) {
      const base = marketingSettings(app).comfyUrl; await stopChild(); app.video?.runtimeStopped(base);
      app.db.update(marketingMedia).set({ status: 'failed', error: 'Rendering stopped when Signal exited. Generate again to retry.' }).where(and(eq(marketingMedia.baseUrl, base), inArray(marketingMedia.status, ['submitting', 'queued', 'running']))).run();
    }
  } };
}
