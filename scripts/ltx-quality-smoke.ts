// Local LTX diagnostic runtime. Fresh Windows job per stage, native tensor
// checkpoints, existing resource reserves, no production queue or paid calls.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { LTX_RUNTIME_ARGS, type VideoGraph } from '../src/core/video/ltx.js';
import { ltxDecodeStage, ltxSamplingStage } from '../src/core/video/ltx-quality.js';

const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = join(process.env.APPDATA!, 'signal/runtime/creative/comfy-owned-v1');
const models = join(process.env.LOCALAPPDATA!, 'Signal/runtime/ltx25-models');
const folder = resolve('data/ltx-quality-validation', String(Date.now()));
const input = join(folder, 'input'); mkdirSync(input, { recursive: true });
const yaml = join(folder, 'models.yaml');
writeFileSync(yaml, `signal_ltx:\n  base_path: ${JSON.stringify(models.replaceAll('\\', '/'))}\n  diffusion_models: diffusion_models\n  text_encoders: text_encoders\n  vae: vae\n  latent_upscale_models: latent_upscale_models\n`);
const base = 'http://127.0.0.1:8198';
type Artifact = { filename: string; subfolder: string; type: string };
type StageResult = { file: string; sha256: string; durationMs: number; stage: string };
const results: StageResult[] = [];
async function digest(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function request(route: string, body?: unknown) {
  const response = await fetch(base + route, { signal: AbortSignal.timeout(10000), ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(`Local renderer ${response.status}: ${(await response.text()).slice(0, 1200)}`);
  return response.json();
}
function artifactPath(output: string, artifact: Artifact, extension: string) {
  if (artifact.type !== 'output' || basename(artifact.filename) !== artifact.filename || !artifact.filename.endsWith(extension)) throw new Error('Unexpected output artifact.');
  const file = resolve(output, artifact.subfolder, artifact.filename), inside = relative(output, file);
  if (isAbsolute(inside) || inside === '..' || inside.startsWith('..\\') || inside.startsWith('../')) throw new Error('Artifact escaped diagnostic output.');
  if (!existsSync(file) || statSync(file).size > 512 * 1024 ** 2) throw new Error('Missing or oversized artifact.');
  return file;
}

async function runStage(stage: string, graph: VideoGraph, sampling: boolean): Promise<StageResult> {
  const stageRoot = join(folder, stage), output = join(stageRoot, 'output'); mkdirSync(output, { recursive: true });
  const profile = join(stageRoot, 'profile'); mkdirSync(profile);
  const status = join(stageRoot, 'limits.json');
  writeFileSync(join(stageRoot, 'workflow-api.json'), JSON.stringify(graph, null, 2));
  let occupied = false;
  try { await fetch(base + '/system_stats', { signal: AbortSignal.timeout(1000) }); occupied = true; } catch { /* no local server */ }
  if (occupied) throw new Error('Diagnostic port is occupied. Existing process was left alone.');
  const logs = createWriteStream(join(stageRoot, 'renderer.log'));
  const child = spawn(join(root, 'python_embeded/python.exe'), ['-s', resolve('src/core/video/limited_runtime.py'), '--status', status, '--dynamic-vram', '--ram-gb', sampling ? '16' : '8', '--working-set-gb', sampling ? '4' : '2', '--', resolve('src/core/video/ltx_runtime.py'), join(root, 'ComfyUI/main.py'), '--windows-standalone-build', '--disable-auto-launch', '--disable-all-custom-nodes', '--disable-api-nodes', '--listen', '127.0.0.1', '--port', '8198', ...LTX_RUNTIME_ARGS, '--input-directory', input, '--output-directory', output, '--user-directory', profile, '--database-url', 'sqlite:///' + join(profile, 'comfy.db').replaceAll('\\', '/'), '--extra-model-paths-config', yaml], { cwd: root, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HF_HUB_OFFLINE: '1', OMP_NUM_THREADS: '2', MKL_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '2' } });
  child.stdout.pipe(logs, { end: false }); child.stderr.pipe(logs, { end: false });
  let spawnError: Error | undefined;
  child.on('error', error => { spawnError = error; });
  const exited = new Promise<void>(resolveExit => { child.once('exit', () => resolveExit()); child.once('error', () => resolveExit()); });
  const alive = () => !spawnError && child.exitCode === null && child.signalCode === null;
  const state = () => existsSync(status) ? JSON.parse(readFileSync(status, 'utf8')) : {};
  let completed: StageResult | undefined;
  try {
    console.log(JSON.stringify({ stage, phase: 'starting', folder: stageRoot }));
    const deadline = Date.now() + 180000;
    let ready = false;
    while (alive() && Date.now() < deadline) {
      try { await request('/system_stats'); ready = true; break; } catch { await delay(1500); }
    }
    const limits = state();
    if (!ready) throw new Error(limits.reason ?? spawnError?.message ?? 'Renderer failed to start.');
    if (!limits.enforced || limits.state !== 'running' || limits.supervisorPid !== child.pid) throw new Error('Resource supervision was not confirmed.');
    const started = Date.now();
    const remote = await request('/prompt', { prompt: graph, client_id: 'signal-ltx-quality' }) as { prompt_id?: string };
    if (!remote.prompt_id) throw new Error('Renderer did not return a prompt ID.');
    writeFileSync(join(stageRoot, 'remote.json'), JSON.stringify(remote));
    console.log(JSON.stringify({ stage, phase: 'rendering', promptId: remote.prompt_id }));
    while (alive() && Date.now() - started < 20 * 60000) {
      const history = await request('/history/' + encodeURIComponent(remote.prompt_id));
      const entry = history[remote.prompt_id];
      if (entry?.status?.status_str === 'error') { writeFileSync(join(stageRoot, 'history.json'), JSON.stringify(entry, null, 2)); throw new Error('Generation failed; see stage history and renderer log.'); }
      if (entry?.status?.completed) {
        const artifact = sampling ? entry.outputs?.['32']?.latents?.[0] : entry.outputs?.['17']?.images?.[0];
        if (!artifact) throw new Error('Completed job has no expected artifact.');
        const file = artifactPath(output, artifact, sampling ? '.latent' : '.mp4');
        const result = { stage, file, sha256: await digest(file), durationMs: Date.now() - started };
        writeFileSync(join(stageRoot, 'result.json'), JSON.stringify({ ...result, qualityApproved: false }, null, 2));
        completed = result;
        break;
      }
      await delay(2000);
    }
    if (!completed) throw new Error(state().reason ?? 'Renderer exited or timed out before producing an artifact.');
  } finally {
    if (alive()) child.kill();
    await Promise.race([exited, delay(10000)]);
    logs.end();
  }
  if (alive()) throw new Error('Diagnostic supervisor did not exit; no subsequent stage will start.');
  return completed;
}

try {
  if (!existsSync(join(models, 'signal-model-receipt.json'))) throw new Error('Verified LTX models are required.');
  const resume = option('resume');
  let latent: StageResult;
  if (resume) {
    latent = JSON.parse(readFileSync(resolve(resume, 'sample/result.json'), 'utf8'));
    if (latent.stage !== 'sample' || !latent.file.endsWith('.latent') || await digest(latent.file) !== latent.sha256) throw new Error('Saved latent integrity check failed.');
  } else {
    const sourcePath = resolve(option('source') ?? 'data/ltx-preview-validation/1790873870884/workflow-api.json');
    const source = JSON.parse(readFileSync(sourcePath, 'utf8')) as VideoGraph;
    const reference = source['5']?.inputs.image;
    if (typeof reference !== 'string' || !/^signal-video-[a-f0-9]{64}\.jpg$/.test(reference)) throw new Error('Expected the retained hash-named reference.');
    const image = join(process.env.APPDATA!, 'signal/video-assets', reference.slice('signal-video-'.length));
    if (await digest(image) !== reference.slice('signal-video-'.length, -4)) throw new Error('Reference integrity check failed.');
    copyFileSync(image, join(input, reference));
    writeFileSync(join(folder, 'comparison.json'), JSON.stringify({ sourcePath, sourceSha256: await digest(sourcePath), portrait: process.argv.includes('--portrait'), qualityTarget: 'Seedance 2.5 reference quality; unverified', productionEnabled: false }, null, 2));
    latent = await runStage('sample', ltxSamplingStage(source, process.argv.includes('--portrait')), true);
    results.push(latent);
  }
  const latentName = `samples-${latent.sha256}.latent`;
  copyFileSync(latent.file, join(input, latentName));
  for (const size of [16, 64, 96] as const) {
    if (await digest(join(input, latentName)) !== latent.sha256) throw new Error('Comparison latent changed.');
    results.push(await runStage(`decode-${size}`, ltxDecodeStage(latentName, size), false));
  }
  writeFileSync(join(folder, 'result.json'), JSON.stringify({ completed: true, qualityApproved: false, latentSha256: latent.sha256, results }, null, 2));
  console.log(JSON.stringify({ phase: 'comparison-ready', folder, qualityApproved: false }));
} catch (error) {
  writeFileSync(join(folder, 'result.json'), JSON.stringify({ completed: false, qualityApproved: false, error: error instanceof Error ? error.message : String(error), results }, null, 2));
  throw error;
}
