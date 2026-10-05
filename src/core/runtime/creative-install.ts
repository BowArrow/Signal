import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, rename, rm, statfs, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { CreativeInstall } from '../../shared/creative.js';

// Pinned official portable. No automatic updates to an executable dependency.
export const COMFY_RELEASE = {
  version: '0.34.0', bytes: 2146721943,
  url: 'https://github.com/Comfy-Org/ComfyUI/releases/download/v0.34.0/ComfyUI_windows_portable_nvidia.7z',
  sha256: 'ed57cc6b19ae3d83add1ecebfdd56b25e04e0008cf0fe9af43a4ad8797e2a24c',
} as const;
export const SIGNAL_COMFY_URL = 'http://127.0.0.1:8190';
export function portableReady(root: string): boolean {
  return Boolean(root && existsSync(join(root, 'python_embeded', 'python.exe')) && existsSync(join(root, 'ComfyUI', 'main.py')));
}
export function inside(root: string, path: string): boolean {
  const part = relative(resolve(root), resolve(path));
  return part !== '' && !part.startsWith('..') && !isAbsolute(part);
}
const modelFolders = ['checkpoints', 'diffusion_models', 'unet', 'text_encoders', 'clip', 'clip_vision', 'vae', 'loras', 'upscale_models', 'latent_upscale_models', 'embeddings', 'controlnet', 'configs'];
export function modelPaths(roots: string[]): string {
  return roots.filter(root => existsSync(root)).map((root, index) => `signal_models_${index}:\n  base_path: ${JSON.stringify(resolve(root).replace(/\\/g, '/'))}\n${modelFolders.map(name => `  ${name}: ${name}\n`).join('')}`).join('\n');
}
interface Receipt { version: number; source: string; installedAt: number; modelRoots: string[] }
export class CreativeInstaller {
  readonly root: string;
  progress: CreativeInstall = { phase: 'idle', detail: '', completed: 0, total: 0 };
  private active: Promise<void> | null = null;
  private controller: AbortController | null = null;
  constructor(readonly base: string, private readonly extractor: string) { this.root = join(base, 'comfy-owned-v1'); }
  installed() { return portableReady(this.root) && existsSync(join(this.root, 'signal-install.json')); }
  modelRoots(): string[] {
    try { const value = JSON.parse(readFileSync(join(this.root, 'signal-install.json'), 'utf8')) as Receipt; return value.modelRoots.filter(item => typeof item === 'string'); } catch { return []; }
  }
  async stop() { this.controller?.abort(); await this.active; }
  begin(source: string, complete: (root: string) => void) {
    if (this.active) throw new Error('Creative setup is already running.');
    if (this.installed()) { complete(this.root); return; }
    const controller = new AbortController(); this.controller = controller;
    this.progress = { phase: 'checking', detail: 'Checking space for Signal’s private creative engine…', completed: 0, total: 0 };
    this.active = this.install(source, controller.signal).then(() => { controller.signal.throwIfAborted(); complete(this.root); this.progress = { ...this.progress, phase: 'done', detail: 'Signal’s creative engine is installed. Start it when you need local images.' }; })
      .catch(error => { this.progress = { ...this.progress, phase: controller.signal.aborted ? 'cancelled' : 'error', detail: controller.signal.aborted ? 'Setup cancelled. The previous installation was not changed.' : String(error instanceof Error ? error.message : error) }; })
      .finally(() => { this.active = null; this.controller = null; });
  }
  private async install(source: string, signal: AbortSignal) {
    await mkdir(this.base, { recursive: true });
    if (existsSync(this.root)) throw new Error('An incomplete owned installation exists. Inspect its folder before replacing it.');
    const stage = join(this.base, `setup-${randomUUID()}`);
    if (!inside(this.base, stage)) throw new Error('Invalid setup directory.');
    await mkdir(stage);
    try {
      let receipt: Receipt;
      if (source) {
        if (!portableReady(source) || inside(source, this.base) || resolve(source) === resolve(this.root)) throw new Error('Choose a separate Windows portable installation.');
        const files: { from: string; to: string; bytes: number }[] = [];
        const scan = async (from: string, to: string) => {
          signal.throwIfAborted();
          for (const entry of await readdir(from, { withFileTypes: true })) {
            if (['.git', '__pycache__', '.venv'].includes(entry.name) || (resolve(from) === resolve(source, 'ComfyUI') && ['models', 'custom_nodes', 'input', 'output', 'user', 'extra_model_paths.yaml'].includes(entry.name))) continue;
            const full = join(from, entry.name); const dest = join(to, entry.name); const stat = await lstat(full);
            if (stat.isSymbolicLink()) throw new Error('The selected engine contains links. Use the official download for an independent installation.');
            if (stat.isDirectory()) await scan(full, dest);
            else if (stat.isFile()) files.push({ from: full, to: dest, bytes: stat.size });
          }
        };
        // Copy code and Python; do not copy customer inputs, custom plugins, or huge model files.
        for (const part of ['python_embeded', 'ComfyUI']) await scan(join(source, part), join(stage, part));
        const total = files.reduce((sum, file) => sum + file.bytes, 0);
        await this.space(total + 2 * 1024 ** 3);
        this.progress = { phase: 'copying', detail: 'Creating Signal’s independent engine. Existing model files will be reused.', completed: 0, total };
        for (const file of files) { signal.throwIfAborted(); await mkdir(dirname(file.to), { recursive: true }); await copyFile(file.from, file.to); this.progress.completed += file.bytes; }
        receipt = { version: 1, source: 'local-copy', installedAt: Date.now(), modelRoots: [join(resolve(source), 'ComfyUI', 'models')] };
      } else {
        await this.space(16 * 1024 ** 3);
        if (!existsSync(this.extractor)) throw new Error('The bundled archive extractor is missing. Reinstall Signal.');
        const archive = join(stage, 'comfy.7z');
        this.progress = { phase: 'downloading', detail: 'Downloading the official ComfyUI 0.34.0 NVIDIA engine (2.15 GB).', completed: 0, total: COMFY_RELEASE.bytes };
        const response = await fetch(COMFY_RELEASE.url, { signal: AbortSignal.any([signal, AbortSignal.timeout(60 * 60 * 1000)]) });
        if (!response.ok || !response.body) throw new Error(`Engine download returned HTTP ${response.status}.`);
        const { open } = await import('node:fs/promises'); const handle = await open(archive, 'wx'); const hash = createHash('sha256');
        const reader = response.body.getReader();
        try { while (true) { const next = await reader.read(); if (next.done) break; const chunk = next.value; signal.throwIfAborted(); this.progress.completed += chunk.length; if (this.progress.completed > COMFY_RELEASE.bytes) throw new Error('Engine download is larger than expected.'); hash.update(chunk); await handle.writeFile(chunk); } } finally { try { await reader.cancel(); } finally { await handle.close(); } }
        if (this.progress.completed !== COMFY_RELEASE.bytes || hash.digest('hex') !== COMFY_RELEASE.sha256) throw new Error('Engine download failed its size or SHA-256 check.');
        this.progress = { ...this.progress, phase: 'extracting', detail: 'Extracting the verified engine…' };
        await new Promise<void>((ok, fail) => {
          let failure: Error | undefined;
          const child = spawn(this.extractor, ['x', archive, `-o${join(stage, 'archive')}`, '-y'], { windowsHide: true, shell: false, stdio: 'ignore', signal });
          child.once('error', error => { failure = error; }); child.once('close', code => failure ? fail(failure) : code === 0 ? ok() : fail(new Error('Could not extract the creative engine.')));
        });
        for (const part of ['python_embeded', 'ComfyUI']) await rename(join(stage, 'archive', 'ComfyUI_windows_portable', part), join(stage, part));
        await rm(join(stage, 'archive'), { recursive: true }); await rm(archive);
        receipt = { version: 1, source: `official-${COMFY_RELEASE.version}-${COMFY_RELEASE.sha256}`, installedAt: Date.now(), modelRoots: [] };
      }
      signal.throwIfAborted(); if (!portableReady(stage)) throw new Error('The engine layout is incomplete.');
      for (const part of ['ComfyUI/models', 'ComfyUI/custom_nodes', 'ComfyUI/input', 'ComfyUI/output', 'ComfyUI/user']) await mkdir(join(stage, part), { recursive: true });
      // Ensure the core entrypoint can still be read before marking the staged installation complete.
      const digest = createHash('sha256'); for await (const chunk of createReadStream(join(stage, 'ComfyUI/main.py'))) digest.update(chunk);
      await writeFile(join(stage, 'signal-install.json'), JSON.stringify({ ...receipt, entrypointSha256: digest.digest('hex') }, null, 2));
      signal.throwIfAborted(); await rename(stage, this.root);
    } finally { if (inside(this.base, stage)) await rm(stage, { recursive: true, force: true }); }
  }
  private async space(bytes: number) { const disk = await statfs(this.base); if (disk.bavail * disk.bsize < bytes) throw new Error(`Creative setup needs at least ${Math.ceil(bytes / 1024 ** 3)} GB of free disk space.`); }
}
