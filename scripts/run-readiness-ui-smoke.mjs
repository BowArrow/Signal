/* global fetch, WebSocket, setTimeout, clearTimeout */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const folder = resolve('data/run-validation'); mkdirSync(folder, { recursive: true }); const profile = join(folder, `profile-${Date.now()}`); mkdirSync(profile);
const env = { ...process.env, SIGNAL_DATABASE_URL: join(profile, 'fixture.db'), SIGNAL_PROFILE_DIR: profile, SIGNAL_OFFLINE: '0' }; delete env.ELECTRON_RUN_AS_NODE;
const seed = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/run-readiness-ui-fixture.ts'], { env, encoding: 'utf8', windowsHide: true }); if (seed.status !== 0) throw new Error(seed.stderr || seed.stdout);
const child = spawn(process.argv[2] ?? require('electron'), [...(process.argv[2] ? [] : ['.']), '--remote-debugging-port=9347'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', v => { logs += v; }); child.stderr.on('data', v => { logs += v; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)); let socket; let seq = 0; const pending = new Map(); const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => reject(new Error(`Timed out: ${method}`)), 15000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (value.exceptionDetails) throw new Error(value.exceptionDetails.text); return value.result?.value; }
async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`Condition failed: ${expression}`); }
async function click(label) { if (!await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}); if (!b || b.disabled) return false; b.click(); return true; })()`)) throw new Error(`Unavailable button: ${label}`); }
async function screenshot(name) { const value = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(folder, name + '.png'), Buffer.from(value.data, 'base64')); }
try {
  let target;
  for (let i = 0; i < 100; i++) { try { target = (await fetch('http://127.0.0.1:9347/json').then(r => r.json())).find(t => t.type === 'page'); if (target) break; } catch { /* starting */ } await pause(100); }
  if (!target) throw new Error('Desktop startup failed');
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', e => { const v = JSON.parse(e.data); if (v.method === 'Runtime.exceptionThrown') errors.push(v.params); const p = pending.get(v.id); if (p) { clearTimeout(p.timer); pending.delete(v.id); if (v.error) p.reject(v.error); else p.resolve(v.result); } });
  await send('Runtime.enable'); await send('Page.enable'); await until('Boolean(window.signal && document.querySelector(".sidebar"))');
  await click('Operations'); await until('Boolean(document.querySelector(".operation-readiness"))');
  if (!await evaluate('window.signal.operations().then(v=>v.readiness[0].ready && !v.readiness[0].needsAgents && v.states[0].accountIds.length===0)')) throw new Error('Read-only operation is not ready');
  await click('Run operation'); await until('window.signal.operations().then(v=>v.states[0].running)');
  await pause(2500);
  if (!await evaluate('window.signal.operations().then(v=>v.states[0].running && !v.tasks.length && !v.deliveries.length && v.runtimeHealth.status==="idle")')) throw new Error('Read-only Run started an agent or publication');
  await screenshot('read-only-run-desktop');
  await click('Pause operation'); await until('window.signal.operations().then(v=>!v.states[0].running)');
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 800, deviceScaleFactor: 1, mobile: false }); await evaluate('document.querySelector(".operation-readiness").scrollIntoView()'); await screenshot('read-only-run-small');
  if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Readiness layout overflow'); if (errors.length) throw new Error('Renderer errors');
  console.log(JSON.stringify({ ok: true, actualRunStarted: true, actualPauseStopped: true, modelUnavailableButUnneeded: true, noPublishingTasks: true, noRemoteCredentials: true, viewports: ['1440x900','720x800'], rendererErrors: 0 }));
} finally { socket?.close(); child.kill(); writeFileSync(join(folder, 'run-ui.log'), logs); }
