/* global fetch, WebSocket, setTimeout, clearTimeout */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);


const folder = resolve('data/workspace-ui-validation'); mkdirSync(folder, { recursive: true });
const profile = join(folder, `operations-validation-${Date.now()}`); mkdirSync(profile);
const env = { ...process.env, SIGNAL_DATABASE_URL: join(profile, 'fixture.db'), SIGNAL_OFFLINE: '1', SIGNAL_PROFILE_DIR: profile, SIGNAL_UI_TEST_HIDDEN: '1', SIGNAL_CONVERSATION_FIXTURE: '1', SIGNAL_PROSPECT_FIXTURE: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const seeded = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/operations-ui-fixture.ts'], { env, encoding: 'utf8', windowsHide: true });
if (seeded.status !== 0) throw new Error(seeded.stderr || seeded.stdout);
const child = spawn(process.argv[2] ?? require('electron'), [...(process.argv[2] ? [] : ['.']), '--remote-debugging-port=9352', '--disable-gpu'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', value => { logs += value; }); child.stderr.on('data', value => { logs += value; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)); let socket; let seq = 0; const pending = new Map(); const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; }
async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`Condition failed: ${expression}`); }
async function click(text) { if (!await evaluate(`(() => {const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});el?.click();return !!el;})()`)) throw new Error(`Button missing: ${text}`); await pause(250); }
async function screenshot(name) { const result = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(folder, `${name}.png`), Buffer.from(result.data, 'base64')); }
try {
  let target;
  for (let i = 0; i < 100; i++) { try { target = (await fetch('http://127.0.0.1:9352/json').then(r => r.json())).find(t => t.type === 'page'); if (target) break; } catch { /* starting */ } await pause(200); }
  if (!target) throw new Error(logs);
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.method === 'Runtime.exceptionThrown') errors.push(value.params); const wait = pending.get(value.id); if (wait) { clearTimeout(wait.timer); pending.delete(value.id); if (value.error) wait.reject(value.error); else wait.resolve(value.result); } });
  await send('Runtime.enable'); await send('Page.enable'); await until('Boolean(window.signal && document.querySelector(".sidebar"))');

  const results=[];
  const screens=['Operations','Sales','Growth workspace','Creative studio','Connections','Analytics','Revenue','Settings','Marketing agent','Review queue'];
  for (const width of [1440, 960, 720, 480]) {
    await send('Emulation.setDeviceMetricsOverride', {width, height:900, deviceScaleFactor:1, mobile:false});
    for (const screen of screens) {
      await evaluate('document.querySelector(".nav-list").scrollTop=0');
      await click(screen);
      await until('Boolean(document.querySelector(".page h1, .main-fill .empty, .queue-header, .queue-page"))');
      await pause(650);
      const layout=await evaluate(`(() => {
        const root=document.querySelector('.main-scroll')??document.querySelector('.main-fill');
        const checkboxes=[...document.querySelectorAll('input[type=checkbox]')].filter(e=>e.getClientRects().length);
        return {overflow:root.scrollWidth>root.clientWidth+1,checkboxWidths:checkboxes.map(e=>e.getBoundingClientRect().width),headings:[...document.querySelectorAll('.page h2')].filter(e=>e.getClientRects().length).map(e=>parseFloat(getComputedStyle(e).fontSize))};
      })()`);
      if(layout.overflow) throw Error(screen+' content overflows at '+width);
      if(layout.checkboxWidths.some(w=>w>20)) throw Error(screen+' stretched checkbox at '+width);
      if(layout.headings.some(s=>s>22)) throw Error(screen+' oversized section heading');
      results.push({screen,width,...layout});
      if(width===1440||width===720) await screenshot(screen.toLowerCase().replaceAll(' ','-')+'-'+width);
    }
  }
  await send('Emulation.setDeviceMetricsOverride', {width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await click('Operations'); await until('Boolean(document.querySelector(".operation-policy"))');
  if(!await evaluate('document.querySelector("#operation-panel-overview").hidden===false && document.querySelector("#operation-panel-settings").hidden')) throw Error('Overview should be the only default view');
  await click('Operating settings');
  await evaluate(`(() => {const e=document.querySelector('.operation-policy textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Unsaved UI review objective');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('Research'); await click('Operating settings');
  if(!await evaluate('document.querySelector(".operation-policy textarea").value==="Unsaved UI review objective"')) throw Error('View switching lost draft settings');
  await evaluate('document.querySelector("#operation-tab-settings").focus()');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Home',code:'Home'});
  await until('document.activeElement.id==="operation-tab-overview" && !document.querySelector("#operation-panel-overview").hidden');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'});
  await until('document.activeElement.id==="operation-tab-research" && !document.querySelector("#operation-panel-research").hidden');
  for(const section of ['Overview','Research','Conversations','Operating settings']) {await click(section); await screenshot('operations-'+section.toLowerCase().replaceAll(' ','-'));}
  await evaluate('document.querySelector("#operation-tab-deliveries").click()'); await screenshot('operations-deliveries');
  await click('Conversations');
  await until('document.querySelector(".operation-conversations").textContent.includes("1 active public conversations")');
  if(await evaluate('document.querySelector(".operation-conversations").textContent.includes("Earlier reply, now unavailable")')) throw Error('Archived conversation shown as active');
  await click('Stop tracking');
  await until('document.querySelector(".operation-conversations").textContent.includes("0 active public conversations")');
  await evaluate('document.querySelector(".operation-conversations input[type=checkbox]").click()');
  await until('document.querySelectorAll(".conversation-thread").length===2');
  await click('Resume tracking');
  await until('document.querySelector(".operation-conversations").textContent.includes("1 active public conversations")');
  await screenshot('conversation-archive-controls');
  await click('Overview');
  await evaluate('document.querySelector(".operation-channel-tests").scrollIntoView()');
  if(!await evaluate('document.querySelectorAll(".channel-guidance details").length===19')) throw Error('Missing channel instructions');
  await screenshot('marketing-plan');
  await click('Set separate reply limit');
  await until('!document.querySelector("#operation-panel-settings").hidden');
  await click('Overview'); await click('Open Sales and lead sources');
  await until('document.querySelector(".page h1")?.textContent.includes("Sales")');
  await click('Sales');
  await until('Boolean(document.querySelector("#sales-panel-prospects"))');
  if(!await evaluate('document.querySelector("#sales-panel-prospects").textContent.includes("LTD partner submission") && !document.querySelector("#sales-panel-prospects").hidden')) throw Error('Saved leads not visible by default');
  if(!await evaluate('[...document.querySelectorAll("#sales-panel-prospects button")].some(e=>e.textContent==="Draft follow-up pitch")')) throw Error('Saved contacts need a drafting action');
  await click('View and edit pitch');
  await until('Boolean([...document.querySelectorAll("#sales-panel-prospects textarea")].find(e=>e.getClientRects().length && e.value.includes("We build Lemonade")))');
  if(!await evaluate('[...document.querySelectorAll("#sales-panel-prospects button")].some(e=>e.getClientRects().length && e.textContent==="Approve and queue this email")')) throw Error('Inline pitch has no outreach action');
  await evaluate(`(() => {const e=[...document.querySelectorAll('#sales-panel-prospects .prospect-draft textarea')].find(e=>e.getClientRects().length);Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'An unsaved pitch edit from the prospect card.');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await evaluate('document.querySelector("#sales-tab-drafts").click()');
  await evaluate('document.querySelector("#sales-tab-prospects").click()');
  if(!await evaluate('document.querySelector("#sales-panel-prospects .prospect-draft textarea").value==="An unsaved pitch edit from the prospect card."')) throw Error('Switching tabs lost the prospect pitch');
  for(const width of [1440,720,480]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await evaluate('document.querySelector("#sales-panel-prospects .prospect-draft").scrollIntoView()');
    if(await evaluate('document.querySelector(".main-scroll").scrollWidth>document.querySelector(".main-scroll").clientWidth+1')) throw Error('Inline prospect pitch overflows');
    await screenshot('prospect-pitch-'+width);
  }
  await click('Close pitch'); await click('View and edit pitch');
  if(!await evaluate('document.querySelector("#sales-panel-prospects .prospect-draft textarea").value==="An unsaved pitch edit from the prospect card."')) throw Error('Closing the pitch lost its unsaved text');
  for(const width of [1440,720,480]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await evaluate('document.querySelector("#sales-tab-drafts").click()');
    await until('!document.querySelector("#sales-panel-drafts").hidden');
    if(!await evaluate('document.querySelectorAll("#sales-panel-drafts .prospect-draft").length===4')) throw Error('Missing research drafts');
    if(!await evaluate('[...document.querySelectorAll("#sales-panel-drafts .prospect-draft button")].some(e=>e.textContent==="Copy message for contact form")')) throw Error('Missing contact-form handoff');
    if(await evaluate('document.querySelector(".main-scroll").scrollWidth>document.querySelector(".main-scroll").clientWidth+1')) throw Error('Draft queue overflows');
    await evaluate('document.querySelector("#sales-panel-drafts .prospect-draft").scrollIntoView()');await screenshot('sales-drafts-'+width);
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate('document.querySelector("#sales-tab-setup").click()');await screenshot('sales-setup');
  await evaluate('document.querySelector("#sales-tab-conversations").click()');await screenshot('sales-conversations');
  await click('Advanced tools');
  for(const screen of ['Engineering requests','Growth lab','Opportunities','Scoring','Guardrails','Experiment results','Growth digest','System']) {await click(screen); await pause(300);}
  await send('Emulation.setDeviceMetricsOverride', {width:720,height:550,deviceScaleFactor:1,mobile:false});
  if(!await evaluate(`(() => {const nav=document.querySelector('.nav-list');const button=document.querySelector('[aria-label="System"]');button.scrollIntoView();const b=button.getBoundingClientRect(),n=nav.getBoundingClientRect();return b.top>=n.top&&b.bottom<=n.bottom+1;})()`)) throw Error('Advanced navigation unreachable in short window');
  const keyboard=await evaluate(`(() => {const button=document.querySelector('[aria-label="Settings"]');button.focus();return getComputedStyle(button).outlineStyle;})()`);
  if(keyboard==='none') throw Error('Keyboard focus missing');
  if(errors.length) throw Error('Renderer errors: '+JSON.stringify(errors));
  writeFileSync(join(folder,'workspace-ui.json'),JSON.stringify({ok:true,results,draftPreserved:true,keyboardTabs:true,advancedNavigation:true,rendererErrors:errors.length},null,2));
  console.log(JSON.stringify({ok:true,screenSizeChecks:results.length,draftPreserved:true,keyboardTabs:true,advancedNavigation:true,rendererErrors:errors.length}));
} finally { socket?.close(); child.kill(); writeFileSync(join(folder, 'operations-ui.log'), logs); }
