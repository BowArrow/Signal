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
  SIGNAL_DATABASE_URL: resolve(dir, `ui-${stamp}.db`),
  SIGNAL_OFFLINE: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  process.argv[2] ?? electron,
  [
    ...(process.argv[2] ? [] : ['.']),
    '--remote-debugging-port=9336',
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
    if (await evaluate(expression)) return;
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
      const targets = await fetch('http://127.0.0.1:9336/json').then((r) =>
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
  await until(`document.querySelectorAll('.nav-item').length > 0`);
  await click('Growth lab');
  await until(`document.querySelectorAll('.growth-channel').length === 19`);
  await screenshot('bullseye-desktop');
  await click('Goals & runtime');
  await until(`document.querySelectorAll('.growth-form').length === 2`);
  await click('Check saved runtime');
  await until(`document.body.innerText.includes('SIGNAL_OFFLINE=1')`);
  await screenshot('growth-settings');
  await click('Bullseye board');
  await click('Research all 19 channels');
  await until(`document.querySelectorAll('.growth-task').length === 19`);
  const taskState = await evaluate(`window.signal.growth()`);
  if (taskState.products[0].tasks.length !== 19)
    throw new Error('Research queue not durable');
  // Cancel any pending local test tasks, with offline mode preventing inference.
  await evaluate(
    `(async () => { const s = await window.signal.growth(); for (const p of s.products) for (const t of p.tasks) if (['queued','running'].includes(t.status)) await window.signal.growthAction({type:'cancel',taskId:t.id}); })()`,
  );
  await screenshot('growth-agents');
  const fixture = spawnSync(
    process.execPath,
    [
      require.resolve('tsx/cli'),
      'scripts/growth-ui-fixture.ts',
      env.SIGNAL_DATABASE_URL,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (fixture.status !== 0) throw new Error(fixture.stderr);
  await evaluate(`location.reload()`);
  await until(`document.querySelectorAll('.growth-channel').length === 19`);
  await until(`document.querySelector('.growth-activity')?.innerText.includes('Research complete')`);
  await screenshot('research-complete');
  await click('Refresh all 19 channels');
  await until(`document.querySelectorAll('.growth-task').length === 38`);
  await until(`document.querySelector('.growth-activity')?.innerText.includes('Research in progress')`);
  await screenshot('research-progress');
  const waitingFixture = spawnSync(process.execPath, [require.resolve('tsx/cli'), 'scripts/growth-ui-fixture.ts', env.SIGNAL_DATABASE_URL, 'waiting'], { encoding: 'utf8', windowsHide: true });
  if (waitingFixture.status !== 0) throw new Error(waitingFixture.stderr);
  await until(`document.querySelector('.growth-worker')?.innerText.includes('Still waiting for a validated response')`);
  const elapsedBefore = await evaluate(`document.querySelector('[aria-label="Task elapsed time"]').textContent`);
  await delay(1200);
  const elapsedAfter = await evaluate(`document.querySelector('[aria-label="Task elapsed time"]').textContent`);
  if (elapsedBefore === elapsedAfter) throw new Error('Elapsed time is not updating');
  await screenshot('research-waiting');
  await evaluate(
    `(async () => { const s = await window.signal.growth(); for (const p of s.products) for (const t of p.tasks) if (['queued','running'].includes(t.status)) await window.signal.growthAction({type:'cancel',taskId:t.id}); })()`,
  );
  await click('Bullseye board');
  await evaluate(`document.querySelectorAll('.growth-channel')[7].click()`);
  await until(
    `document.querySelector('.growth-detail')?.innerText.includes('UI test fixture')`,
  );
  await click('Shortlist & prepare campaign');
  await click('Experiments (1)');
  await click('Start test clock');
  await click('Record results');
  await evaluate(
    `(() => { const form=document.querySelector('.growth-results'); const inputs=form.querySelectorAll('input'); const values=['120','20','4','20','196','Synthetic UI measurement fixture']; inputs.forEach((input,i)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,values[i]);input.dispatchEvent(new Event('input',{bubbles:true}));}); const select=form.querySelector('select'); select.value='good';select.value='good';select.dispatchEvent(new Event('change',{bubbles:true})); })()`,
  );
  await click('Save measured results');
  await until(
    `document.querySelector('.growth-verdict')?.textContent.includes('promising')`,
  );
  await click('Focus this channel');
  await screenshot('growth-experiment-measured');
  await click('Experiment results');
  await until(`document.body.innerText.includes('$196.00')`);
  await screenshot('growth-results');
  await click('Growth digest');
  await until(`document.body.innerText.includes('No analyst memo yet')`);
  await click('Growth lab');
  await click('Bullseye board');
  await evaluate(`(async () => { const p=(await window.signal.growth()).products[0]; for (const c of p.channels.slice(0,2)) await window.signal.growthAction({type:'shortlist',channelId:c.id}); })()`);
  await evaluate(`location.reload()`);
  await until(`document.querySelectorAll('.growth-channel').length === 19`);
  await evaluate(`document.querySelectorAll('.growth-channel')[2].click()`);
  await until(`document.querySelector('.growth-shortlist-help')?.innerText.includes('All 3 shortlist slots')`);
  const blocked = await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Shortlist & prepare campaign')?.disabled`);
  if (!blocked) throw new Error('Full shortlist still allows a fourth channel');
  await evaluate(`document.querySelector('.growth-shortlist-help').scrollIntoView({behavior:'instant',block:'center'})`);
  await screenshot('shortlist-full');
  await click('Remove Targeting blogs');
  await until(`!document.querySelector('.growth-shortlist-help')`);
  await click('Shortlist & prepare campaign');
  const replaced = await evaluate(`(async () => (await window.signal.growth()).products[0])()`);
  if (replaced.channels.filter(c => c.ring !== 'outer').length !== 3 || replaced.channels[2].ring !== 'middle')
    throw new Error('Could not replace a shortlisted channel');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 720,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await delay(200);
  const overflow = await evaluate(
    `document.documentElement.scrollWidth > innerWidth`,
  );
  if (overflow) throw new Error('Horizontal overflow at 720px');
  await screenshot('bullseye-small');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(`location.reload()`);
  await until(`document.querySelectorAll('.growth-channel').length === 19`);
  const restored = await evaluate(`window.signal.growth()`);
  if (
    restored.products[0].tasks.filter((t) => t.kind === 'research').length !==
    38
  )
    throw new Error('Tasks disappeared after reload');
  if (
    restored.products[0].channels.filter((c) => c.ring === 'inner').length !== 1
  )
    throw new Error('Focus was not persisted');
  if (errors.length) throw new Error(JSON.stringify(errors));
  console.log(
    JSON.stringify({
      ok: true,
      channels: 19,
      persistedTasks: 38,
      viewports: ['1440x900', '720x800'],
      rendererErrors: errors.length,
      artifacts: dir,
    }),
  );
} finally {
  if (socket) {
    socket.send(JSON.stringify({ id: ++seq, method: 'Browser.close' }));
    await delay(500);
    socket.close();
  }
  child.kill();
  writeFileSync(resolve(dir, 'electron-smoke.log'), logs);
}
