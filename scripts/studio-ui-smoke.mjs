/* global fetch, WebSocket, setTimeout, clearTimeout */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const folder = resolve('data/studio-validation'); mkdirSync(folder, { recursive: true });
const stamp = Date.now(); const database = resolve(folder, `ui-${stamp}.db`);
const env = { ...process.env, SIGNAL_DATABASE_URL: database, SIGNAL_OFFLINE: '1', SIGNAL_PROFILE_DIR: resolve(folder, `profile-${stamp}`) }; delete env.ELECTRON_RUN_AS_NODE;
const fixture = spawnSync(process.execPath, [require.resolve('tsx/cli'), 'scripts/studio-ui-fixture.ts', database], { env, encoding: 'utf8', windowsHide: true });
if (fixture.status) throw new Error(fixture.stderr || fixture.stdout);
const child = spawn(process.argv[2] ?? require('electron'), [...(process.argv[2] ? [] : ['.']), '--remote-debugging-port=9337', `--user-data-dir=${folder}/profile-${stamp}`], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms)); let socket; let seq = 0; const waiting = new Map(); const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 20000); waiting.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; }
async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(100); } throw new Error(`Condition failed: ${expression}`); }
async function click(label) { if (!await evaluate(`(() => { const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}); e?.click(); return !!e; })()`)) throw new Error(`Missing button: ${label}`); await delay(200); }
async function screenshot(name) { const result = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(resolve(folder, `${name}.png`), Buffer.from(result.data, 'base64')); }
try {
  let target;
  for (let i = 0; i < 100; i++) { try { const targets = await fetch('http://127.0.0.1:9337/json').then(r => r.json()); target = targets.find(t => t.type === 'page'); if (target) break; } catch { /* launching */ } await delay(200); }
  if (!target) throw new Error(logs);
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails); const waiter = waiting.get(message.id); if (waiter) { clearTimeout(waiter.timer); waiting.delete(message.id); if (message.error) waiter.reject(message.error); else waiter.resolve(message.result); } });
  await send('Runtime.enable'); await send('Page.enable');
  await until('Boolean(window.signal && document.querySelector(".sidebar"))');
  await click('Growth workspace'); await until('Boolean(document.querySelector(".studio-page"))'); await screenshot('workspace-desktop');
  await click('Channel playbooks'); await until('document.querySelectorAll(".studio-grid article").length===19'); await screenshot('playbooks-desktop');
  await click('Campaign studio'); await until('Boolean(document.querySelector(".studio-copy"))'); await screenshot('campaign-desktop');
  await evaluate(`(() => { for(const e of document.querySelectorAll('.studio-formats input')) { if(e.parentElement.textContent.includes('Verified')) e.click(); } })()`);
  await click('Approve material'); await until('document.body.innerText.includes("social · approved")');
  await click('Distribution calendar'); await until('document.body.innerText.includes("Unscheduled")'); await screenshot('calendar-desktop');
  await click('Revenue & outcomes'); await screenshot('outcomes-desktop');
  await click('Settings'); await until('document.body.innerText.includes("Save provider settings")'); await screenshot('settings-desktop');
  await evaluate(`(() => { const e=document.querySelector('[aria-label="Agent provider"]'); e.value='openai'; e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await click('Save provider settings'); await until('window.signal.runtime().then(r => r.settings.provider === "openai")');
  const secure = await evaluate('window.signal.runtime().then(r => r.secureStorage)');
  if (secure) {
    await evaluate('window.signal.runtimeAction({type:"key",value:"sk-signal-isolated-storage-test"}).then(r => { if(!r.hasApiKey || JSON.stringify(r).includes("sk-signal-isolated-storage-test")) throw new Error("Key storage boundary failed"); return true; })');
  }
  await click('Creative studio'); await until('document.body.innerText.includes("Image & video recipes")'); await screenshot('creative-desktop');
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 800, deviceScaleFactor: 1, mobile: false });
  for (const label of ['Growth workspace', 'Settings', 'Creative studio']) { await click(label); await delay(500); if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error(`Overflow: ${label}`); await screenshot(`${label.toLowerCase().replaceAll(' ', '-')}-small`); }
  await evaluate('location.reload()'); await until('Boolean(window.signal && document.querySelector(".sidebar"))');
  const result = await evaluate('Promise.all([window.signal.studio(),window.signal.runtime()]).then(([s,r])=>({approved:s.assets[0].status,provider:r.settings.provider,products:s.products.length,hasApiKey:r.hasApiKey}))');
  if (secure && !result.hasApiKey) throw new Error('Encrypted key did not survive reload');
  if (secure) await evaluate('window.signal.runtimeAction({type:"key",value:""}).then(() => true)');
  if (result.approved !== 'approved' || result.provider !== 'openai' || errors.length) throw new Error(JSON.stringify({ result, errors }));
  console.log(JSON.stringify({ ok: true, ...result, viewports: ['1440x900', '720x800'], rendererErrors: errors.length }));
} finally { socket?.close(); child.kill(); writeFileSync(resolve(folder, 'ui.log'), logs); }
