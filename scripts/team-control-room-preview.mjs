/* global fetch, WebSocket, setTimeout, clearTimeout */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);

const folder = resolve('data/operations-validation/team-control-room'); mkdirSync(folder, { recursive: true });
const profile = join(folder, `profile-${Date.now()}`); mkdirSync(profile);
const env = { ...process.env, SIGNAL_DATABASE_URL: join(profile, 'fixture.db'), SIGNAL_OFFLINE: '1', SIGNAL_PROFILE_DIR: profile, SIGNAL_UI_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const Database = require('better-sqlite3');
const source = new Database(join(process.env.APPDATA, 'signal', 'signal.db'), { readonly: true, fileMustExist: true, nativeBinding: resolve('native/better_sqlite3-node.node') });
try { await source.backup(env.SIGNAL_DATABASE_URL); } finally { source.close(); }
const child = spawn(process.argv[2] ?? require('electron'), [...(process.argv[2] ? [] : ['.']), '--remote-debugging-port=9358', '--disable-gpu'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', value => { logs += value; }); child.stderr.on('data', value => { logs += value; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)); let socket; let seq = 0; const pending = new Map(); const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; }
async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`Condition failed: ${expression}`); }
async function click(text) { assert(await evaluate(`(() => {const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)} && e.getClientRects().length);el?.click();return !!el;})()`), `Button missing: ${text}`); await pause(200); }
async function screenshot(name) { await evaluate('document.querySelector(".main-scroll").scrollTo(0,0)'); const result = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(folder, `${name}.png`), Buffer.from(result.data, 'base64')); }
try {
  let target;
  for (let i = 0; i < 100; i++) { try { target = (await fetch('http://127.0.0.1:9358/json').then(r => r.json())).find(t => t.type === 'page'); if (target) break; } catch { /* starting */ } await pause(200); }
  if (!target) throw new Error(logs);
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.method === 'Runtime.exceptionThrown') errors.push(value.params); const wait = pending.get(value.id); if (wait) { clearTimeout(wait.timer); pending.delete(value.id); if (value.error) wait.reject(value.error); else wait.resolve(value.result); } });
  await send('Runtime.enable'); await send('Page.enable');
  await until('Boolean(document.querySelector(".guide-next"))'); await click('Marketing team'); await until('Boolean(document.querySelector(".team-mission"))');
  for (const width of [1440, 1000, 720, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1050, deviceScaleFactor: 1, mobile: false });
    await screenshot('campaign-' + width);
    assert(!await evaluate('document.documentElement.scrollWidth>innerWidth || document.querySelector(".main-scroll").scrollWidth > document.querySelector(".main-scroll").clientWidth'), 'Horizontal overflow');
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  await click('Edit campaign brief'); await screenshot('campaign-editor');
  assert(!errors.length);
  console.log(JSON.stringify({ ok: true, readOnlyOwnerSnapshot: true, offline: true, rendererErrors: errors.length }));
} finally { for (const p of pending.values()) clearTimeout(p.timer); socket?.close(); child.kill(); writeFileSync(join(folder, 'team-ui.log'), logs); }
