/* global fetch, WebSocket, setTimeout, clearTimeout */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { URL } from 'node:url';

const live = process.argv.includes('--live');
const root = resolve('../CineGen/dist'), folder = resolve('data/campaign-browser-validation'); mkdirSync(folder, { recursive: true });
const profile = join(folder, 'chrome-' + Date.now());
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost'); let file = resolve(root, '.' + url.pathname);
  if (url.pathname === '/') file = join(root, 'index.html');
  if (!file.startsWith(root + '\\')) { res.writeHead(404).end(); return; }
  if (!existsSync(file) && !extname(file) && existsSync(file + '.html')) file += '.html';
  if (!existsSync(file) || !statSync(file).isFile()) file = join(root, 'index.html');
  const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg' }[extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type }); res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origins = live ? ['https://cinegenaimedia.com', 'https://siplemona.de'] : ['http://127.0.0.1:' + server.address().port];
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws; const pause = ms => new Promise(r => setTimeout(r, ms));
try {
  const active = join(profile, 'DevToolsActivePort'); for (let n = 0; n < 100 && !existsSync(active); n++) await pause(100);
  const port = readFileSync(active, 'utf8').split('\n')[0]; const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let next = 0; const pending = new Map(), errors = [], results = [], checkoutRequests = [];
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; const timer = setTimeout(() => reject(Error('Timed out: ' + method)), 20000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); });
  ws.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.text);
    if (data.method === 'Fetch.requestPaused') {
      // Block all writes, including telemetry and checkout, in this browser check.
      const { request, requestId } = data.params;
      if (request.method === 'POST' && new URL(request.url).pathname === '/api/checkout') checkoutRequests.push(JSON.parse(request.postData));
      void cdp(request.method !== 'GET' ? 'Fetch.failRequest' : 'Fetch.continueRequest', request.method !== 'GET' ? { requestId, errorReason: 'BlockedByClient' } : { requestId });
    }
    const item = pending.get(data.id); if (!item) return; clearTimeout(item.timer); pending.delete(data.id); if (data.error) item.reject(Error(data.error.message)); else item.resolve(data.result);
  });
  const evaluate = async expression => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text); return r.result.value; };
  const until = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(`Boolean(${expression})`)) return; await pause(100); } throw Error('Condition failed: ' + expression); };
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  for (const origin of origins) {
    for (const [width, height] of [[1440, 1000], [390, 844]]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
      await cdp('Page.navigate', { url: origin + '/?utm_source=signal&utm_campaign=browser_fixture_123' });
      await until('document.querySelector("h1") && window.signalCampaignHint === "browser_fixture_123"'); await pause(600);
      assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false, 'No page overflow');
      await cdp('Page.navigate', { url: origin + '/' });
      await until('window.signalCampaignHint === "browser_fixture_123" && document.querySelector("h1")');
      await pause(1200); // Let the existing entrance animation reveal the headline.
      const name = origin.includes('siplemona') ? 'lemonade' : 'cinegen';
      writeFileSync(join(folder, `${live ? 'live' : 'staged'}-${name}-${width}.png`), Buffer.from((await cdp('Page.captureScreenshot', { captureBeyondViewport: false })).data, 'base64'));
      results.push({ origin, width, headline: await evaluate('document.querySelector("h1").textContent'), campaignAfterNavigation: await evaluate('window.signalCampaignHint') });
      if (origin.includes('siplemona')) {
        const count = checkoutRequests.length;
        await evaluate('document.querySelector("[data-buy]").click()');
        for (let n = 0; n < 100 && checkoutRequests.length === count; n++) await pause(50);
        assert.equal(checkoutRequests.length, count + 1, 'Observe the actual checkout request without delivering it');
        assert.equal(checkoutRequests.at(-1).signalCampaign, 'browser_fixture_123');
      }
    }
  }
  assert.equal(errors.length, 0, 'No uncaught browser exceptions');
  const report = { mode: live ? 'live' : 'staged', results, rendererErrors: errors, allWritesBlocked: true, blockedCheckoutRequests: checkoutRequests.length, realCheckoutCreated: false };
  writeFileSync(join(folder, live ? 'live.json' : 'staged.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { ws?.close(); chrome.kill(); await new Promise(r => server.close(r)); }
