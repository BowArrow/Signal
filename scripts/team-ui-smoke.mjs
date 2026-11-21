/* global fetch, WebSocket, setTimeout, clearTimeout */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const legacy = process.env.SIGNAL_TEAM_UI_LEGACY === '1';
const folder = resolve('data/operations-validation/team'); mkdirSync(folder, { recursive: true });
const profile = join(folder, `profile-${Date.now()}`); mkdirSync(profile);
const env = { ...process.env, SIGNAL_DATABASE_URL: join(profile, 'fixture.db'), SIGNAL_OFFLINE: '1', SIGNAL_PROFILE_DIR: profile, SIGNAL_UI_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
for (const script of ['scripts/operations-ui-fixture.ts', 'scripts/team-ui-fixture.ts']) {
  const seeded = spawnSync(process.execPath, ['--import', 'tsx', script], { env, encoding: 'utf8', windowsHide: true });
  if (seeded.status !== 0) throw new Error(seeded.stderr || seeded.stdout);
}
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
  assert(await evaluate('document.querySelectorAll(".team-roster button").length === 7'));
  assert(await evaluate(`document.querySelector('[aria-label="Campaign results"]').textContent.includes("Unknown")`));
  for (const width of [1440, 1000, 720, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1050, deviceScaleFactor: 1, mobile: false }); await screenshot(`team-${width}`);
    assert(!await evaluate('document.documentElement.scrollWidth>innerWidth || document.querySelector(".main-scroll").scrollWidth > document.querySelector(".main-scroll").clientWidth'), `Overflow at ${width}`);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  assert(await evaluate(`[...document.querySelectorAll("button")].find(b=>b.textContent===${JSON.stringify(legacy ? 'Start approved campaign' : 'Approve & start campaign')}).disabled`), 'Offline campaign activation must be disabled');
  await evaluate('location.reload()'); await until(`document.querySelector(".team-state")?.textContent===${JSON.stringify('Campaign has not started')}`);
  await click('Edit destinations & cadence');
  await evaluate(`(() => { const e=document.querySelector('[aria-label="Campaign editor"] input[type="number"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'2'); e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await click('Save campaign settings'); await until('!document.querySelector(".campaign-unsaved")');
  assert(await evaluate(`window.signal.operations().then(v=>v.states.find(s=>s.productId===document.querySelector('[aria-label="Team business"]').value).dailyLimit===2)`));
  await click('Edit campaign brief');
  const editedObjective = 'Show researchers how to compare two cited document passages.';
  await evaluate(`(() => {const e=document.querySelector('[aria-label="Campaign objective"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(editedObjective)}); e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await pause(3300);
  assert(await evaluate(`document.querySelector('[aria-label="Campaign objective"]').value===${JSON.stringify(editedObjective)}`), 'Polling overwrote unsaved edits');
  assert(await evaluate(`document.querySelector('[aria-label="Team business"]').disabled`));
  await screenshot('team-editing');
  await click('Save brief & replan'); await until('!document.querySelector(".campaign-unsaved")');
  await evaluate('location.reload()'); await until(`document.querySelector('.campaign-now h2')?.textContent===${JSON.stringify(editedObjective)}`);
  assert(await evaluate('document.querySelectorAll(".team-roster .is-done").length===0'), 'Brief changes must invalidate old deliverables');
  await click('Cancel campaign'); await click('New campaign'); await screenshot('team-new-campaign');
  assert(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="Start campaign team").disabled'), 'Offline execution must be disabled');
  const products = await evaluate('window.signal.marketing().then(v=>v.products)'); const other = products.find(p => p.name === 'CineGen');
  await evaluate(`(() => {const e=document.querySelector('[aria-label="Team business"]'); e.value=${JSON.stringify(other.id)}; e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until('!document.querySelector(".team-mission") && document.querySelector(".team-brief")?.textContent.includes("campaign accomplish")');
  const state = await evaluate('window.signal.operations().then(v=>({running:v.states.some(s=>s.running),deliveries:v.deliveries.length}))');
  assert(!state.running && state.deliveries === 0 && errors.length === 0);
  const receipt = { ok: true, checkedAt: new Date().toISOString(), fixtureOnly: true, legacyApproval: legacy, viewports: [1440, 1000, 720, 390], sevenRoles: true, persistentReviewAndOfflineApprovalBlocked: true, businessIsolation: true, unknownOutcomes: true, offlineExecutionBlocked: true, persistentBriefEdits: true, persistentScopeEdits: true, pollingPreservesEdits: true, rendererErrors: errors.length };
  writeFileSync(join(folder, 'receipt.json'), JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt));
} finally { for (const p of pending.values()) clearTimeout(p.timer); socket?.close(); child.kill(); writeFileSync(join(folder, 'team-ui.log'), logs); }
