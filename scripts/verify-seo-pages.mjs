import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const posts = JSON.parse(readFileSync('output/seo/published-guides.json', 'utf8'));
posts.push({ url: 'https://siplemona.de/', title: 'Lemonade — Local AI Document Assistant by AIon X', home: true });
const profile = mkdtempSync(join(tmpdir(), 'signal-seo-check-'));
const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9347', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(r => setTimeout(r, ms));
let socket, seq = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' timeout')); }, 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; };
try {
  let page;
  for (let i = 0; i < 100 && !page; i++) { try { page = (await (await fetch('http://127.0.0.1:9347/json')).json()).find(p => p.type === 'page'); } catch {} if (!page) await delay(100); }
  assert(page); socket = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => socket.addEventListener('open', r, { once: true }));
  socket.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.method === 'Runtime.exceptionThrown') errors.push(data.params); const p = pending.get(data.id); if (p) { clearTimeout(p.timer); pending.delete(data.id); data.error ? p.reject(Error(data.error.message)) : p.resolve(data.result); } });
  await send('Runtime.enable'); await send('Page.enable'); const checks = [];
  for (const post of posts) {
    await send('Page.navigate', { url: post.url });
    let ready = false;
    for (let i = 0; i < 100; i++) { if (await evaluate(`location.href === ${JSON.stringify(post.url)} && document.readyState === 'complete' && document.title.includes(${JSON.stringify(post.title)}) && !!document.querySelector('script[type="application/ld+json"]')`)) { ready = true; break; } await delay(100); }
    assert(ready, 'Page did not finish loading: ' + post.url);
    for (const width of [1440, 390, 320]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      const result = await evaluate(`({ title:document.title, h1:document.querySelector('h1')?.textContent, overflow:document.documentElement.scrollWidth>innerWidth, canonical:document.querySelector('link[rel=canonical]')?.href, schema:JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent), links:[...document.querySelectorAll('article a')].map(a=>a.href), community:!!document.querySelector('a[href="https://discord.gg/wQ2KdjTdHG"]'), analyticsProduct:document.querySelector('script[src="/website-analytics.js"]')?.dataset.product })`);
      if (!post.home) { assert.equal(result.h1, post.title); assert.equal(result.schema['@type'], 'BlogPosting'); assert.equal(result.analyticsProduct, post.url.includes('siplemona.de') ? 'lemonade' : 'cinegen'); }
      else { assert(result.title.includes('AIon X')); assert(result.schema['@graph'].some(item => item['@type'] === 'WebSite')); }
      assert.equal(result.overflow, false); assert.equal(result.canonical, post.url); assert.equal(result.community, true);
      const screenshot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(resolve('output/seo', (post.home ? 'lemonade-home' : new URL(post.url).pathname.split('/').at(-1)) + '-' + width + '.png'), Buffer.from(screenshot.data, 'base64'));
      checks.push({ url: post.url, width, ...result });
    }
  }
  assert.equal(errors.length, 0); writeFileSync('output/seo/browser-verification.json', JSON.stringify({ checks, rendererErrors: errors.length }, null, 2)); console.log(JSON.stringify({ pages: posts.length, widths: [1440, 390, 320], rendererErrors: errors.length, passed: true }));
} finally { for (const p of pending.values()) clearTimeout(p.timer); socket?.close(); child.kill(); }
