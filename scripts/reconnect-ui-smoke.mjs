/* global fetch, WebSocket, setTimeout, clearTimeout */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const folder = resolve('data/operations-validation/reconnect'); mkdirSync(folder, { recursive: true });
const profile = join(folder, `profile-${Date.now()}`); mkdirSync(profile);
const env = { ...process.env, SIGNAL_DATABASE_URL: join(profile, 'fixture.db'), SIGNAL_OFFLINE: '1', SIGNAL_PROFILE_DIR: profile, SIGNAL_UI_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const seeded = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/operations-ui-fixture.ts'], { env, encoding: 'utf8', windowsHide: true });
if (seeded.status !== 0) throw new Error(seeded.stderr || seeded.stdout);
const child = spawn(process.argv[2] ?? require('electron'), [...(process.argv[2] ? [] : ['.']), '--remote-debugging-port=9353', '--disable-gpu'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', value => { logs += value; }); child.stderr.on('data', value => { logs += value; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)); let socket; let seq = 0; const pending = new Map(); const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; }
async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`Condition failed: ${expression}`); }
async function click(text) { assert(await evaluate(`(() => {const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)} && e.getClientRects().length);el?.click();return !!el;})()`), `Button missing: ${text}`); await pause(200); }
try {
  let target;
  for (let i = 0; i < 100; i++) { try { target = (await fetch('http://127.0.0.1:9353/json').then(r => r.json())).find(t => t.type === 'page'); if (target) break; } catch { /* starting */ } await pause(200); }
  if (!target) throw new Error(logs);
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.method === 'Runtime.exceptionThrown') errors.push(value.params); const wait = pending.get(value.id); if (wait) { clearTimeout(wait.timer); pending.delete(value.id); if (value.error) wait.reject(value.error); else wait.resolve(value.result); } });
  await send('Runtime.enable'); await send('Page.enable');
  await until('Boolean(document.querySelector(".guide-next"))');
  await click('Connections');
  await until('Boolean(document.querySelector(".connection-account"))');
  const reconnect = async label => {
    assert(await evaluate(`(() => { const card=[...document.querySelectorAll(".connection-account")].find(c=>c.textContent.includes(${JSON.stringify(label)})); const button=[...card.querySelectorAll("button")].find(b=>b.textContent==="Reconnect");button?.click();return !!button;})()`));
    await until('Boolean(document.querySelector("#connection-setup"))');
  };
  await reconnect('Bluesky publishing fixture');
  assert(await evaluate('document.querySelector("#connection-setup h2").textContent==="Reconnect Bluesky"'));
  assert(await evaluate('document.querySelector("[aria-label=\\"Account credential\\"]").type==="password"'));
  assert(await evaluate('document.querySelector("[aria-label=\\"Connection label\\"]").disabled'));
  for (const width of [1440,900,720,390]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    await evaluate('document.querySelector("#connection-setup").scrollIntoView({block:"start"})');
    await pause(250);
    const shot=await send('Page.captureScreenshot',{format:'png'});
    writeFileSync(join(folder,`reconnect-${width}.png`),Buffer.from(shot.data,'base64'));
    assert(!await evaluate('document.documentElement.scrollWidth>innerWidth || document.querySelector(".main-scroll").scrollWidth>document.querySelector(".main-scroll").clientWidth'),`Overflow at ${width}`);
  }
  await click('Close setup');
  await reconnect('Analytics reconnect fixture');
  assert(await evaluate('document.querySelector("#connection-setup h2").textContent.includes("Reconnect Google Analytics")'));
  assert(await evaluate('document.querySelector("#connection-setup").textContent.includes("preserve its campaign and analytics links")'));
  assert(!await evaluate('Boolean(document.querySelector(".connection-advanced-toggle"))'));
  await click('Close setup');
  assert(!await evaluate('Boolean(document.querySelector("#connection-setup"))'));
  assert(errors.length===0,'Renderer errors');
  const receipt={checkedAt:new Date().toISOString(),ok:true,fixtureOnly:true,packaged:Boolean(process.argv[2]),blueskyReconnect:true,analyticsReconnect:true,viewports:[1440,900,720,390],rendererErrors:errors.length};
  writeFileSync(join(folder,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
} finally { for (const p of pending.values()) clearTimeout(p.timer); socket?.close(); child.kill(); writeFileSync(join(folder, 'guide-ui.log'), logs); }
