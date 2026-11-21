/* global fetch, WebSocket, setTimeout, clearTimeout */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const folder = resolve('data/sales-validation-pipeline'); mkdirSync(folder, { recursive: true });
const profile = join(folder, `profile-${Date.now()}`); mkdirSync(profile);
const env = { ...process.env, SIGNAL_DATABASE_URL: join(profile, 'fixture.db'), SIGNAL_OFFLINE: '1', SIGNAL_PROFILE_DIR: profile, SIGNAL_UI_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
for (const script of ['scripts/sales-ui-fixture.ts', 'scripts/sales-pipeline-ui-fixture.ts']) {
  const seeded = spawnSync(process.execPath, ['--import', 'tsx', script], { env, encoding: 'utf8', windowsHide: true });
  if (seeded.status !== 0) throw new Error(seeded.stderr || seeded.stdout);
}
const child = spawn(process.argv[2] ?? require('electron'), [...(process.argv[2] ? [] : ['.']), '--remote-debugging-port=9369', '--disable-gpu'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', value => { logs += value; }); child.stderr.on('data', value => { logs += value; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)); let socket; let seq = 0; const pending = new Map(); const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; }
async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`Condition failed: ${expression}`); }
async function click(text) { assert(await evaluate(`(() => {const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)} && e.getClientRects().length);el?.click();return !!el;})()`), `Button missing: ${text}`); await pause(200); }
async function screenshot(name) { await evaluate('document.querySelector(".main-scroll").scrollTo(0,0)'); const result = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(folder, `${name}.png`), Buffer.from(result.data, 'base64')); }
try {
  let target;
  for (let i = 0; i < 100; i++) { try { target = (await fetch('http://127.0.0.1:9369/json').then(r => r.json())).find(t => t.type === 'page'); if (target) break; } catch { /* starting */ } await pause(200); }
  if (!target) throw new Error(logs);
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.method === 'Runtime.exceptionThrown') errors.push(value.params); const wait = pending.get(value.id); if (wait) { clearTimeout(wait.timer); pending.delete(value.id); if (value.error) wait.reject(value.error); else wait.resolve(value.result); } });
  await send('Runtime.enable'); await send('Page.enable');
  await until('Boolean(window.signal && document.querySelector(".sidebar"))');
  await click('Sales'); await click('Intent pipeline'); await until('document.querySelectorAll(".intent-lead").length === 1');
  assert(await evaluate('document.querySelector(".intent-lead").textContent.includes("87/100")'));
  assert(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="Approve one email").disabled'));
  for (const width of [1440, 1000, 720, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1050, deviceScaleFactor: 1, mobile: false });
    await screenshot('pipeline-' + width);
    assert(!await evaluate('document.documentElement.scrollWidth>innerWidth || document.querySelector(".main-scroll").scrollWidth>document.querySelector(".main-scroll").clientWidth'), 'Overflow at ' + width);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  await click('Edit draft');
  await evaluate('(() => {const e=document.querySelector(".intent-edit textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(e,"Unsaved owner draft stays here while receipts refresh.");e.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await pause(4500);
  assert(await evaluate('document.querySelector(".intent-edit textarea").value === "Unsaved owner draft stays here while receipts refresh."'), 'Polling replaced the owner edit');
  await screenshot('pipeline-editing');
  await evaluate(`(() => {const e=document.querySelector('[aria-label="Sales business"]');e.value=[...e.options].find(o=>o.text==="CineGen").value;e.dispatchEvent(new Event("change",{bubbles:true}));})()`);
  await pause(800); console.log(await evaluate(`JSON.stringify({business:document.querySelector('[aria-label="Sales business"]').value,options:[...document.querySelector('[aria-label="Sales business"]').options].map(o=>({text:o.text,value:o.value})),leads:document.querySelectorAll('.intent-lead').length})`));
  await screenshot('pipeline-other-business');
  await until('document.querySelectorAll(".intent-lead").length === 0');
  assert(!await evaluate('document.querySelector(".intent-pipeline").textContent.includes("research@example.org")'));
  assert(errors.length === 0);
  const receipt = { ok: true, checkedAt: new Date().toISOString(), fixtureOnly: true, viewports: [1440,1000,720,390], sourceAndQualificationVisible: true, offlineApprovalBlocked: true, pollingPreservesEdits: true, businessIsolation: true, rendererErrors: errors.length };
  writeFileSync(join(folder, 'receipt.json'), JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt));

} finally { for (const p of pending.values()) clearTimeout(p.timer); socket?.close(); child.kill(); writeFileSync(join(folder, 'pipeline-ui.log'), logs); }
