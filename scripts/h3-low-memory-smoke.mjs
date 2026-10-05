/* global fetch, setTimeout, AbortSignal, FormData, Blob */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Separate diagnostic profile; no owner jobs, no browser, no uncapped fallback.
const crashHold = join(process.env.LOCALAPPDATA, 'Signal/runtime/h3-diagnostic-hold.json');
if (existsSync(crashHold)) throw new Error(`H3 diagnostics are paused after an unexpected Windows restart. Investigate before deliberately clearing ${crashHold}.`);
const folder = resolve(process.argv[2] ?? 'data/video-h3-low-memory-validation');
const stageIndex = process.argv.indexOf('--stage'); const stage = stageIndex < 0 ? 'all' : process.argv[stageIndex + 1];
if (!['all', 'prepare', 'sample', 'decode'].includes(stage)) throw new Error('Invalid H3 stage.');
const checkpointIndex = process.argv.indexOf('--checkpoints'); const checkpoints = checkpointIndex < 0 ? folder : resolve(process.argv[checkpointIndex + 1]);
mkdirSync(folder, { recursive: true });
const portable = join(process.env.LOCALAPPDATA, 'ai.dndrom.desktop/runtime/comfy-0.34.0/ComfyUI_windows_portable');
const models = join(process.env.LOCALAPPDATA, 'Signal/runtime/h3-models');
const custom = join(process.env.LOCALAPPDATA, 'Signal/runtime/h3-custom-nodes');
const reuseEncoder = process.argv.includes('--existing-encoder');
const manifest = JSON.parse(readFileSync(join(models, 'manifest-low-memory.json'), 'utf8'));
if (!manifest.some(m => m.filename === 'minimax_h3_video_vae_int8_convrot.safetensors') || (!reuseEncoder && manifest.length !== 3)) throw new Error('Complete and verify the low-memory model download first.');
if (reuseEncoder && (!existsSync(join(models, 'manifest-small-projection.json')) || !existsSync(join(portable, 'ComfyUI/models/text_encoders/qwen3vl_4b_fp8_scaled.safetensors')))) throw new Error('The existing 4B encoder and verified small projection are required.');
if (existsSync(join(folder, 'job.json'))) throw new Error('This diagnostic already has a job. Inspect its outcome before using a fresh diagnostic folder.');
const profile = join(folder, 'profile'); mkdirSync(profile, { recursive: true });
const modelPaths = join(folder, 'models.yaml');
writeFileSync(modelPaths, `signal_h3:\n  base_path: ${JSON.stringify(models.replaceAll('\\', '/'))}\n  diffusion_models: diffusion_models\n  text_encoders: text_encoders\n  vae: vae\n  loras: loras\n  clip_projections: clip_projections\nsignal_nodes:\n  custom_nodes: ${JSON.stringify(custom.replaceAll('\\', '/'))}\n`);
appendFileSync(modelPaths, `signal_stages:\n  custom_nodes: ${JSON.stringify(resolve('src/core/video').replaceAll('\\', '/'))}\n`);
const status = join(folder, 'limits.json'), base = 'http://127.0.0.1:8212';
try { const r = await fetch(base + '/queue', { signal: AbortSignal.timeout(1000) }); if (r.ok) throw new Error('Diagnostic port is already occupied.'); } catch (error) { if (error.message === 'Diagnostic port is already occupied.') throw error; }
const child = spawn(join(portable, 'python_embeded/python.exe'), ['-s', resolve('src/core/video/limited_runtime.py'), '--status', status, '--', join(portable, 'ComfyUI/main.py'), '--windows-standalone-build', '--disable-auto-launch', '--listen', '127.0.0.1', '--port', '8212', '--disable-all-custom-nodes', '--whitelist-custom-nodes', 'ComfyUI-ClipProj', 'stage_nodes', '--disable-pinned-memory', '--disable-dynamic-vram', '--disable-cuda-malloc', '--disable-async-offload', '--lowvram', '--fp16-vae', '--fast-disk', '--cache-none', '--reserve-vram', '5', '--output-directory', join(folder, 'output'), '--user-directory', profile, '--database-url', 'sqlite:///' + join(profile, 'comfyui.db').replaceAll('\\', '/'), '--extra-model-paths-config', modelPaths], { cwd: portable, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SIGNAL_H3_STAGE_DIR: checkpoints, OMP_NUM_THREADS: '2', MKL_NUM_THREADS: '2' } });
const log = chunk => appendFileSync(join(folder, 'server.log'), chunk);
child.stdout.on('data', log); child.stderr.on('data', log);
let launchError; child.on('error', error => { launchError = error; });
const delay = ms => new Promise(r => setTimeout(r, ms));
function checked() {
  if (launchError || child.exitCode !== null || child.signalCode !== null) throw new Error('The capped renderer exited; inspect server.log and limits.json.');
  const limits = JSON.parse(readFileSync(status, 'utf8'));
  if (limits.state !== 'running' || !limits.enforced || limits.ramLimitBytes !== 16 * 1024 ** 3 || limits.gpuLimitBytes !== 5 * 1024 ** 3 || Date.now() - limits.updatedAt > 10000) throw new Error('Fresh enforced renderer limits are required.');
  process.kill(limits.pid, 0); process.kill(limits.supervisorPid, 0);
  appendFileSync(join(folder, 'resources.jsonl'), JSON.stringify(limits) + '\n'); return limits;
}
async function request(path, init) { const r = await fetch(base + path, { ...init, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(`ComfyUI HTTP ${r.status}: ${(await r.text()).slice(0, 1200)}`); return r.json(); }
try {
  let info;
  for (let i = 0; i < 90; i++) {
    if (launchError || child.exitCode !== null) throw new Error('Renderer startup failed.');
    try { info = await request('/object_info'); break; } catch { await delay(1000); }
  }
  if (!info?.ClipProjApply) throw new Error('ClipProj is unavailable in the isolated runtime.');
  checked(); const queue = await request('/queue'); if (queue.queue_running.length || queue.queue_pending.length) throw new Error('Diagnostic renderer is not idle.');
  const source = JSON.parse(readFileSync('data/video-h3-validation/job.json', 'utf8'));
  const graph = JSON.parse(readFileSync('data/video-h3-capped-validation/workflow.json', 'utf8'));
  const upload = async asset => {
    const bytes = readFileSync(resolve('data/video-h3-validation', asset.file));
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('Diagnostic reference checksum mismatch.');
    const name = 'signal-video-' + asset.file; const form = new FormData(); form.set('image', new Blob([bytes], { type: asset.mime }), name); form.set('type', 'input');
    const result = await request('/upload/image', { method: 'POST', body: form }); if (result.name !== name || result.subfolder) throw new Error('Unexpected reference upload.'); return name;
  };
  graph['6'].inputs.file = await upload(source.blockout);
  graph['30'].inputs.image = await upload(source.characters[0].reference);
  graph['2'].inputs = { clip_name: reuseEncoder ? 'qwen3vl_4b_fp8_scaled.safetensors' : 'qwen3vl_4b_int8_convrot.safetensors', type: 'krea2', device: 'default' };
  graph['21'] = { class_type: 'ClipProjApply', inputs: { clip: ['2', 0], projection: reuseEncoder ? 'mmh3-4b-ClipProj-v3.1.safetensors' : 'mmh3-4b-ClipProj-v3.1-mlp.safetensors' } };
  graph['8'].inputs.clip = ['21', 0]; graph['3'].inputs.vae_name = 'minimax_h3_video_vae_int8_convrot.safetensors';
  graph['8'].inputs.width = 608; graph['8'].inputs.height = 352; graph['8'].inputs.length = 56;
  graph['8'].inputs.prompt = '[video editing + reference generation]\n<Video 1> controls the camera, body motion and office layout. <Picture 1> controls the same fictional adult character, curly brown hair, cobalt blue jacket, off-white shirt and charcoal trousers. Natural daylight, photographic materials, stable face and wardrobe. One continuous shot at real-time speed. From 0 to 2.33 seconds the character walks purposefully toward the right-hand desk. Keep foot contact, weight and movement grounded. Quiet room ambience and footsteps.';
  const id = 'low-memory-' + Date.now(); graph['17'].inputs.filename_prefix = 'Signal/video/' + id;
  if (stage === 'prepare') {
    for (const key of Object.keys(graph)) if (!['2', '3', '4', '6', '7', '8', '21', '30'].includes(key)) delete graph[key];
    graph['99'] = { class_type: 'SignalH3SavePreparation', inputs: { positive: ['8', 0], latent: ['8', 1] } };
  } else if (stage === 'sample') {
    for (const key of Object.keys(graph)) if (!['1', '5', '9', '10', '11', '12', '13', '18'].includes(key)) delete graph[key];
    graph['99'] = { class_type: 'SignalH3LoadPreparation', inputs: {} };
    if (process.argv.includes('--disk-loader')) graph['1'] = { class_type: 'SignalH3DiskModelLoader', inputs: { unet_name: graph['1'].inputs.unet_name } };
    graph['10'].inputs.conditioning = ['99', 0]; graph['13'].inputs.latent_image = ['99', 1];
    graph['98'] = { class_type: 'SignalH3SaveSamples', inputs: { latent: ['13', 0] } };
  } else if (stage === 'decode') {
    for (const key of Object.keys(graph)) if (!['3', '4', '14', '15', '16', '17', '20'].includes(key)) delete graph[key];
    graph['99'] = { class_type: 'SignalH3LoadSamples', inputs: {} };
    graph['14'].inputs.samples = ['99', 0]; graph['15'].inputs.samples = ['99', 0];
  }
  writeFileSync(join(folder, 'workflow.json'), JSON.stringify(graph, null, 2)); checked();
  const job = { id, submittedAt: Date.now(), graph: 'workflow.json', state: 'submitting' }; writeFileSync(join(folder, 'job.json'), JSON.stringify(job, null, 2));
  const submitted = await request('/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: 'signal-h3-low-memory-check' }) });
  job.promptId = submitted.prompt_id; job.state = 'running'; writeFileSync(join(folder, 'job.json'), JSON.stringify(job, null, 2)); console.log(JSON.stringify(job));
  const deadline = Date.now() + 45 * 60000;
  while (Date.now() < deadline) {
    checked(); const history = await request('/history/' + job.promptId); const entry = history[job.promptId];
    if (entry) writeFileSync(join(folder, 'history.json'), JSON.stringify(entry, null, 2));
    if (entry?.status?.status_str === 'error') throw new Error('H3 returned an execution error; inspect history.json.');
    if (entry?.status?.completed) {
      const file = stage === 'prepare' || stage === 'sample' ? { checkpoint: join(checkpoints, stage === 'prepare' ? 'preparation.safetensors' : 'samples.safetensors') } : entry.outputs?.['17']?.images?.[0];
      if (file?.checkpoint ? !existsSync(file.checkpoint) : !file?.filename?.endsWith('.mp4')) throw new Error('No completed stage output.');
      job.state = 'completed'; job.output = file; writeFileSync(join(folder, 'job.json'), JSON.stringify(job, null, 2)); console.log(JSON.stringify(job)); break;
    }
    await delay(10000);
  }
  if (job.state !== 'completed') throw new Error('Diagnostic reached its 45-minute limit.');
} catch (error) {
  writeFileSync(join(folder, 'failure.txt'), String(error)); console.error(String(error)); process.exitCode = 1;
} finally { child.kill(); }
