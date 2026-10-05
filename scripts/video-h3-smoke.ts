import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DesktopVideoHost } from '../electron/main/video-host.js';
import { h3Workflow, LocalVideoRenderer } from '../src/core/video/comfy.js';
import { videoConfigSchema, videoFrames, type VideoJob } from '../src/shared/video.js';

// Isolated local render only. No owner DB, cloud keys, publication or sales actions.
const option = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const folder = resolve(option('--output-dir') ?? 'data/video-h3-capped-validation'); mkdirSync(folder, { recursive: true });
const limitStatus = option('--limit-status');
function checkLimits() {
  if (!limitStatus) throw new Error('Use --limit-status from Signal\'s capped renderer. Uncapped H3 validation is disabled.');
  const status = JSON.parse(readFileSync(resolve(limitStatus), 'utf8')) as { state: string; enforced: boolean; ramLimitBytes: number; gpuLimitBytes: number; updatedAt: number; supervisorPid: number; pid: number };
  if (status.state !== 'running' || !status.enforced || !(status.ramLimitBytes > 0 && status.ramLimitBytes <= 16 * 1024 ** 3) || !(status.gpuLimitBytes > 0 && status.gpuLimitBytes <= 5 * 1024 ** 3) || Date.now() - status.updatedAt > 10000) throw new Error('The capped renderer is not currently verified and running.');
  for (const pid of [status.supervisorPid, status.pid]) { if (!Number.isInteger(pid) || pid < 1) throw new Error('Missing capped process identity.'); process.kill(pid, 0); }
}
mkdirSync(join(folder, 'electron-profile'), { recursive: true });
app.setPath('userData', join(folder, 'electron-profile')); app.disableHardwareAcceleration();
void app.whenReady().then(async () => {
  const previous = JSON.parse(readFileSync(resolve('data/video-blockout-validation/result.json'), 'utf8'));
  const config = videoConfigSchema.parse({ ...previous.config, comfyUrl: process.argv[2] ?? 'http://127.0.0.1:8199' });
  const host = new DesktopVideoHost(folder, resolve('src/core/video/blockout.py'));
  const local = new LocalVideoRenderer();
  checkLimits();
  if (process.argv.includes('--wait-models')) {
    const waiting = AbortSignal.timeout(60 * 60000);
    let prior = '';
    while (true) {
      waiting.throwIfAborted(); checkLimits();
      const readiness = await local.check(config, waiting);
      if (readiness.ready) break;
      const current = readiness.missing.join('; ');
      if (current !== prior) { console.log(JSON.stringify({ waitingFor: readiness.missing })); prior = current; }
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
  }
  const signal = AbortSignal.timeout(40 * 60000);
  const statePath = join(folder, 'job.json');
  let job: VideoJob;
  if (existsSync(statePath)) {
    job = JSON.parse(readFileSync(statePath, 'utf8')) as VideoJob;
    if (job.submittedAt && !job.remote) throw new Error('Submission outcome unknown. Inspect ComfyUI before starting a replacement.');
  } else {
    const readiness = await local.check(config, signal);
    if (!readiness.ready) throw new Error(readiness.missing.join('; '));
    const reference = host.importImage(resolve('data/video-research/cast.png'));
    const blockout = host.saveVideo(readFileSync(resolve('data/video-blockout-validation', previous.output.file)));
    const spec = JSON.parse(readFileSync(resolve('data/video-blockout-validation/jobs/blockout-check/shot.json'), 'utf8'));
    job = { id: 'h3-check-' + Date.now(), productId: 'fixture', kind: 'shot', title: 'Cross the office', brief: 'A fictional small-business owner walks across a modest office toward a desk. Preserve the approved blue jacket and identity throughout.', characters: [{ id: 'actor-one', productId: 'fixture', name: 'Test character', description: 'Fictional adult with curly brown hair, a cobalt blue jacket, off-white shirt, charcoal trousers and white shoes.', reference, approvedAt: Date.now(), createdAt: Date.now() }], renderer: 'local', localProfile: 'mick4', localCheckpoint: 'w4a8', sparseAttention: false, duration: 5, ratio: '16:9', phase: 'queued', detail: '', createdAt: Date.now(), updatedAt: Date.now(), shot: spec.shot, blockout };
    writeFileSync(statePath, JSON.stringify(job, null, 2));
  }
  if (!job.remote) {
    checkLimits();
    await local.free(config.comfyUrl, signal);
    const reference = job.characters[0]!.reference!;
    const image = await local.upload(config.comfyUrl, host.data(reference), 'signal-video-' + reference.file, signal);
    const guide = await local.upload(config.comfyUrl, host.data(job.blockout!), 'signal-video-' + job.blockout!.file, signal);
    const graph = h3Workflow(job, [image], guide);
    writeFileSync(join(folder, 'workflow.json'), JSON.stringify(graph, null, 2));
    job.submittedAt = Date.now(); writeFileSync(statePath, JSON.stringify(job, null, 2));
    job.remote = await local.submit(config.comfyUrl, job, graph, signal);
    job.phase = 'remote'; writeFileSync(statePath, JSON.stringify(job, null, 2));
    console.log(JSON.stringify({ submitted: job.remote.id, profile: job.localProfile, frames: videoFrames(job) }));
  }
  if (!job.output) {
    while (true) {
      signal.throwIfAborted(); checkLimits();
      const result = await local.poll(job.remote, signal);
      if (result.state === 'failed') throw new Error('H3 render failed. Inspect ComfyUI execution history and logs.');
      if (result.state === 'done') { job.output = host.saveVideo(result.bytes); break; }
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    job.updatedAt = Date.now(); writeFileSync(statePath, JSON.stringify(job, null, 2));
  }
  await local.free(job.remote.statusUrl!, signal);
  const frames = await host.frames(job.output, config, signal, videoFrames(job) / 24);
  frames.forEach((data, index) => writeFileSync(join(folder, `sample-${index + 1}.jpg`), Buffer.from(data.split(',')[1]!, 'base64')));
  const result = { rendered: true, video: host.assetPath(job.output), frames: frames.length, seconds: (job.updatedAt - job.submittedAt!) / 1000, visualReview: 'pending', fullPlaybackReview: 'pending' };
  writeFileSync(join(folder, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); app.exit(0);
}).catch(error => { console.error(String(error)); app.exit(1); });
