/* global fetch, WebSocket, setTimeout, clearTimeout */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const traffic = process.env.SIGNAL_TRAFFIC_FIXTURE === '1';
const conversations = process.env.SIGNAL_CONVERSATION_FIXTURE === '1';
const folder = resolve('data/operations-validation'); mkdirSync(folder, { recursive: true });
const profile = join(folder, `profile-${Date.now()}`); mkdirSync(profile);
const env = { ...process.env, SIGNAL_DATABASE_URL: join(profile, 'fixture.db'), SIGNAL_OFFLINE: '1', SIGNAL_PROFILE_DIR: profile, SIGNAL_UI_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const seeded = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/operations-ui-fixture.ts'], { env, encoding: 'utf8', windowsHide: true });
if (seeded.status !== 0) throw new Error(seeded.stderr || seeded.stdout);
const child = spawn(process.argv[2] ?? require('electron'), [...(process.argv[2] ? [] : ['.']), '--remote-debugging-port=9340', '--disable-gpu'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', value => { logs += value; }); child.stderr.on('data', value => { logs += value; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)); let socket; let seq = 0; const pending = new Map(); const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; }
async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`Condition failed: ${expression}`); }
async function click(text) { if (!await evaluate(`(() => {const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});el?.click();return !!el;})()`)) throw new Error(`Button missing: ${text}`); await pause(250); }
async function screenshot(name) { const result = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(folder, `${name}.png`), Buffer.from(result.data, 'base64')); }
try {
  let target;
  for (let i = 0; i < 100; i++) { try { target = (await fetch('http://127.0.0.1:9340/json').then(r => r.json())).find(t => t.type === 'page'); if (target) break; } catch { /* starting */ } await pause(200); }
  if (!target) throw new Error(logs);
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.method === 'Runtime.exceptionThrown') errors.push(value.params); const wait = pending.get(value.id); if (wait) { clearTimeout(wait.timer); pending.delete(value.id); if (value.error) wait.reject(value.error); else wait.resolve(value.result); } });
  await send('Runtime.enable'); await send('Page.enable'); await until('Boolean(window.signal && document.querySelector(".sidebar"))');
  await click('Operations'); await until('Boolean(document.querySelector(".operation-policy"))');
  if (conversations) {
    await click('Conversations');
    await until('document.querySelector(".operation-conversations")?.textContent.includes("Can I compare PDF and Word files together?")');
    await evaluate('document.querySelector(".operation-conversations").scrollIntoView()');
    await screenshot('conversations-desktop');
    await click('Mark shown responses reviewed');
    await until('document.querySelector(".operation-conversations")?.textContent.includes("0 responses to review")');
    if (!await evaluate('document.querySelector(".operation-conversations")?.textContent.includes("no longer available publicly")')) throw new Error('Removed thread status missing');
    await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 800, deviceScaleFactor: 1, mobile: false });
    await evaluate('document.querySelector(".operation-conversations").scrollIntoView()');
    await screenshot('conversations-small');
    if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Conversation horizontal overflow');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  }
  await click('Research');
  if (!await evaluate(`(() => {const button=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Research now');return button?.disabled===true;})()`)) throw new Error('Offline public research control missing or enabled');
  if (!await evaluate(`window.signal.operations().then(v=>window.signal.operationAction({type:'research',productId:v.products[0].id}).then(()=>false).catch(e=>String(e).includes('offline')))`)) throw new Error('Offline research request was not blocked');
  await evaluate(`document.querySelector('.operation-discovery').previousElementSibling.scrollIntoView()`); await screenshot('research-before-run');
  await click('Operating settings');
  if (!await evaluate(`(() => {const rows=[...document.querySelectorAll('.operation-account')];return rows.find(r=>r.textContent.includes('LinkedIn read-only fixture'))?.querySelector('input').disabled && rows.find(r=>r.textContent.includes('LinkedIn publishing fixture'))?.querySelector('input').disabled===false;})()`)) throw new Error('LinkedIn publishing permission is not shown correctly');
  await evaluate(`document.querySelector('.operation-policy').scrollIntoView()`); await screenshot('linkedin-destinations');
  if (!await evaluate(`(() => {const rows=[...document.querySelectorAll('.operation-account')];return rows.find(r=>r.textContent.includes('X read-only fixture'))?.querySelector('input').disabled && rows.find(r=>r.textContent.includes('X publishing fixture'))?.querySelector('input').disabled===false;})()`)) throw new Error('X publishing permission is not shown correctly');
  await screenshot('social-destinations');
  if (!await evaluate(`(() => {const rows=[...document.querySelectorAll('.operation-account')];return rows.find(r=>r.textContent.includes('Facebook read-only fixture'))?.querySelector('input').disabled && rows.find(r=>r.textContent.includes('Facebook publishing fixture'))?.querySelector('input').disabled===false;})()`)) throw new Error('Facebook publishing capability is not shown correctly');
  await screenshot('facebook-destinations');
  await click('Overview');
  await until(`document.querySelector('.operation-learning')?.textContent.includes(${JSON.stringify(traffic ? 'Test visitor interest' : 'Rotate destinations')})`);
  await evaluate('document.querySelector(".operation-learning details").open=true; document.querySelector(".operation-learning").scrollIntoView()'); await screenshot('operations-learning-desktop' + (traffic ? '-traffic' : ''));
  if (traffic) {
    if (!await evaluate(`(() => {const table=document.querySelector('.operation-evidence-table');return table?.textContent.includes('60') && table.textContent.includes('35') && table.textContent.includes('Unknown');})()`)) throw new Error('Traffic evidence or unknown observations missing');
    await evaluate('document.querySelector(".operation-traffic").scrollIntoView()'); await screenshot('traffic-evidence-desktop');
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 800, deviceScaleFactor: 1, mobile: false }); await screenshot('operations-learning-small' + (traffic ? '-traffic' : ''));
  if (traffic) { await evaluate('document.querySelector(".operation-traffic").scrollIntoView()'); await screenshot('traffic-evidence-small'); }
  if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Learning explanation overflows');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  if (!await evaluate('document.querySelector(".operations-page").textContent.includes("up to 2 scheduled follow-ups")')) throw new Error('Run does not show the enabled follow-up policy');
  const disabled = await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent=== "Run operation").disabled'); if (!disabled) throw new Error('Run must be disabled offline');
  await click('Operating settings');
  await evaluate(`(() => {const e=document.querySelector('.operation-policy textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Show buyers how to verify a document answer against its original source.');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  if (!await evaluate('document.querySelector(".operation-discovery-toggle input").checked && document.querySelector("textarea[aria-label]").value.includes("local AI assistant")')) throw new Error('Saved public search settings missing');
  await click('Research');
  await evaluate('document.querySelectorAll(".operation-discovery details").forEach(d=>d.open=true); document.querySelector(".operation-discovery").scrollIntoView()'); await screenshot('discovery-desktop');
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 800, deviceScaleFactor: 1, mobile: false }); await evaluate('document.querySelector(".operation-discovery").scrollIntoView()'); await screenshot('discovery-small');
  if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Discovery findings overflow');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await click('Operating settings');
  await click('Save operating settings'); await until('window.signal.operations().then(v=>v.states[0].objective.startsWith("Show buyers"))');
  await until('!document.querySelector(".operation-learning")');
  await screenshot('operations-desktop'); await evaluate('location.reload()'); await until('document.querySelector(".operation-policy textarea")?.value.startsWith("Show buyers")');
  await click('Operating settings');
  await evaluate(`(() => { const e=document.querySelector('[aria-label="Operating approach"]'); e.value='acquisition'; e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await evaluate(`(() => { const e=[...document.querySelectorAll('.operation-policy label')].find(e=>e.textContent.includes('Reply to relevant public requests')); e.querySelector('input').click(); const account=[...document.querySelectorAll('.operation-account')].find(e=>e.textContent.includes('Bluesky publishing fixture')); account.querySelector('input').click(); const queries=document.querySelector('textarea[aria-label]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(queries,'hn:local AI assistant\\nbluesky:recommend PDF'); queries.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await evaluate(`(() => {const label=[...document.querySelectorAll('.operation-policy label')].find(e=>e.textContent.includes('Test all selected channels'));label.querySelector('input').click();})()`);
  await evaluate(`(() => { const e=document.querySelector('[aria-label="Daily qualified public replies"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'5'); e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await click('Save operating settings');
  await until('window.signal.operations().then(v=>v.states[0].publicReplyLimit===5 && v.states[0].testChannels && v.states[0].replyToRequests && v.states[0].discovery.queries.some(q=>q.kind==="bluesky"))');
  await until('Boolean(document.querySelector(".acquisition-intake-form"))');
  await until('Boolean(document.querySelector(".operation-channel-tests"))');
  if (!await evaluate('document.querySelectorAll(".operation-channel-tests details .conversation-message").length === 19')) throw new Error('Channel inventory incomplete');
  await click('Overview');
  await evaluate('document.querySelector(".operation-channel-tests").scrollIntoView()'); await screenshot('channel-tests-desktop');
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 800, deviceScaleFactor: 1, mobile: false });
  await evaluate('document.querySelector(".operation-channel-tests").scrollIntoView()'); await screenshot('channel-tests-small');
  if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Channel tests overflow');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await click('Research');
  if (!await evaluate(`document.querySelector('[aria-label="Initial response inbox"]').selectedOptions[0].textContent.includes('sales@example.com')`)) throw new Error('Initial responses do not show the business sender alias');
  if (!await evaluate(`!document.querySelector('.acquisition-intake-form').checkValidity()`)) throw new Error('Missing mailing address was accepted');
  await evaluate(`(() => { const e=document.querySelector('[aria-label="Initial response mailing address"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'100 Test Street, Example City, CA 90000'); e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await click('Enable initial responses');
  await until(`document.querySelector('.acquisition-intake').textContent.includes('Initial responses are enabled from sales@example.com')`);
  if (!await evaluate(`window.signal.outreach().then(v=>v.jobs.length===0 && v.policies.filter(p=>p.enabled).length===1)`)) throw new Error('Saving intake caused work or crossed businesses');
  if (!await evaluate(`document.querySelector('[aria-label="Customer acquisition progress"]').textContent.includes('Starting without a following') && [...document.querySelectorAll('button')].find(b=>b.textContent==='Run marketing')?.disabled`)) throw new Error('Acquisition mode or offline Run control missing');
  await evaluate(`document.querySelector('[aria-label="Customer acquisition progress"]').scrollIntoView()`); await screenshot('acquisition-desktop');
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 800, deviceScaleFactor: 1, mobile: false }); await screenshot('acquisition-small');
  if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Acquisition flow overflows');
  if (!await evaluate(`document.querySelector('[aria-label="Marketing progress"]')?.textContent.includes('Public replies sent')`)) throw new Error('Marketing progress missing');
  await click('Overview');
  await evaluate(`document.querySelector('[aria-label="Marketing progress"]').scrollIntoView()`); await screenshot('marketing-progress-small');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.querySelector('[aria-label="Marketing progress"]').scrollIntoView()`); await screenshot('marketing-progress-desktop');
  await evaluate('location.reload()'); await until(`document.querySelector('.acquisition-intake')?.textContent.includes('Initial responses are enabled from sales@example.com')`);
  await evaluate(`(() => {const e=document.querySelector('[aria-label="Operations business"]');e.value=[...e.options].find(o=>o.text==='CineGen').value;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until('document.querySelectorAll(".operation-account").length===0');
  if (conversations && await evaluate('document.querySelector(".operation-conversations")?.textContent.includes("Can I compare PDF and Word files together?")')) throw new Error('Conversations crossed businesses');
  if (await evaluate('document.querySelector(".operation-discovery-toggle input").checked || Boolean(document.querySelector(".operation-discovery"))')) throw new Error('Research leaked across businesses');
  await click('Operating settings');
  await evaluate('document.querySelector(".operation-discovery-toggle input").click()'); await until('Boolean(document.querySelector("textarea[aria-label]"))');
  if (!await evaluate('document.querySelector("textarea[aria-label]").value.includes("video editing")')) throw new Error('CineGen suggestions missing');
  await click('Save operating settings'); await until('window.signal.operations().then(v=>v.states.find(s=>v.products.find(p=>p.id===s.productId)?.name==="CineGen").discovery?.enabled)');
  await evaluate('document.querySelector(".operation-discovery-toggle input").click()'); await click('Save operating settings');
  await until('window.signal.operations().then(v=>!v.states.find(s=>v.products.find(p=>p.id===s.productId)?.name==="CineGen").discovery)');
  if (await evaluate('document.querySelector(".operations-page").textContent.includes("Automatic Gmail replies enabled")')) throw new Error('Reply policy crossed business boundary');
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 800, deviceScaleFactor: 1, mobile: false }); await screenshot('operations-small');
  if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Horizontal overflow');
  const result = await evaluate('window.signal.operations().then(v=>({running:v.states.some(s=>s.running),deliveries:v.deliveries.length}))');
  if (result.running || result.deliveries !== (conversations ? 2 : 0) || errors.length) throw new Error('Unexpected operation or renderer errors');
  console.log(JSON.stringify({ ok: true, offlineRunBlocked: true, businessIsolation: true, settingsPersisted: true, viewports: ['1440x900', '720x800'], rendererErrors: errors.length }));
} finally { socket?.close(); child.kill(); writeFileSync(join(folder, 'operations-ui.log'), logs); }
