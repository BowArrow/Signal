import { spawn } from 'node:child_process';
import { open, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let child, log, failure;
const root = () => join(process.env.LOCALAPPDATA || '', 'Signal/runtime');
export const limitsFile = () => process.env.DEMO_STUDIO_LTX_LIMITS || join(root(), 'ltx25-limits.json');
export async function previewFingerprint() {
  const hash=createHash('sha256');
  for(const file of ['src/core/video/ltx.ts','src/core/video/ltx_runtime.py','src/core/video/ltx_upscaler.py','src/core/video/ltx_audio_compat.py','src/core/video/limited_runtime.py']) hash.update(await readFile(join(workspace,file)));
  return hash.digest('hex');
}
const running = () => !!child && child.exitCode === null && child.signalCode === null;
export function runtimeState() { return { owned: running(), error: failure || null }; }

export async function startLtxRuntime({workingSetGiB,conservativePreview=false} = {}) {
  if (process.platform !== 'win32') throw new Error('The managed LTX runtime currently requires Windows.');
  if (running()) return { status: 'starting', detail: 'Check local LTX for readiness.' };
  if (process.env.DEMO_STUDIO_LTX_URL || process.env.DEMO_STUDIO_LTX_LIMITS) throw new Error('An external LTX runtime is configured. Start it with its own supervisor.');
  try {
    await fetch('http://127.0.0.1:8198/system_stats', { signal: AbortSignal.timeout(1000) });
    throw new Error('Port 8198 is occupied. This studio will not replace another renderer.');
  } catch (error) { if (error.message.includes('occupied')) throw error; }
  const install = join(process.env.APPDATA || '', 'signal/runtime/creative/comfy-owned-v1');
  const models = join(root(), 'ltx25-models');
  const receipt = JSON.parse(await readFile(join(models, 'signal-model-receipt.json'), 'utf8'));
  if (!Array.isArray(receipt) || receipt.length !== 5) throw new Error('The LTX model installation receipt is incomplete.');
  for (const model of receipt) {
    const path = resolve(models, model.file || model.path || '');
    if (!path.startsWith(resolve(models) + '\\') || (await stat(path)).size !== model.bytes) throw new Error('LTX model files are missing or have changed. Run the model setup first.');
  }
  const folder = join(root(), 'demo-studio-ltx');
  await mkdir(join(folder, 'profile'), { recursive: true });
  const yaml = join(folder, 'models.yaml');
  await writeFile(yaml, `signal_ltx:\n  base_path: ${JSON.stringify(models.replaceAll('\\', '/'))}\n  diffusion_models: diffusion_models\n  text_encoders: text_encoders\n  vae: vae\n  latent_upscale_models: latent_upscale_models\n`);
  // Import the same arguments as Signal; never loosen the watchdog for the studio.
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const config = JSON.parse((await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "import {LTX_LIMIT_ARGS,LTX_RUNTIME_ARGS} from './src/core/video/ltx.ts'; console.log(JSON.stringify({limits:LTX_LIMIT_ARGS,runtime:LTX_RUNTIME_ARGS}))"], { cwd: workspace, windowsHide: true, timeout: 30000 })).stdout);
  if(workingSetGiB!==undefined){
    const index=config.limits.indexOf('--working-set-gb');
    if(index<0||!Number.isFinite(workingSetGiB)||workingSetGiB<1||workingSetGiB>Number(config.limits[index+1]))throw new Error('Production paging may only reduce the default resident memory allowance.');
    config.limits[index+1]=String(workingSetGiB);
  }
  if(conservativePreview) {
    config.limits[config.limits.indexOf('--ram-gb')+1]='12';
    config.limits.push('--reserve-ram-gb','8','--reserve-commit-gb','10','--device-vram-gb','7');
  }
  log = await open(join(folder, 'renderer.log'), 'a');
  failure = null;
  child = spawn(join(install, 'python_embeded/python.exe'), ['-s', join(workspace, 'src/core/video/limited_runtime.py'), '--status', limitsFile(), '--owner-pid', String(process.pid), ...config.limits, '--', join(workspace, 'src/core/video/ltx_runtime.py'), join(install, 'ComfyUI/main.py'), '--windows-standalone-build', '--disable-auto-launch', '--disable-all-custom-nodes', '--disable-api-nodes', '--listen', '127.0.0.1', '--port', '8198', ...config.runtime, '--output-directory', join(folder, 'output'), '--user-directory', join(folder, 'profile'), '--database-url', 'sqlite:///' + join(folder, 'profile/comfy.db').replaceAll('\\', '/'), '--extra-model-paths-config', yaml], { cwd: install, windowsHide: true, shell: false, stdio: ['ignore', log.fd, log.fd], env: { ...process.env, HF_HUB_OFFLINE: '1', OMP_NUM_THREADS: '2', MKL_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '2' } });
  const handle = log;
  child.once('error', error => { failure = error.message; });
  child.once('close', code => { if (code) failure = `LTX stopped (exit ${code}). Check its memory status and renderer log.`; handle.close().catch(() => {}); });
  return { status: 'starting', supervisorPid: child.pid, detail: 'LTX is starting locally. Check local LTX in a moment.', logPath: join(folder, 'renderer.log') };
}

export async function stopLtxRuntime({ shutdown = false } = {}) {
  if (!running()) return { status: 'stopped', detail: 'No renderer owned by this studio is running.' };
  if (!shutdown) {
    try {
      const response = await fetch('http://127.0.0.1:8198/queue', { signal: AbortSignal.timeout(2000) });
      if (response.ok) { const queue = await response.json(); if (queue.queue_running?.length || queue.queue_pending?.length) throw new Error('Wait for the current render to finish before stopping LTX.'); }
    } catch (error) { if (error.message.includes('current render')) throw error; }
  }
  const owned = child;
  await new Promise(resolve => { const timer = setTimeout(resolve, 10000); owned.once('close', () => { clearTimeout(timer); resolve(); }); owned.kill(); });
  if (owned.exitCode === null && owned.signalCode === null) throw new Error('The renderer has not finished stopping.');
  return { status: 'stopped' };
}
