import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const folder = resolve('output/ltd-rollout'); mkdirSync(folder, { recursive: true });
const handoff = true;
const profile = mkdtempSync(join(tmpdir(), 'signal-ltd-browser-'));
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [...(handoff ? [] : ['--headless=new']), '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: !handoff, stdio: 'ignore' });
const delay = ms => new Promise(r => setTimeout(r, ms));
let ws;
try {
  const active = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(active); i++) await delay(100);
  const port = readFileSync(active, 'utf8').split('\n')[0];
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', e => { const d = JSON.parse(e.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); clearTimeout(p.timer); d.error ? p.reject(Error(d.error.message)) : p.resolve(d.result); } });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; const timer = setTimeout(() => { pending.delete(n); reject(Error('CDP timeout')); }, 30000); pending.set(n, { resolve, reject, timer }); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async expression => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text); return r.result.value; };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', {url:'https://myaccount.google.com/connections'});
  writeFileSync(join(folder,'google-connections-browser.json'),JSON.stringify({port,profile},null,2));
  console.log('Google connections window opened; waiting for the account owner to sign in.');
  await new Promise(resolve=>browser.once('exit',resolve));
} finally {ws?.close();browser.kill();}
