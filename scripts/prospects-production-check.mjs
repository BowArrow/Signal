/* global fetch, WebSocket, setTimeout, clearTimeout, AbortSignal */
// Read-only production check: never submits the form or sends an email.
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const folder = resolve('data/prospects-production-validation'); mkdirSync(folder, { recursive: true });
const profile = join(folder, 'chrome-' + Date.now());
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws; const pause = ms => new Promise(r => setTimeout(r, ms));
try {
  const active = join(profile, 'DevToolsActivePort'); for (let i = 0; i < 100 && !existsSync(active); i++) await pause(100);
  const port = readFileSync(active, 'utf8').split('\n')[0];
  const tabs = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json());
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let next = 0; const pending = new Map(), errors = [], results = [];
  ws.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.method === 'Runtime.exceptionThrown') errors.push(value.params.exceptionDetails.text); const entry = pending.get(value.id); if (entry) { pending.delete(value.id); clearTimeout(entry.timer); if (value.error) entry.reject(Error(value.error.message)); else entry.resolve(value.result); } });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next, timer = setTimeout(() => reject(Error('Timed out: ' + method)), 20000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.text); return result.result.value; };
  const until = async expression => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await pause(100); } throw Error('Condition failed: ' + expression); };
  await cdp('Runtime.enable'); await cdp('Page.enable');
  for (const [brand, origin] of [['lemonade', 'https://siplemona.de'], ['cinegen', 'https://cinegenaimedia.com']]) {
    const expectedHash = createHash('sha256').update(readFileSync(brand === 'lemonade' ? '../Lemonade/site/prospect-signup.js' : '../CineGen/dist/prospect-signup.js')).digest('hex');
    for (const path of ['/', '/get-started', '/api/prospects/policy', '/prospect-signup.js']) {
      const response = await fetch(origin + path, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw Error(brand + ' ' + path + ' HTTP ' + response.status);
      if (path === '/prospect-signup.js' && createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex') !== expectedHash) throw Error('Visitor script hash mismatch');
    }
    if ((await fetch(origin + '/api/prospects/meta')).status !== 401) throw Error('Metadata should require credentials');
    for (const [width, height] of [[1440, 1000], [390, 844]]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
      await cdp('Page.navigate', { url: origin + '/get-started' });
      await until('Boolean(document.querySelector("#consent-text")?.textContent && document.querySelector("#verify-button"))');
      if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw Error(brand + ' signup overflow');
      writeFileSync(join(folder, `${brand}-${width}.png`), Buffer.from((await cdp('Page.captureScreenshot', { captureBeyondViewport: true })).data, 'base64'));
    }
    results.push({ brand, signup: origin + '/get-started', scriptHashMatches: true, privateMetadataProtected: true });
  }
  if (errors.length) throw Error('Production page exceptions: ' + errors.join(', '));
  const report = { ok: true, results, viewports: ['1440x1000', '390x844'], rendererErrors: 0, emailSent: false, contactCreated: false };
  writeFileSync(join(folder, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { ws?.close(); chrome.kill(); }
