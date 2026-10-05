import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ltxWorkflow, LTX_LIMIT_ARGS, LTX_RUNTIME_ARGS } from '../src/core/video/ltx.js';
import { LocalVideoRenderer } from '../src/core/video/comfy.js';
import { videoConfigSchema, type VideoCharacter, type VideoJob } from '../src/shared/video.js';

// Separate from the owner's campaign queue. No model download or cloud request.
const variant = process.argv.find(arg => arg.startsWith('--variant='))?.slice('--variant='.length) ?? 'baseline';
if (!['baseline', 'portrait', 'temporal'].includes(variant)) throw new Error('Use --variant=baseline, portrait, or temporal.');
// Change one quality variable per comparison, keeping the seed and motion brief.
// Portrait matches this reference's actual 3:4 aspect, without a face crop.
const dimensions = variant === 'portrait' ? { width: 384, height: 512 } : { width: 512, height: 256 };
const folder = resolve('data/ltx-preview-validation', String(Date.now())); mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, 'comparison.json'), JSON.stringify({ variant, dimensions, comparedWith: '1790873870884', seed: 42, qualityApproved: false }, null, 2));
const root = join(process.env.APPDATA!, 'signal/runtime/creative/comfy-owned-v1');
const models = join(process.env.LOCALAPPDATA!, 'Signal/runtime/ltx25-models');
if (!existsSync(join(models, 'signal-model-receipt.json'))) throw new Error('Finish model download and hash verification first.');
const db = new DatabaseSync(join(process.env.APPDATA!, 'signal/signal.db'), { readOnly: true });
const row = db.prepare("SELECT value FROM settings WHERE key = 'video.character.starter-lemonade-maya'").get() as { value: string } | undefined;
db.close(); if (!row) throw new Error('Missing retained fictional Maya reference.');
const character = JSON.parse(row.value) as VideoCharacter;
const bytes = readFileSync(join(process.env.APPDATA!, 'signal/video-assets', character.reference!.file));
if (createHash('sha256').update(bytes).digest('hex') !== character.reference!.sha256) throw new Error('Reference changed.');
const yaml = join(folder, 'models.yaml');
writeFileSync(yaml, `signal_ltx:\n  base_path: ${JSON.stringify(models.replaceAll('\\', '/'))}\n  diffusion_models: diffusion_models\n  text_encoders: text_encoders\n  vae: vae\n  latent_upscale_models: latent_upscale_models\n`);
const profile = join(folder, 'profile'); mkdirSync(profile, { recursive: true });
const status = join(folder, 'limits.json'), base = 'http://127.0.0.1:8198';
try { await fetch(base + '/system_stats', { signal: AbortSignal.timeout(1000) }); throw new Error('Preview port is already occupied.'); } catch (error) { if (error instanceof Error && error.message.includes('occupied')) throw error; }
const logs = createWriteStream(join(folder, 'renderer.log'));
const child = spawn(join(root, 'python_embeded/python.exe'), ['-s', resolve('src/core/video/limited_runtime.py'), '--status', status, ...LTX_LIMIT_ARGS, '--', resolve('src/core/video/ltx_runtime.py'), join(root, 'ComfyUI/main.py'), '--windows-standalone-build', '--disable-auto-launch', '--disable-all-custom-nodes', '--disable-api-nodes', '--listen', '127.0.0.1', '--port', '8198', ...LTX_RUNTIME_ARGS, '--output-directory', join(folder, 'output'), '--user-directory', profile, '--database-url', 'sqlite:///' + join(profile, 'comfy.db').replaceAll('\\', '/'), '--extra-model-paths-config', yaml], { cwd: root, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HF_HUB_OFFLINE: '1', OMP_NUM_THREADS: '2', MKL_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '2' } });
child.stdout.pipe(logs); child.stderr.pipe(logs);
let exited = false; child.on('exit', () => { exited = true; });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const signal = AbortSignal.timeout(20 * 60000);
const local = new LocalVideoRenderer();
const config = videoConfigSchema.parse({ blenderPath: '', ffmpegPath: '', dailyCloudLimit: 0, localModel: 'ltx25', comfyUrl: base });
try {
  const deadline = Date.now() + 180000;
  let ready = false;
  while (Date.now() < deadline && !exited) { try { const r = await fetch(base + '/system_stats', { signal: AbortSignal.timeout(1500) }); if (r.ok) { ready = true; break; } } catch { /* bounded startup */ } await sleep(1500); }
  if (!ready) throw new Error('Capped renderer did not become ready; inspect limits.json and renderer.log.');
  const check = await local.check(config, signal); writeFileSync(join(folder, 'readiness.json'), JSON.stringify(check, null, 2));
  if (!check.ready) throw new Error(check.detail + ' ' + check.missing.join(', '));
  const limits = JSON.parse(readFileSync(status, 'utf8'));
  if (!limits.enforced || limits.state !== 'running' || limits.supervisorPid !== child.pid) throw new Error('Memory limits are not confirmed.');
  const job: VideoJob = { id: 'ltx-preview-3s', productId: character.productId, kind: 'shot', renderer: 'local', localModel: 'ltx25', title: 'Maya LTX preview', brief: 'The same fictional person gently shifts her gaze, then looks toward the camera. Preserve the starting frame.', characters: [character], duration: 3, ratio: '16:9', phase: 'queued', detail: 'Isolated capped validation', createdAt: Date.now(), updatedAt: Date.now(), shot: { description: 'The same woman in the supplied photograph gently turns her eyes toward the camera, with a restrained natural smile.', openingAction: 'Already breathing naturally, shoulders shift subtly.', geometry: 'Preserve the starting reference composition, person and background.', lensMm: 50, lighting: 'Keep the soft natural light in the reference image.', acting: 'Small eye movement, quiet smile, relaxed shoulders, no speech.', beats: [{ start: 0, end: 1, action: 'The woman shifts her gaze slightly to screen-right.' }, { start: 1, end: 3, action: 'Her gaze returns toward camera and a subtle smile appears.' }], environment: 'studio', cameraStart: [0, -5, 2], cameraEnd: [0, -5, 2], lookAt: [0, 0, 1], actors: [{ characterId: character.id, start: [0, 0, 0], end: [0, 0, 0] }] } };
  const name = await local.upload(base, 'data:image/jpeg;base64,' + bytes.toString('base64'), 'signal-video-' + character.reference!.file, signal);
  const graph = ltxWorkflow(job, name);
  graph['6']!.inputs.width = dimensions.width; graph['6']!.inputs.height = dimensions.height;
  graph['11']!.inputs.width = dimensions.width / 2; graph['11']!.inputs.height = dimensions.height / 2;
  // Restore the original baseline exactly for the decoder-only comparison.
  if (variant !== 'portrait') { graph['6']!.inputs.height = 288; graph['11']!.inputs.height = 144; }
  if (variant === 'temporal') { graph['29']!.inputs.temporal_size = 64; graph['29']!.inputs.temporal_overlap = 16; }
  graph['31'] = { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: 'Signal/reference-conditioning' } };
  writeFileSync(join(folder, 'workflow-api.json'), JSON.stringify(graph, null, 2));
  const started = Date.now(), remote = await local.submit(base, job, graph, signal); writeFileSync(join(folder, 'remote.json'), JSON.stringify(remote));
  console.log(JSON.stringify({ phase: 'rendering', variant, promptId: remote.id, seconds: 3, memoryCaps: { commitGiB: 16, workingSetGiB: 4, freeGpuTargetGiB: 3, freeGpuStopGiB: 1 } }));
  while (!signal.aborted && !exited) {
    const result = await local.poll(remote, signal);
    if (result.state === 'failed') throw new Error('Preview generation failed; see renderer.log.');
    if (result.state === 'done') { writeFileSync(join(folder, 'preview.mp4'), result.bytes); writeFileSync(join(folder, 'result.json'), JSON.stringify({ generated: true, durationMs: Date.now() - started, bytes: result.bytes.length, audio: false, playbackVerified: false }, null, 2)); console.log('Preview saved. Picture, motion and file checks remain.'); break; }
    await sleep(3000);
  }
  if (!existsSync(join(folder, 'preview.mp4'))) throw new Error('Capped preview stopped without a completed video.');
} catch (error) {
  // Give the watchdog time to record a native worker exit before stopping it.
  if (!exited) await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(2000)]);
  writeFileSync(join(folder, 'result.json'), JSON.stringify({ generated: false, error: error instanceof Error ? error.message : String(error), supervisorExited: exited }, null, 2));
  throw error;
} finally {
  if (!exited) { const exit = new Promise(resolve => child.once('exit', resolve)); child.kill(); await Promise.race([exit, sleep(10000)]); }
  logs.end();
}


