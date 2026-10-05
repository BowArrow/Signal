/* global fetch, WebSocket, setTimeout, clearTimeout */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const outlook = process.argv[3] === 'outlook';
const folder = resolve(outlook ? 'data/sales-validation-outlook' : 'data/sales-validation'); mkdirSync(folder, { recursive: true });
const profile = join(folder, `profile-${Date.now()}`); mkdirSync(profile);
const env = { ...process.env, SIGNAL_DATABASE_URL: join(profile, 'fixture.db'), SIGNAL_OFFLINE: '1', SIGNAL_UI_INBOX_PROVIDER: outlook ? 'outlook' : 'gmail', SIGNAL_PROFILE_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
const seeded = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/sales-ui-fixture.ts'], { env, encoding: 'utf8', windowsHide: true }); if (seeded.status !== 0) throw new Error(seeded.stderr || seeded.stdout);
const child = spawn(process.argv[2] ?? require('electron'), [...(process.argv[2] ? [] : ['.']), '--disable-gpu', '--remote-debugging-port=9342'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', value => { logs += value; }); child.stderr.on('data', value => { logs += value; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)); let socket; let seq = 0; const pending = new Map(); const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; }
async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`Condition failed: ${expression}`); }
async function click(text) { if (!await evaluate(`(() => {const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});el?.click();return !!el;})()`)) throw new Error(`Button missing: ${text}`); await pause(250); }
async function screenshot(name) { const result = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(folder, `${name}.png`), Buffer.from(result.data, 'base64')); }
try {
  let target; for (let i = 0; i < 100; i++) { try { target = (await fetch('http://127.0.0.1:9342/json').then(r => r.json())).find(t => t.type === 'page'); if (target) break; } catch { /* starting */ } await pause(200); }
  if (!target) throw new Error(logs);
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.method === 'Runtime.exceptionThrown') errors.push(value.params); const wait = pending.get(value.id); if (wait) { clearTimeout(wait.timer); pending.delete(value.id); if (value.error) wait.reject(value.error); else wait.resolve(value.result); } });
  await send('Runtime.enable'); await send('Page.enable'); await until('Boolean(window.signal && document.querySelector(".sidebar"))');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await click('Sales'); await until('document.querySelectorAll(".sales-message").length===1');
  for (let i = 0; i < 6; i++) {
    const business = i % 2 === 0 ? 'CineGen' : 'Lemonade';
    await evaluate(`(() => {const e=document.querySelector('[aria-label="Sales business"]');e.value=[...e.options].find(o=>o.text===${JSON.stringify(business)}).value;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(`document.querySelectorAll('.sales-source').length === ${business === 'CineGen' ? 0 : 1}`);
    const handoffs = await evaluate('document.querySelectorAll(".sales-handoffs").length');
    if (handoffs !== 1) { await screenshot('handoffs-duplicated'); throw new Error(`Business switch ${i + 1} left ${handoffs} handoff sections`); }
    if (await evaluate('document.querySelectorAll(".sales-outreach").length') !== 1) throw new Error('Business switch duplicated or removed outreach');
    if (business === 'CineGen' && await evaluate('document.querySelector(".sales-page").textContent.includes("buyer@example.com")')) throw new Error('Business switch retained another business conversation');
  }
  await until('document.querySelectorAll(".sales-message").length===1');
  await pause(4500);
  if (await evaluate('document.querySelectorAll(".sales-handoffs").length') !== 1) throw new Error('Polling duplicated handoff sections');
  await screenshot('handoffs-after-switching');
  if (!await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="Sync inbox").disabled')) throw new Error('Offline inbox sync enabled');
  await screenshot('sales-desktop');
  await until('document.querySelectorAll(".sales-reply").length===1');
  await evaluate('document.querySelector(".sales-reply-policy").scrollIntoView()'); await screenshot('sales-replies');
  if (!await evaluate('[...document.querySelectorAll(".sales-reply button")].find(b=>b.textContent==="Prepare again").disabled')) throw new Error('Offline reply preparation enabled');
  await until('document.querySelectorAll(".sales-sequence").length===1');
  await evaluate('document.querySelector(".sales-sequence").scrollIntoView()'); await screenshot('sales-sequence');
  await click('Stop sequence'); await until('window.signal.salesReplies().then(v=>v.sequences[0].status==="stopped" && v.sequences[0].nextAt===null)');
  await click('Cancel reply'); await until('window.signal.salesReplies().then(v=>v.replies[0].status==="cancelled")');
  await evaluate(`document.querySelector('[aria-label="Enable sales follow-ups"]').click()`);
  await evaluate(`(() => {const e=document.querySelector('[aria-label="Sales follow-up days"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'1, 3'); e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  if (outlook) {
    if (!await evaluate('document.querySelector(".sales-reply-policy fieldset input").disabled === false && document.querySelector(".sales-reply-policy").innerText.includes("Lemonade Outlook inbox")')) throw new Error('Outlook permission eligibility failed');
    await evaluate('document.querySelector(".sales-reply-policy fieldset input").click()');
    await evaluate(`document.querySelector('[aria-label="Enable automatic email replies"]').click()`);
  }
  await click('Save reply policy'); await until(`window.signal.salesReplies().then(v=>v.policies.some(p=>p.revision===1 && p.enabled===${outlook} && JSON.stringify(p.followUpDays)==="[1,3]"))`);
  await evaluate('document.querySelector(".sales-message details").open=true');
  if (!await evaluate('document.querySelector(".sales-message .sales-body").textContent.includes("<script>") && document.querySelector(".sales-message .sales-body script")===null')) throw new Error('Message text must remain inert');
  await evaluate('document.querySelector(".sales-message").scrollIntoView()'); await screenshot('sales-conversation');
  await click('Add to pipeline'); await until('window.signal.sales().then(v=>v.leads.length===1 && v.messages[0].leadId!==null)');
  await click('Do not contact'); await until('window.signal.sales().then(v=>v.suppressions.length===1 && v.leads[0].value.permission==="do-not-contact")');
  await click('Mark reviewed'); await until('document.querySelectorAll(".sales-message").length===0');
  await evaluate('location.reload()'); await until('Boolean(document.querySelector(".sales-page"))');
  if (!await evaluate('window.signal.sales().then(v=>v.suppressions.length===1 && v.messages[0].reviewedAt!==null && v.leads[0].value.followUpAt===null)')) throw new Error('Sales state did not persist');
  await click('Edit inbox');
  if (!outlook) {
    await until(`Boolean(document.querySelector('[aria-label="Business sender address"]'))`);
    if (!await evaluate(`document.querySelector('[aria-label="Business sender address"]').value === ""`)) throw new Error('Existing inbox sender changed without selection');
    await evaluate('document.querySelector(".sales-sender").scrollIntoView()'); await screenshot('sales-sender-desktop');
    await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 800, deviceScaleFactor: 1, mobile: false }); await screenshot('sales-sender-small');
    if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Sender layout overflow');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  }
  await evaluate('document.querySelector(".operation-policy .sales-check input").click()'); await click('Save inbox monitoring');
  if (!await evaluate('window.signal.sales().then(v=>v.sources[0].autoSync===false && v.suppressions.length===1)')) throw new Error('Inbox policy edit failed');
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 800, deviceScaleFactor: 1, mobile: false }); await screenshot('sales-small');
  await evaluate('document.querySelector(".sales-reply-policy").scrollIntoView()'); await screenshot('sales-replies-small');
  if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Narrow layout overflow');
  await evaluate(`(() => {const e=document.querySelector('[aria-label="Sales business"]');e.value=[...e.options].find(o=>o.text==='CineGen').value;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until('document.querySelectorAll(".sales-source").length===0'); if (await evaluate('document.querySelector(".sales-page").textContent.includes("buyer@example.com")')) throw new Error('Conversation crossed business boundary');
  if (errors.length) throw new Error('Renderer exceptions');
  console.log(JSON.stringify({ ok: true, inbox: outlook ? 'outlook' : 'gmail', offlineReadsBlocked: true, messageHtmlInert: true, pipelineLinked: true, suppressionPersisted: true, businessIsolation: true, replyCancelled: true, replyPolicySaved: true, sequenceStopped: true, followUpTimingSaved: true, sourceEdited: true, viewports: ['1440x900', '720x800'], rendererErrors: errors.length }));
} finally { socket?.close(); child.kill(); writeFileSync(join(folder, 'ui.log'), logs); }
