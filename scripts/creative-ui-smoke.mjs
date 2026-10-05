/* global fetch, WebSocket, setTimeout, clearTimeout */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const folder = resolve('data/creative-validation'); mkdirSync(folder, { recursive: true });
const profile = join(folder, `profile-${Date.now()}`); mkdirSync(profile);
const env = { ...process.env, SIGNAL_DATABASE_URL: join(profile, 'fixture.db'), SIGNAL_OFFLINE: '1', SIGNAL_PROFILE_DIR: profile, SIGNAL_UI_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(process.argv[2] ?? require('electron'), [...(process.argv[2] ? [] : ['.']), '--remote-debugging-port=9352', '--disable-gpu'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', value => { logs += value; }); child.stderr.on('data', value => { logs += value; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)); let socket; let seq = 0; const pending = new Map(); const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; }
async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`Condition failed: ${expression}`); }
async function click(text) { if (!await evaluate(`(() => {const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});el?.click();return !!el;})()`)) throw new Error(`Button missing: ${text}`); await pause(250); }
async function screenshot(name) { const result = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(folder, `${name}.png`), Buffer.from(result.data, 'base64')); }
try {
  let target;
  for (let i = 0; i < 100; i++) { try { target = (await fetch('http://127.0.0.1:9352/json').then(r => r.json())).find(t => t.type === 'page'); if (target) break; } catch { /* starting */ } await pause(200); }
  if (!target) throw new Error(logs);
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.method === 'Runtime.exceptionThrown') errors.push(value.params); const wait = pending.get(value.id); if (wait) { clearTimeout(wait.timer); pending.delete(value.id); if (value.error) wait.reject(value.error); else wait.resolve(value.result); } });
  await send('Runtime.enable'); await send('Page.enable'); await until('Boolean(window.signal && document.querySelector(".sidebar"))');
  await click('Creative studio'); await until('Boolean(document.querySelector(".creative-runtime"))');
  await until('document.querySelector(".brand-mark img")?.naturalWidth === 256');
  if (!await evaluate('Boolean(document.querySelector(\'link[rel="icon"]\')?.href.endsWith("signal.svg"))')) throw new Error('Signal favicon missing');
  if (await evaluate('document.body.innerText.includes("TypeError: fetch failed")')) throw new Error('Raw network failure still shown');
  await click('Set up Signal engine');
  await until('document.body.innerText.includes("Offline test mode: creative installation is disabled")');
  const state = await evaluate('window.signal.creative()'); if (state.install.phase !== 'idle' || state.managed) throw new Error('Offline setup started work');
  await screenshot('creative-desktop');
  await evaluate('document.querySelector(".creative-runtime details").open=true');
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 800, deviceScaleFactor: 1, mobile: false }); await screenshot('creative-small');
  if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Creative setup overflows');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  if (errors.length) throw new Error('Renderer errors');
  console.log(JSON.stringify({ ok: true, brandedLogo: true, favicon: true, offlineSetupBlocked: true, viewports: ['1440x900', '720x800'], rendererErrors: errors.length }));
} finally { socket?.close(); child.kill(); writeFileSync(join(folder, 'creative-ui.log'), logs); }
