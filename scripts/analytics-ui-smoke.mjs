/* global fetch, WebSocket, setTimeout, clearTimeout */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const folder = resolve('data/analytics-validation'); mkdirSync(folder, { recursive: true });
const profile = join(folder, `profile-${Date.now()}`); mkdirSync(profile);
const env = { ...process.env, SIGNAL_DATABASE_URL: join(profile, 'fixture.db'), SIGNAL_OFFLINE: '1', SIGNAL_PROFILE_DIR: profile, SIGNAL_UI_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const seeded = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/analytics-ui-fixture.ts'], { env, encoding: 'utf8', windowsHide: true }); if (seeded.status !== 0) throw new Error(seeded.stderr || seeded.stdout);
const child = spawn(process.argv[2] ?? require('electron'), [...(process.argv[2] ? [] : ['.']), '--remote-debugging-port=9345'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', value => { logs += value; }); child.stderr.on('data', value => { logs += value; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)); let socket; let seq = 0; const pending = new Map(); const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; }
async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`Condition failed: ${expression}`); }
async function click(text) { if (!await evaluate(`(() => {const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});el?.click();return !!el;})()`)) throw new Error(`Button missing: ${text}`); await pause(250); }
async function screenshot(name) { const result = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(folder, `${name}.png`), Buffer.from(result.data, 'base64')); }
try {
  let target;
  for (let i = 0; i < 100; i++) { try { target = (await fetch('http://127.0.0.1:9345/json').then(r => r.json())).find(t => t.type === 'page'); if (target) break; } catch { /* starting */ } await pause(200); }
  if (!target) throw new Error(logs);
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.method === 'Runtime.exceptionThrown') errors.push(value.params); const wait = pending.get(value.id); if (wait) { clearTimeout(wait.timer); pending.delete(value.id); if (value.error) wait.reject(value.error); else wait.resolve(value.result); } });
  await send('Runtime.enable'); await send('Page.enable'); await until('Boolean(window.signal && document.querySelector(".sidebar"))'); await click('Analytics');
  await until('document.querySelectorAll(".analytics-table tbody tr").length===2');
  if (!await evaluate('document.body.innerText.includes("$49.50") && document.body.innerText.includes("sampled data") && document.body.innerText.includes("240")')) throw new Error('Analytics observations rendered incorrectly');
  if (!await evaluate('document.body.innerText.includes("Not observed") && document.body.innerText.includes("Checkout starts")')) throw new Error('Journey report missing');
  if (!await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="Sync analytics").disabled')) throw new Error('Offline sync is not blocked');
  await screenshot('analytics-desktop'); await evaluate('location.reload()'); await until('document.querySelectorAll(".analytics-table tbody tr").length===2');
  await until(`document.querySelector('[aria-label="Search research"]')?.textContent.includes('compare client reports')`);
  if (!await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="Sync search queries").disabled')) throw new Error('Offline search sync must be blocked');
  await evaluate(`document.querySelector('[aria-label="Search research"]').scrollIntoView()`); await screenshot('search-desktop');
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 800, deviceScaleFactor: 1, mobile: false }); await screenshot('analytics-small');
  await evaluate(`document.querySelector('[aria-label="Buyer journey"]').scrollIntoView()`); await screenshot('journey-small');
  await evaluate(`document.querySelector('[aria-label="Search research"]').scrollIntoView()`); await screenshot('search-small');
  if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Horizontal page overflow');
  await evaluate(`(() => {const e=document.querySelector('[aria-label="Analytics business"]');e.value=[...e.options].find(o=>o.text==='CineGen').value;e.dispatchEvent(new Event('change',{bubbles:true}));})()`); await until('document.querySelectorAll(".analytics-table tbody tr").length===0');
  if (await evaluate('document.body.innerText.includes("$49.50")')) throw new Error('Analytics leaked across business selection');
  if (await evaluate('document.body.innerText.includes("compare client reports")')) throw new Error('Search queries leaked across business selection');
  await evaluate(`(() => {const e=document.querySelector('[aria-label="Analytics business"]');e.value=[...e.options].find(o=>o.text==='Lemonade').value;e.dispatchEvent(new Event('change',{bubbles:true}));})()`); await until('document.querySelectorAll(".analytics-table tbody tr").length===2');
  await click('Save analytics source');
  await until('window.signal.analytics().then(v=>v.states[0].propertyId === "1234" && v.snapshots.length===0)');
  await evaluate('location.reload()'); await until(`document.querySelector('[aria-label="GA4 property ID"]')?.value === "1234"`);
  await click('Remove analytics source'); await until('window.signal.analytics().then(v=>v.states.length===0 && v.snapshots.length===0)');
  if (errors.length) throw new Error('Renderer errors');
  console.log(JSON.stringify({ ok: true, observationsAndLimitations: true, offlineSyncBlocked: true, businessIsolation: true, snapshotPersisted: true, sourceEditClearsSnapshot: true, removeSource: true, viewports: ['1440x900', '720x800'], rendererErrors: errors.length }));
} finally { socket?.close(); child.kill(); writeFileSync(join(folder, 'analytics-ui.log'), logs); }
