import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
// Reuse the existing ignored runner directory; the report and images remain inspectable.
const output = resolve('data/operation-images-validation/runner/brand-card-smoke.cjs');
await build({ entryPoints: ['scripts/brand-card-smoke.ts'], outfile: output, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [output, '--disable-gpu'], { env, windowsHide: true, stdio: 'inherit' });
child.on('exit', code => { process.exitCode = code ?? 1; });
child.on('error', error => { console.error(error); process.exitCode = 1; });
