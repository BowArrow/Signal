/* global fetch, WebSocket, setTimeout, clearTimeout */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url); const folder = resolve('data/desktop-validation'); mkdirSync(folder, { recursive: true }); const profile = join(folder, `profile-${Date.now()}`); mkdirSync(profile);
const env = { ...process.env, SIGNAL_DATABASE_URL: join(profile, 'fixture.db'), SIGNAL_PROFILE_DIR: profile, SIGNAL_OFFLINE: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(process.argv[2] ?? require('electron'), [...(process.argv[2] ? [] : ['.']), '--disable-gpu', '--remote-debugging-port=9344'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let startupChild;
let logs = ''; child.stdout.on('data', value => { logs += value; }); child.stderr.on('data', value => { logs += value; }); const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)); let socket; let seq = 0; const pending = new Map(); const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; }
async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`Condition failed: ${expression}`); }
async function click(text) { if (!await evaluate(`(() => {const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});e?.click();return !!e;})()`)) throw new Error(`Missing button: ${text}`); await pause(200); }
async function screenshot(name) { const result = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(folder, `${name}.png`), Buffer.from(result.data, 'base64')); }
async function attach() {
  let target; for (let i = 0; i < 100; i++) { try { target = (await fetch('http://127.0.0.1:9344/json').then(r => r.json())).find(t => t.type === 'page'); if (target) break; } catch { /* Starting. */ } await pause(200); } if (!target) throw new Error(logs);
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.method === 'Runtime.exceptionThrown') errors.push(value.params); const wait = pending.get(value.id); if (wait) { clearTimeout(wait.timer); pending.delete(value.id); if (value.error) wait.reject(value.error); else wait.resolve(value.result); } });
  await send('Runtime.enable'); await send('Page.enable'); await until('Boolean(window.signal && document.querySelector(".sidebar"))');
}
async function waitForExit(promise) { let timeout; try { const code = await Promise.race([promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Quit did not stop Signal')), 15000); })]); if (code !== 0) throw new Error(`Quit exited with ${code}`); } finally { clearTimeout(timeout); } }
try {
  await attach(); await click('Settings'); await until('Boolean(document.querySelector(".desktop-settings"))');
  await until(`Boolean(document.querySelector('[aria-label="Local model processing"]'))`);
  await evaluate(`(() => { const e=document.querySelector('[aria-label="Local model processing"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'cpu');e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await click('Save provider settings'); await until('window.signal.runtime().then(v=>v.settings.localDevice === "cpu")');
  await evaluate(`document.querySelector('[aria-label="Local model processing"]').closest('form').scrollIntoView()`); await screenshot('cpu-provider-settings');
  if (!await evaluate('window.signal.desktop().then(v=>v.trayAvailable && !v.loginSupported && !v.preventingSleep && !v.settings.keepRunningOnClose)')) throw new Error('Unexpected isolated desktop defaults');
  if (!await evaluate(`document.querySelector('[aria-label="Start Signal at login"]').disabled`)) throw new Error('OS startup must be unavailable in an isolated profile');
  await evaluate(`document.querySelector('[aria-label="Keep Signal running in background"]').click()`); await click('Save background settings'); await until('window.signal.desktop().then(v=>v.settings.keepRunningOnClose)');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); await screenshot('desktop-settings');
  await evaluate('window.signal.desktopAction({type:"hide"})'); await until('window.signal.desktop().then(v=>v.hidden)'); await pause(3500); if (child.exitCode !== null) throw new Error('Closing to tray quit the worker');
  const second = spawn(process.argv[2] ?? require('electron'), [...(process.argv[2] ? [] : ['.']), '--disable-gpu'], { env, windowsHide: true, stdio: 'ignore' });
  let secondTimer; const secondExit = await Promise.race([new Promise(resolve => second.once('exit', resolve)), new Promise((_, reject) => { secondTimer = setTimeout(() => { second.kill(); reject(new Error('Second launch did not reuse the existing profile')); }, 15000); })]); clearTimeout(secondTimer); if (secondExit !== 0) throw new Error('Second launch failed');
  await until('window.signal.desktop().then(v=>!v.hidden)'); await evaluate('location.reload()'); await until('Boolean(document.querySelector(".desktop-settings"))');
  if (!await evaluate('window.signal.desktop().then(v=>v.settings.keepRunningOnClose && !v.loginEnabled)')) throw new Error('Settings did not persist');
  await until('window.signal.runtime().then(v=>v.settings.localDevice === "cpu")');
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 800, deviceScaleFactor: 1, mobile: false }); await screenshot('desktop-settings-small'); if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Horizontal overflow');
  if (errors.length) throw new Error('Renderer exceptions'); await evaluate('window.signal.desktopAction({type:"quit"})');
  await waitForExit(exited); socket.close();
  startupChild = spawn(process.argv[2] ?? require('electron'), [...(process.argv[2] ? [] : ['.']), '--disable-gpu', '--signal-background', '--remote-debugging-port=9344'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  startupChild.stdout.on('data', value => { logs += value; }); startupChild.stderr.on('data', value => { logs += value; }); const startupExited = new Promise(resolve => startupChild.once('exit', resolve));
  await attach(); await pause(500); if (!await evaluate('window.signal.desktop().then(v=>v.hidden && v.settings.keepRunningOnClose)')) throw new Error('Background startup did not honor the saved preference');
  await evaluate('window.signal.desktopAction({type:"show"})'); await until('window.signal.desktop().then(v=>!v.hidden)'); await evaluate('window.signal.desktopAction({type:"quit"})'); await waitForExit(startupExited); if (errors.length) throw new Error('Renderer exceptions');
  console.log(JSON.stringify({ ok: true, trayHidePreservedProcess: true, secondLaunchReusedWorker: true, backgroundStartupVerified: true, reopened: true, settingsPersisted: true, loginWritesDisabled: true, quitExited: true, viewports: ['1440x900', '720x800'], rendererErrors: 0 }));
} finally { socket?.close(); if (child.exitCode === null) child.kill(); if (startupChild?.exitCode === null) startupChild.kill(); writeFileSync(join(folder, 'ui.log'), logs); }
