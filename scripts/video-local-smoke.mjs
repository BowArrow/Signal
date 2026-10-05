import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const stage = process.argv[2];
if (!['blockout', 'h3'].includes(stage)) throw new Error('Usage: node scripts/video-local-smoke.mjs blockout <blender.exe> <ffmpeg.exe> | h3 [ComfyUI URL]');
const folder = resolve('out/validation'); mkdirSync(folder, { recursive: true });
const outfile = resolve(folder, `video-${stage}.cjs`);
await build({ entryPoints: [`scripts/video-${stage}-smoke.ts`], outfile, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [outfile, ...process.argv.slice(3)], { env, windowsHide: true, stdio: 'inherit' });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
