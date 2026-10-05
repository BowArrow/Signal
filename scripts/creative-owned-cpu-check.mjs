/* global fetch, setTimeout, AbortSignal */
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = JSON.parse(readFileSync('data/creative-validation/owned-setup.json', 'utf8')).folder;
const profile = resolve('data/creative-validation', `cpu-${Date.now()}`); mkdirSync(profile, { recursive: true });
const child = spawn(join(root, 'python_embeded/python.exe'), ['-s', resolve('src/core/video/limited_runtime.py'), '--cpu-only', '--status', join(profile, 'limits.json'), '--', join(root, 'ComfyUI/main.py'), '--cpu', '--disable-auto-launch', '--disable-all-custom-nodes', '--disable-api-nodes', '--listen', '127.0.0.1', '--port', '8197', '--user-directory', profile, '--output-directory', join(profile, 'output'), '--database-url', 'sqlite:///' + join(profile, 'comfyui.db').replaceAll('\\', '/')], { cwd: root, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CUDA_VISIBLE_DEVICES: '-1', OMP_NUM_THREADS: '2', MKL_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '2', HF_HUB_OFFLINE: '1' } });
let logs = ''; child.stdout.on('data', value => { logs = (logs + value).slice(-30000); }); child.stderr.on('data', value => { logs = (logs + value).slice(-30000); });
try {
  let stats;
  for (let i = 0; i < 240; i++) {
    if (child.exitCode !== null) throw new Error('CPU engine exited: ' + logs.slice(-3000));
    try { const r = await fetch('http://127.0.0.1:8197/system_stats', { signal: AbortSignal.timeout(1000) }); if (r.ok) { stats = await r.json(); break; } } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 500));
    if (i > 0 && i % 30 === 0) console.log('Waiting for CPU-only engine startup; no generation has been submitted.');
  }
  if (!stats) throw new Error('CPU engine did not become ready: ' + logs.slice(-3000));
  if (stats.devices?.some(device => device.type !== 'cpu')) throw new Error('Unexpected non-CPU device.');
  const info = await fetch('http://127.0.0.1:8197/object_info', { signal: AbortSignal.timeout(15000) }).then(r => r.json());
  if (!info.KSampler || !info.SaveImage) throw new Error('Core local nodes are missing.');
  const limits = JSON.parse(readFileSync(join(profile, 'limits.json'), 'utf8'));
  const result = { ok: true, cpuOnly: true, devices: stats.devices?.map(device => device.type), nodes: Object.keys(info).length, memoryLimitEnforced: limits.enforced === true, promptsSubmitted: 0 };
  writeFileSync('data/creative-validation/owned-cpu-check.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { child.kill(); writeFileSync(join(profile, 'engine.log'), logs); }
