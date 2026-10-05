import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const posts = JSON.parse(readFileSync('output/seo/published-guides.json', 'utf8'));
posts.push({ url: 'https://siplemona.de/', title: 'Lemonade — Local AI Document Assistant by AIon X', home: true });
const profile = mkdtempSync(join(tmpdir(), 'signal-seo-check-'));
const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9356', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(r => setTimeout(r, ms));
let socket, seq = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' timeout')); }, 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; };
try {
  let page;
  for (let i = 0; i < 100 && !page; i++) { try { page = (await (await fetch('http://127.0.0.1:9356/json')).json()).find(p => p.type === 'page'); } catch {} if (!page) await delay(100); }
  assert(page); socket = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => socket.addEventListener('open', r, { once: true }));
  socket.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.method === 'Runtime.exceptionThrown') errors.push(data.params); const p = pending.get(data.id); if (p) { clearTimeout(p.timer); pending.delete(data.id); data.error ? p.reject(Error(data.error.message)) : p.resolve(data.result); } });

  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  const requests=new Map(),checks=[];
  socket.addEventListener('message', event=>{
    const message=JSON.parse(event.data),p=message.params;
    if(message.method==='Network.requestWillBeSent') {
      const url=new URL(p.request.url);
      if(/(^|\.)google-analytics.com$|(^|\.)analytics.google.com$/.test(url.hostname)&&url.pathname.includes('collect')) requests.set(p.requestId,{host:url.hostname,event:url.searchParams.get('en'),measurement:url.searchParams.get('tid'),status:null});
    }
    if(message.method==='Network.responseReceived'&&requests.has(p.requestId))requests.get(p.requestId).status=p.response.status;
    if(message.method==='Network.loadingFailed'&&requests.has(p.requestId))requests.get(p.requestId).error=p.errorText;
  });
  for(const site of [{url:'https://siplemona.de/',choice:'Allow website analytics',measurement:'G-0B685NXWZW'},{url:'https://cinegenaimedia.com/',choice:'Allow analytics',measurement:'G-R20H0SWYLH'}]){
    requests.clear();await send('Page.navigate',{url:site.url});
    let ready=false;for(let i=0;i<150;i++){if(await evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(site.choice)})`)){ready=true;break;}await delay(100);}
    assert(ready,'Consent control missing: '+site.url);await delay(1000);const before=requests.size;
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(site.choice)}).click()`);
    for(let i=0;i<120;i++){if([...requests.values()].some(r=>r.measurement===site.measurement&&(r.status||r.error)))break;await delay(100);}
    const result={site:site.url,beforeConsent:before,collection:[...requests.values()],scriptLoaded:await evaluate('!!window.google_tag_manager')};
    checks.push(result);console.log(JSON.stringify(result));
  }
  writeFileSync('output/analytics/browser-collection.json',JSON.stringify({checkedAt:new Date().toISOString(),checks,rendererErrors:errors.map(e=>e.exceptionDetails?.text)},null,2));

} finally { for (const p of pending.values()) clearTimeout(p.timer); socket?.close(); child.kill(); }
