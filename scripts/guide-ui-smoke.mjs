/* global fetch, WebSocket, setTimeout, clearTimeout */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const folder = resolve('data/operations-validation/guide'); mkdirSync(folder, { recursive: true });
const profile = join(folder, `profile-${Date.now()}`); mkdirSync(profile);
const env = { ...process.env, SIGNAL_DATABASE_URL: join(profile, 'fixture.db'), SIGNAL_OFFLINE: '1', SIGNAL_PROFILE_DIR: profile, SIGNAL_UI_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const seeded = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/operations-ui-fixture.ts'], { env, encoding: 'utf8', windowsHide: true });
if (seeded.status !== 0) throw new Error(seeded.stderr || seeded.stdout);
const child = spawn(process.argv[2] ?? require('electron'), [...(process.argv[2] ? [] : ['.']), '--remote-debugging-port=9351', '--disable-gpu'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', value => { logs += value; }); child.stderr.on('data', value => { logs += value; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)); let socket; let seq = 0; const pending = new Map(); const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; }
async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`Condition failed: ${expression}`); }
async function click(text) { assert(await evaluate(`(() => {const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)} && e.getClientRects().length);el?.click();return !!el;})()`), `Button missing: ${text}`); await pause(200); }
async function screenshot(name) { await evaluate('document.querySelector(".main-scroll").scrollTo(0,0)'); const result = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(folder, `${name}.png`), Buffer.from(result.data, 'base64')); }
async function select(label, value) { await evaluate(`(() => {const e=document.querySelector('[aria-label="${label}"]'); e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event('change',{bubbles:true}));})()`); }
try {
  let target;
  for (let i = 0; i < 100; i++) { try { target = (await fetch('http://127.0.0.1:9351/json').then(r => r.json())).find(t => t.type === 'page'); if (target) break; } catch { /* starting */ } await pause(200); }
  if (!target) throw new Error(logs);
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.method === 'Runtime.exceptionThrown') errors.push(value.params); const wait = pending.get(value.id); if (wait) { clearTimeout(wait.timer); pending.delete(value.id); if (value.error) wait.reject(value.error); else wait.resolve(value.result); } });
  await send('Runtime.enable'); await send('Page.enable');
  await until('Boolean(document.querySelector(".guide-next"))');
  assert(await evaluate('document.querySelector(".nav-item[aria-current=page]").getAttribute("aria-label")==="My marketer"'));
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await screenshot('guide-first-visit');
  await select('Marketing goal', 'first-sales');
  await evaluate(`(() => {const e=document.querySelector('[aria-label="Intended audience"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Proposal writers comparing source documents'); e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('Save our focus');
  await until(`document.querySelector('.guide-goal').textContent.includes('Proposal writers comparing') && !document.querySelector('[aria-label="Marketing goal"]')`);
  await evaluate('location.reload()');
  await until('document.querySelector(".guide-goal")?.textContent.includes("Proposal writers comparing")');
  assert(await evaluate('document.querySelector(".guide-evidence").textContent.includes("Unknown")'));
  await click('Why are we using these channels?');
  assert(await evaluate('document.activeElement.id === "guide-question" && document.activeElement.value.includes("channels")'));
  assert(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent === "Ask Signal").disabled'), 'Offline chat must stay disabled');
  const products = await evaluate('window.signal.operations().then(v=>v.products)');
  const cinegen = products.find(p => p.name === 'CineGen');
  await select('Guide business', cinegen.id);
  await until(`Boolean(document.querySelector('[aria-label="Marketing goal"]'))`);
  assert(!await evaluate('document.querySelector(".guide-goal").textContent.includes("Proposal writers comparing")'));
  await select('Marketing goal', 'more-trials'); await click('Save our focus');
  await until('document.querySelector(".guide-goal").textContent.includes("Help more people try")');
  await click('See conversations');
  await until('Boolean(document.querySelector("#sales-tab-conversations[aria-selected=true]"))');
  assert(await evaluate(`document.querySelector('[aria-label="Sales business"]').value === ${JSON.stringify(cinegen.id)}`));
  await click('My marketer'); await until('Boolean(document.querySelector(".guide-next"))');
  await click('Manage channels');
  await until('Boolean(document.querySelector("#operation-tab-settings[aria-selected=true]"))');
  assert(await evaluate(`document.querySelector('[aria-label="Operations business"]').value === ${JSON.stringify(cinegen.id)}`));
  await click('My marketer'); await until('Boolean(document.querySelector(".guide-next"))');
  await select('Guide business', products[0].id);
  await until('document.querySelector(".guide-goal").textContent.includes("Proposal writers comparing")');
  for (const width of [1440, 900, 720, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await screenshot(`guide-${width}`);
    assert(!await evaluate('document.documentElement.scrollWidth>innerWidth || document.querySelector(".main-scroll").scrollWidth > document.querySelector(".main-scroll").clientWidth'), `Overflow at ${width}`);
  }
  await evaluate(`window.signal.marketingAction({type:'mission',productId:${JSON.stringify(products[0].id)},value:{targetCents:10000000,currency:'usd',startsAt:Date.parse('2026-10-13T00:00:00-07:00'),endsAt:Date.parse('2027-01-01T00:00:00-08:00'),timezone:'America/Los_Angeles',active:true}})`);
  await evaluate('location.reload()');
  await until('Boolean(document.querySelector(".guide-mission"))');
  assert(await evaluate('document.querySelector(".guide-mission").textContent.includes("Score unverified")'), 'Missing revenue must not become zero confirmed sales');
  for (const width of [1440, 900, 720, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await screenshot(`mission-${width}`);
    assert(!await evaluate('document.documentElement.scrollWidth>innerWidth || document.querySelector(".main-scroll").scrollWidth > document.querySelector(".main-scroll").clientWidth'), `Mission overflow at ${width}`);
  }
  await select('Guide business', cinegen.id);
  await until('!document.querySelector(".guide-mission")');
  const result = await evaluate('window.signal.operations().then(v=>({running:v.states.some(s=>s.running),deliveries:v.deliveries.length}))');
  assert(!result.running && result.deliveries === 0 && errors.length === 0, 'Unexpected execution or renderer errors');
  const receipt = { checkedAt: new Date().toISOString(), ok: true, defaultHome: true, persistentGoals: true, persistentMission: true, missionIsolation: true, unknownScore: true, businessIsolation: true, contextualNavigation: true, offlineChatBlocked: true, viewports: [1440, 900, 720, 390], rendererErrors: errors.length, fixtureOnly: true };
  writeFileSync(join(folder, 'receipt.json'), JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt));
} finally { for (const p of pending.values()) clearTimeout(p.timer); socket?.close(); child.kill(); writeFileSync(join(folder, 'guide-ui.log'), logs); }
