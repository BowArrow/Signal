import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const profile = mkdtempSync(join(tmpdir(), 'signal-seo-check-'));
const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9357', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(r => setTimeout(r, ms));
let socket, seq = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' timeout')); }, 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; };
try {
  let page;
  for (let i = 0; i < 100 && !page; i++) { try { page = (await (await fetch('http://127.0.0.1:9357/json')).json()).find(p => p.type === 'page'); } catch {} if (!page) await delay(100); }
  assert(page); socket = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => socket.addEventListener('open', r, { once: true }));
  socket.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.method === 'Runtime.exceptionThrown') errors.push(data.params); const p = pending.get(data.id); if (p) { clearTimeout(p.timer); pending.delete(data.id); data.error ? p.reject(Error(data.error.message)) : p.resolve(data.result); } });

  await send('Runtime.enable'); await send('Page.enable');const checks=[];
  const did='did:plc:225g4y2e35b4fylvbsbe752f',key='3mwjlhrkwe22t';
  for(const encoded of [true,false]) {
    const url='https://bsky.app/profile/'+(encoded?encodeURIComponent(did):did)+'/post/'+key;
    await send('Page.navigate',{url});let text='';
    for(let i=0;i<200;i++){text=await evaluate('document.body?.innerText??""');if(text.includes('Invalid DID or handle')||text.includes('entire open web')||text.includes('visible only to people who are signed in'))break;await delay(100);}
    const result={url,invalidDid:text.includes('Invalid DID or handle'),postVisible:text.includes('entire open web'),signInRequired:text.includes('visible only to people who are signed in')};checks.push(result);console.log(JSON.stringify(result));
    const screenshot=await send('Page.captureScreenshot',{format:'png'});writeFileSync('output/bluesky-link-'+(encoded?'before':'after')+'.png',Buffer.from(screenshot.data,'base64'));
  }
  assert((checks[1].postVisible||checks[1].signInRequired)&&!checks[1].invalidDid,'Corrected source must reach the post or its author sign-in requirement');
  const response=await fetch('https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?'+new URLSearchParams({uri:'at://'+did+'/app.bsky.feed.post/'+key,depth:'0'}));const data=await response.json();assert(response.ok&&data.thread?.post?.record?.text.includes('entire open web'),'The reported source must exist');
  writeFileSync('output/bluesky-link-verification.json',JSON.stringify({checkedAt:new Date().toISOString(),checks},null,2));

} finally { for (const p of pending.values()) clearTimeout(p.timer); socket?.close(); child.kill(); }
