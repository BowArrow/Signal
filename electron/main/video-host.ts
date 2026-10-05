import { nativeImage } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { publicAddress, publicOrigin } from '../../src/core/connections/network.js';
import type { VideoHost } from '../../src/core/video/service.js';
import { videoFrames } from '../../src/shared/video.js';
import { assembleVideo, probeClip, probeAudio, videoTool } from '../../src/core/video/assembly.js';
import { generateNarration, installNarration, narrationReady } from '../../src/core/video/narration.js';
import type { VideoAsset, VideoConfig, VideoJob } from '../../src/shared/video.js';

export class DesktopVideoHost implements VideoHost {
  localRenderHold(model: 'h3' | 'ltx25' = 'h3') {
    if (model === 'ltx25') return existsSync(join(process.env.LOCALAPPDATA ?? this.root, 'Signal', 'runtime', 'ltx25-diagnostic-hold.json'))
      ? 'LTX 2.5 local rendering is held for configuration validation. Check the latest diagnostic results before enabling automatic rendering. Keep the memory limits in place and pause other local AI workloads during render tests. Research, imported footage and ad editing remain available.' : undefined;
    return existsSync(join(process.env.LOCALAPPDATA ?? this.root, 'Signal', 'runtime', 'h3-diagnostic-hold.json'))
      ? 'Local H3 rendering is paused after an unexpected Windows restart. Resolve the runtime incident before rendering again. Imported footage, CPU ad editing and approved-video publishing remain available.' : undefined;
  }
  private voiceSetup: Promise<void> | undefined;
  private voiceRoot() { return join(process.env.LOCALAPPDATA ?? this.root, 'Signal', 'runtime', 'narration'); }
  narrationReady() { return narrationReady(this.voiceRoot()); }
  async installNarration(signal: AbortSignal) { this.voiceSetup ??= installNarration(this.voiceRoot(), signal).finally(() => { this.voiceSetup = undefined; }); await this.voiceSetup; }
  constructor(readonly root: string, private readonly script: string, private readonly startAgent?: () => Promise<void>) { mkdirSync(root, { recursive: true }); }
  async ensureAgent(signal: AbortSignal) { signal.throwIfAborted(); await this.startAgent?.(); signal.throwIfAborted(); }
  toolReady(path: string, tool: 'blender' | 'ffmpeg') { return Boolean(path && ['' + tool, tool + '.exe'].includes(basename(path).toLowerCase()) && existsSync(path) && statSync(path).isFile()); }
  private file(asset: VideoAsset) {
    if (!/^[a-f0-9]{64}\.(jpg|mp4|wav)$/.test(asset.file)) throw new Error('Invalid saved video asset.');
    return join(this.root, asset.file);
  }
  bytes(asset: VideoAsset) {
    const bytes = readFileSync(this.file(asset));
    if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('Saved creative asset changed. Import it again.');
    return bytes;
  }
  data(asset: VideoAsset) { return `data:${asset.mime};base64,${this.bytes(asset).toString('base64')}`; }
  private persist(bytes: Buffer, image: boolean): VideoAsset {
    if (image) {
      const decoded = nativeImage.createFromBuffer(bytes); const size = decoded.getSize();
      if (decoded.isEmpty() || size.width < 256 || size.height < 256 || size.width > 12000 || size.height > 12000 || size.width / size.height < 0.4 || size.width / size.height > 2.5) throw new Error('Use a clear character image at least 256 pixels wide and tall.');
      bytes = decoded.resize(size.width >= size.height ? { width: Math.min(1200, size.width) } : { height: Math.min(1200, size.height) }).toJPEG(90);
    } else if (bytes.length < 100 || bytes.subarray(4, 8).toString() !== 'ftyp') throw new Error('Provider did not return an MP4 video.');
    const sha256 = createHash('sha256').update(bytes).digest('hex'); const file = sha256 + (image ? '.jpg' : '.mp4');
    const path = join(this.root, file); writeFileSync(path + '.tmp', bytes); renameSync(path + '.tmp', path);
    return { file, sha256, bytes: bytes.length, mime: image ? 'image/jpeg' : 'video/mp4' };
  }
  importImage(path: string) { if (statSync(path).size > 25 * 1024 * 1024) throw new Error('Choose an image smaller than 25 MB.'); return this.persist(readFileSync(path), true); }
  saveVideo(bytes: Buffer) { return this.persist(bytes, false); }
  async importClip(path: string, config: VideoConfig, signal: AbortSignal) {
    if (statSync(path).size > 80 * 1024 * 1024) throw new Error('Choose an MP4 smaller than 80 MB.');
    const info = await probeClip(path, config, signal); const output = this.saveVideo(readFileSync(path));
    const ratio = info.width / info.height > 1.3 ? '16:9' : info.width / info.height < 0.8 ? '9:16' : '1:1';
    return { output, duration: info.duration, ratio } as const;
  }
  async assemble(job: VideoJob, config: VideoConfig, signal: AbortSignal) {
    if (!job.assembly) throw new Error('The saved ad edit is missing.');
    const scripts = join(this.root, 'narration-worker'); mkdirSync(scripts, { recursive: true });
    for (const name of ['limited_runtime.py', 'narrate.py']) writeFileSync(join(scripts, name), readFileSync(join(dirname(this.script), name)));
    const narration = await generateNarration(this.voiceRoot(), scripts, this.jobFolder(job.id), job.assembly, signal);
    const output = await assembleVideo(job.assembly, config, this.jobFolder(job.id), asset => this.assetPath(asset), signal, narration);
    return this.saveVideo(readFileSync(output));
  }
  async importMusic(path: string, config: VideoConfig, signal: AbortSignal) {
    if (statSync(path).size > 80 * 1024 * 1024) throw new Error('Choose audio smaller than 80 MB.');
    const duration = await probeAudio(path, config, signal); const folder = this.jobFolder('music-import-' + Date.now()); const normalized = join(folder, 'music.wav');
    await videoTool(config.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-nostdin', '-threads', '2', '-protocol_whitelist', 'file,pipe', '-i', path, '-vn', '-t', String(duration), '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', normalized], folder, signal);
    const bytes = readFileSync(normalized); if (bytes.length > 64 * 1024 * 1024 || bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WAVE') throw new Error('Music normalization failed.');
    const sha256 = createHash('sha256').update(bytes).digest('hex'); const file = sha256 + '.wav'; writeFileSync(join(this.root, file), bytes);
    return { asset: { file, sha256, bytes: bytes.length, mime: 'audio/wav' as const }, duration };
  }
  saveImage(bytes: Buffer) { return this.persist(bytes, true); }
  assetPath(asset: VideoAsset) { this.bytes(asset); return this.file(asset); }
  jobFolder(id: string) { if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid video job.'); const path = join(this.root, 'jobs', id); mkdirSync(path, { recursive: true }); return path; }
  private async run(executable: string, args: string[], signal: AbortSignal, cwd: string) {
    signal.throwIfAborted();
    return new Promise<void>((resolve, reject) => {
      const child = spawn(executable, args, { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); let done = false;
      const abort = () => { child.kill(); };
      const timer = setTimeout(abort, 20 * 60000);
      signal.addEventListener('abort', abort, { once: true });
      const finish = (ok: boolean) => { if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort); if (ok && !signal.aborted) resolve(); else reject(new Error('Local video tool did not complete. Check its executable and the shot settings.')); };
      child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
      child.once('error', () => finish(false)); child.once('exit', code => finish(code === 0));
    });
  }
  async blockout(job: VideoJob, config: VideoConfig, signal: AbortSignal) {
    if (!this.toolReady(config.blenderPath, 'blender') || !this.toolReady(config.ffmpegPath, 'ffmpeg')) throw new Error('Configure Blender and FFmpeg.');
    const folder = this.jobFolder(job.id); const spec = join(folder, 'shot.json'); writeFileSync(spec, JSON.stringify({ shot: job.shot, ratio: job.ratio, duration: job.duration, frames: videoFrames(job) }));
    await this.run(config.blenderPath, ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '1', '--python', resolve(this.script), '--', spec, folder], signal, folder);
    const output = join(folder, 'blockout.mp4');
    await this.run(config.ffmpegPath, ['-y', '-nostdin', '-framerate', '24', '-i', join(folder, 'frames', '%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-movflags', '+faststart', '-an', output], signal, folder);
    if (statSync(output).size > 20 * 1024 * 1024) throw new Error('Blockout exceeds the reference size limit.');
    return this.persist(readFileSync(output), false);
  }
  async frames(asset: VideoAsset, config: VideoConfig, signal: AbortSignal, duration: number) {
    if (!this.toolReady(config.ffmpegPath, 'ffmpeg')) throw new Error('Configure FFmpeg.');
    const path = this.assetPath(asset); const folder = this.jobFolder('review-' + asset.sha256); const output = join(folder, 'frame-%02d.jpg');
    // Extract six evenly spaced samples, including the start and near the end.
    await this.run(config.ffmpegPath, ['-y', '-nostdin', '-i', path, '-vf', `select=isnan(prev_selected_t)+gte(t-prev_selected_t\\,${(duration - 0.2) / 5}),scale=640:640:force_original_aspect_ratio=decrease`, '-fps_mode', 'vfr', '-frames:v', '6', '-q:v', '3', output], signal, folder);
    const frames: string[] = [];
    for (let i = 1; i <= 6; i++) { const file = join(folder, `frame-${String(i).padStart(2, '0')}.jpg`); if (existsSync(file)) frames.push('data:image/jpeg;base64,' + readFileSync(file).toString('base64')); }
    return frames;
  }
  async download(value: string, image: boolean, signal: AbortSignal) {
    const url = new URL(value); publicOrigin(url.origin); signal.throwIfAborted();
    if (url.username || url.password) throw new Error('Invalid media download URL.');
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Media must be hosted publicly.');
    const address = addresses[0]!; const max = (image ? 25 : 80) * 1024 * 1024;
    const bytes = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []; let size = 0;
      const req = request(url, { method: 'GET', signal, timeout: 60000, family: address.family, lookup: (_name, _options, callback) => callback(null, address.address, address.family) }, response => {
        if (response.statusCode !== 200) { response.resume(); reject(new Error('Media download did not succeed.')); return; }
        response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > max) req.destroy(new Error('Media exceeds the download limit.')); else chunks.push(chunk); });
        response.once('end', () => resolve(Buffer.concat(chunks))); response.once('error', reject);
      });
      req.once('timeout', () => req.destroy(new Error('Media download timed out.'))); req.once('error', reject); req.end();
    });
    signal.throwIfAborted(); return this.persist(bytes, image);
  }
}
