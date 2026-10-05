/* global fetch, WebSocket, setTimeout, clearTimeout */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const workflow = process.env.SIGNAL_CARD_FIXTURE === '1' ? 'signal-brand-card-v1' : 'fixture-workflow';
const folder = resolve('data/operation-images-validation'); mkdirSync(folder, { recursive: true });
const profile = join(folder, `profile-${Date.now()}`); mkdirSync(profile);
const env = { ...process.env, SIGNAL_DATABASE_URL: join(profile, 'fixture.db'), SIGNAL_OFFLINE: '1', SIGNAL_PROFILE_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
const seeded = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/operation-images-ui-fixture.ts'], { env, encoding: 'utf8', windowsHide: true });
if (seeded.status !== 0) throw new Error(seeded.stderr || seeded.stdout);
const child = spawn(process.argv[2] ?? require('electron'), [...(process.argv[2] ? [] : ['.']), '--remote-debugging-port=9348', '--disable-gpu'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', value => { logs += value; }); child.stderr.on('data', value => { logs += value; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)); let socket; let seq = 0; const pending = new Map(); const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; }
async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`Condition failed: ${expression}`); }
async function click(text) { if (!await evaluate(`(() => {const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});el?.click();return !!el;})()`)) throw new Error(`Button missing: ${text}`); await pause(250); }
async function screenshot(name) { const result = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(folder, `${name}.png`), Buffer.from(result.data, 'base64')); }
try {
  let target;
  for (let i = 0; i < 100; i++) { try { target = (await fetch('http://127.0.0.1:9348/json').then(r => r.json())).find(t => t.type === 'page'); if (target) break; } catch { /* starting */ } await pause(200); }
  if (!target) throw new Error(logs);
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.method === 'Runtime.exceptionThrown') errors.push(value.params); const wait = pending.get(value.id); if (wait) { clearTimeout(wait.timer); pending.delete(value.id); if (value.error) wait.reject(value.error); else wait.resolve(value.result); } });
  await send('Runtime.enable'); await send('Page.enable'); await until('Boolean(window.signal && document.querySelector(".sidebar"))');
  await click('Operations'); await until('Boolean(document.querySelector(".operation-policy"))');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  if (!await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="Run operation").disabled')) throw new Error('Run must be disabled offline');
  await evaluate(`(() => {const e=document.querySelector('[aria-label="Campaign image workflow"]');e.value=${JSON.stringify(workflow)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('Save operating settings'); await until(`window.signal.operations().then(v=>v.states[0].imageWorkflowId===${JSON.stringify(workflow)})`);
  await screenshot('image-policy-desktop'); await evaluate('location.reload()'); await until(`document.querySelector(".operation-policy select")?.value===${JSON.stringify(workflow)}`);
  await click('Preview campaign image'); await until('document.querySelector(".operation-image img")?.naturalWidth>0');
  await evaluate('document.querySelector(".operation-image").scrollIntoView({block:"center"})'); await screenshot('campaign-image-desktop');
  if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Desktop overflow');
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 800, deviceScaleFactor: 1, mobile: false }); await evaluate('document.querySelector(".operation-image").scrollIntoView({block:"center"})'); await screenshot('campaign-image-small');
  if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Narrow overflow');
  await evaluate(`(() => {const e=document.querySelector('[aria-label="Operations business"]');e.value=[...e.options].find(o=>o.text==='CineGen').value;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until('document.querySelectorAll(".operation-image").length===0');
  if (!await evaluate(`(() => {const options=[...document.querySelector('.operation-policy select').options];return options.length===2 && options.some(o=>o.value==='signal-brand-card-v1') && !options.some(o=>o.value==='fixture-workflow');})()`)) throw new Error('Workflow crossed business boundary');
  await click('Settings'); await until(`Boolean(document.querySelector('[aria-label="Local image-review model"]'))`);
  await evaluate(`(() => {const e=document.querySelector('[aria-label="Local image-review model"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'fixture-vision-model');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('Save provider settings'); await until('window.signal.runtime().then(v=>v.settings.localVisionModel==="fixture-vision-model")');
  await evaluate('location.reload()'); await until(`document.querySelector('[aria-label="Local image-review model"]')?.value==='fixture-vision-model'`);
  if (errors.length) throw new Error('Renderer errors');
  console.log(JSON.stringify({ok:true,imagePolicyPersisted:true,visionModelPersisted:true,approvedImagePreview:true,businessIsolation:true,offlineRunBlocked:true,viewports:['1440x900','720x800'],rendererErrors:0,realPublication:false}));
} finally { socket?.close(); child.kill(); writeFileSync(join(folder, 'images-ui.log'), logs); }
