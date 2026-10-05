/* global setTimeout, clearTimeout, fetch, WebSocket */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const electron = require('electron');
const dir = resolve('data/growth-validation');
mkdirSync(dir, { recursive: true });
const stamp = Date.now();
const env = {
  ...process.env,
  SIGNAL_DATABASE_URL: resolve(dir, `marketing-ui-${stamp}.db`),
  SIGNAL_OFFLINE: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  process.argv[2] ?? electron,
  [
    ...(process.argv[2] ? [] : ['.']),
    '--remote-debugging-port=9338',
    `--user-data-dir=${dir}/profile-${stamp}`,
  ],
  { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
let logs = '';
child.stdout.on('data', (b) => {
  logs += b;
});
child.stderr.on('data', (b) => {
  logs += b;
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
let seq = 0;
const waiting = new Map();
const errors = [];
async function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 15000);
    waiting.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text,
    );
  return result.result?.value;
}
async function until(expression) {
  for (let i = 0; i < 60; i++) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await delay(100);
  }
  throw new Error(`UI condition failed: ${expression}`);
}
async function click(text) {
  const clicked = await evaluate(
    `(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`,
  );
  if (!clicked) throw new Error(`Button missing: ${text}`);
  await delay(200);
}
async function screenshot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(dir, `${name}.png`), Buffer.from(shot.data, 'base64'));
}
try {
  let target;
  for (let i = 0; i < 80; i++) {
    try {
      const targets = await fetch('http://127.0.0.1:9338/json').then((r) =>
        r.json(),
      );
      target = targets.find((t) => t.type === 'page');
      if (target) break;
    } catch {
      /* starting */
    }
    await delay(250);
  }
  if (!target) throw new Error(`Electron did not expose a page. ${logs}`);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown')
      errors.push(msg.params.exceptionDetails);
    const waiter = waiting.get(msg.id);
    if (waiter) {
      clearTimeout(waiter.timer);
      waiting.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message));
      else waiter.resolve(msg.result);
    }
  });
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await until(`document.querySelector('.marketing-page')`);
  await screenshot('marketing-desktop');
  const initial = await evaluate(`window.signal.marketing()`);
  if (initial.products.some(p => p.budget.availableCents !== 0)) throw new Error('Initial budget is not zero');
  if (initial.requests.length !== 4) throw new Error('Engineering proposals not initialized');
  await click('Run next marketing cycle');
  await until(`document.querySelector('.marketing-running') || document.querySelector('[role="alert"]')`);
  await click('Memory graph');
  await until(`document.querySelector('.marketing-graph')`);
  await evaluate(`(() => { const e=document.querySelector('#memory-note'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'UI fixture: keep responses concise and concrete'); e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await click('Save memory');
  await until(`document.querySelector('.marketing-memory-list')?.textContent.includes('UI fixture: keep responses')`);
  await screenshot('marketing-memory');
  await evaluate(`(() => { const e=document.querySelector('[aria-label="Marketing product"]'); e.value=e.options[1].value; e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await until(`!document.querySelector('.marketing-memory-list')?.textContent.includes('UI fixture: keep responses')`);
  await evaluate(`(() => { const e=document.querySelector('[aria-label="Marketing product"]'); e.value=e.options[0].value; e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await click('Engineering requests');
  await until(`document.querySelectorAll('.marketing-request').length >= 2`);
  await evaluate(`(() => { const e=document.querySelector('select[aria-label^="Status:"]'); e.value='accepted'; e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await screenshot('marketing-engineering');
  await click('Cash & tiers');
  await until(`document.querySelector('[aria-label="Cash amount"]')`);
  await evaluate(`(() => { for (const [label,value] of [['Cash amount','100'],['Cash reference','ui-settlement'],['Cash evidence','Synthetic UI fixture: settled after all costs']]) { const e=document.querySelector('[aria-label="'+label+'"]'); const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value); e.dispatchEvent(new Event('input',{bubbles:true})); } })()`);
  await click('Record cash entry');
  await until(`document.body.innerText.includes('ui-settlement')`);
  const funded = await evaluate(`window.signal.marketing()`);
  if (funded.products[0].budget.availableCents !== 1000 || funded.products[0].budget.tier !== 'bootstrap') throw new Error('Cash policy UI mismatch');
  await screenshot('marketing-budget');
  await click('Media & product access');
  await click('Check ComfyUI');
  await until(`document.body.innerText.includes('Offline mode')`);
  await screenshot('marketing-media');
  const fixture = spawnSync(process.execPath, [require.resolve('tsx/cli'), 'scripts/marketing-ui-fixture.ts', env.SIGNAL_DATABASE_URL], { encoding:'utf8', windowsHide:true });
  if (fixture.status !== 0) throw new Error(fixture.stderr);
  await click('Content & responses');
  await until(`document.body.innerText.includes('Synthetic reply fixture')`);
  await click('Approve copy');
  await until(`document.body.innerText.includes('reply · approved')`);
  await screenshot('marketing-content');
  await click('Talk to Signal');
  await send('Emulation.setDeviceMetricsOverride', {width:720,height:800,deviceScaleFactor:1,mobile:false});
  await delay(200);
  if (await evaluate(`document.documentElement.scrollWidth > innerWidth`)) throw new Error('Marketing UI overflow at 720px');
  await screenshot('marketing-small');
  await evaluate(`location.reload()`);
  await until(`document.querySelector('.marketing-page')`);
  const restored = await evaluate(`window.signal.marketing()`);
  if (!restored.memories.some(m => m.body === 'UI fixture: keep responses concise and concrete') || !restored.requests.some(r => r.status === 'accepted') || restored.drafts[0]?.status !== 'approved') throw new Error('Marketing state did not persist');
  if (errors.length) throw new Error(JSON.stringify(errors));
  console.log(JSON.stringify({ok:true,viewports:['1440x900','720x800'],rendererErrors:errors.length,scopedMemory:true,cash:true,engineering:true,drafts:true}));
} finally {
  if (socket) { socket.send(JSON.stringify({id:++seq,method:'Browser.close'})); await delay(500); socket.close(); }
  child.kill(); writeFileSync(resolve(dir,'marketing-ui.log'),logs);
}
