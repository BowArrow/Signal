/* global fetch, WebSocket, setTimeout, clearTimeout */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const folder = resolve('data/handoffs-validation'); mkdirSync(folder, { recursive: true });
const profile = join(folder, `profile-${Date.now()}`); mkdirSync(profile);
const env = { ...process.env, SIGNAL_DATABASE_URL: join(profile, 'fixture.db'), SIGNAL_OFFLINE: '1', SIGNAL_PROFILE_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
const seeded = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/handoffs-ui-fixture.ts'], { env, encoding: 'utf8', windowsHide: true }); if (seeded.status !== 0) throw new Error(seeded.stderr || seeded.stdout);
const child = spawn(process.argv[2] ?? require('electron'), [...(process.argv[2] ? [] : ['.']), '--disable-gpu', '--remote-debugging-port=9347'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', value => { logs += value; }); child.stderr.on('data', value => { logs += value; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)); let socket; let seq = 0; const pending = new Map(); const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; }
async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`Condition failed: ${expression}`); }
async function click(text) { if (!await evaluate(`(() => {const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});el?.click();return !!el;})()`)) throw new Error(`Button missing: ${text}`); await pause(250); }
async function screenshot(name) { const result = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(folder, `${name}.png`), Buffer.from(result.data, 'base64')); }
const card = contact => `[...document.querySelectorAll('.sales-handoff')].find(e=>e.textContent.includes(${JSON.stringify(contact)}))`;
async function cardClick(contact, label) { if (!await evaluate(`(() => {const c=${card(contact)};const b=[...c.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});b?.click();return !!b;})()`)) throw new Error(`Missing ${label}`); await pause(250); }
async function fill(contact, label, value) { await evaluate(`(() => {const e=${card(contact)}.querySelector('[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`); }
try {
  let target;
  for (let i = 0; i < 100; i++) { try { target = (await fetch('http://127.0.0.1:9347/json').then(r => r.json())).find(t => t.type === 'page'); if (target) break; } catch { /* starting */ } await pause(200); }
  if (!target) throw new Error(logs);
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.method === 'Runtime.exceptionThrown') errors.push(value.params); const wait = pending.get(value.id); if (wait) { clearTimeout(wait.timer); pending.delete(value.id); if (value.error) wait.reject(value.error); else wait.resolve(value.result); } });
  await send('Runtime.enable'); await send('Page.enable'); await until('Boolean(window.signal && document.querySelector(".sidebar"))'); await click('Sales');
  await until('document.querySelectorAll(".sales-handoff").length===3'); await screenshot('handoffs-desktop');
  const uncertain = 'owner-uncertain@example.com'; const first = 'owner-one@example.com'; const second = 'owner-two@example.com';
  if (!await evaluate(`${card(uncertain)}.textContent.includes('Sending is unresolved') && !${card(uncertain)}.textContent.includes('Write owner response') && [...${card(uncertain)}.querySelectorAll('button')].find(b=>b.textContent==='Reconcile reply').disabled`)) throw new Error('Uncertain send is not protected');
  await cardClick(first, 'Write owner response'); const body = 'Thanks for asking. An annual plan is not currently available; I can explain the current options.';
  await fill(first, 'Owner response', body); await until('Boolean(document.querySelector(".handoff-preview"))');
  if (!await evaluate(`document.querySelector('.handoff-preview').textContent===${JSON.stringify(body + String.fromCharCode(10, 10) + 'Lemonade team - sent with Signal')}`)) throw new Error('Owner preview mismatch');
  await evaluate(`${card(first)}.querySelector('details').open=true`);
  if (!await evaluate(`${card(first)}.querySelector('.sales-body').textContent.includes('<script>') && ${card(first)}.querySelector('.sales-body script')===null`)) throw new Error('Saved email HTML executed');
  await evaluate(`${card(first)}.querySelector('.handoff-response').scrollIntoView()`); await screenshot('owner-response-desktop');
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 800, deviceScaleFactor: 1, mobile: false }); await screenshot('owner-response-small');
  if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Owner response page overflow');
  await cardClick(first, 'Approve response for Run'); await until('window.signal.salesReplies().then(v=>v.replies.some(r=>r.messageId==="handoff-one" && r.ownerApproval && r.status==="queued" && r.attemptedAt===null))');
  await cardClick(second, 'Remind me in 4 hours'); await until('window.signal.handoffs().then(v=>v.cases.some(c=>c.messageId==="handoff-two" && c.status==="snoozed" && c.dueAt>Date.now()))');
  await fill(second, 'Handoff note', 'I checked the original conversation and no response is needed.');
  await evaluate(`(() => {const e=${card(second)}.querySelector('[aria-label="Handoff outcome"]');e.value='no-response-needed';e.dispatchEvent(new Event('change',{bubbles:true}));})()`); await cardClick(second, 'Record resolution');
  await until('window.signal.handoffs().then(v=>v.cases.some(c=>c.messageId==="handoff-two" && c.resolution==="no-response-needed"))');
  await fill(uncertain, 'Handoff note', 'I will investigate Outlook or Gmail before taking any further action.'); await cardClick(uncertain, 'Record resolution');
  await until('window.signal.handoffs().then(v=>v.cases.some(c=>c.messageId==="handoff-uncertain" && c.resolution==="uncertainty-acknowledged"))');
  await evaluate('location.reload()'); await until('Boolean(document.querySelector(".sales-handoffs"))');
  if (!await evaluate('window.signal.salesReplies().then(v=>v.replies.some(r=>r.id==="uncertain-reply" && r.status==="attention" && r.attemptedAt!==null && r.ownerHandledAt))')) throw new Error('Uncertain receipt was erased');
  await evaluate('document.querySelector(".sales-handoffs input[type=checkbox]").click()'); await until('document.querySelectorAll(".sales-handoff").length>=3'); await screenshot('handoffs-resolved');
  await evaluate(`(() => {const e=document.querySelector('[aria-label="Sales business"]');e.value=[...e.options].find(o=>o.text==='CineGen').value;e.dispatchEvent(new Event('change',{bubbles:true}));})()`); await until('document.querySelectorAll(".sales-handoff").length===0');
  if (await evaluate('document.querySelector(".sales-handoffs").textContent.includes("owner-one@example.com")')) throw new Error('Handoff crossed business boundary');
  if (errors.length) throw new Error('Renderer exceptions');
  console.log(JSON.stringify({ ok: true, exactOwnerApproval: true, reminderPersisted: true, resolutionRecorded: true, uncertainReceiptPreserved: true, inertEmail: true, businessIsolation: true, viewports: ['1440x900', '720x800'], rendererErrors: errors.length, realEmailSent: false }));
} finally { socket?.close(); child.kill(); writeFileSync(join(folder, 'handoffs-ui.log'), logs); }
