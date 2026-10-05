/* global fetch, WebSocket, setTimeout, clearTimeout */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const folder = resolve('data/outreach-validation'); mkdirSync(folder, { recursive: true });
const profile = join(folder, `profile-${Date.now()}`); mkdirSync(profile);
const env = { ...process.env, SIGNAL_DATABASE_URL: join(profile, 'fixture.db'), SIGNAL_OFFLINE: '1', SIGNAL_PROFILE_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
const seeded = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/outreach-ui-fixture.ts'], { env, encoding: 'utf8', windowsHide: true });
if (seeded.status !== 0) throw new Error(seeded.stderr || seeded.stdout);
const child = spawn(process.argv[2] ?? require('electron'), [...(process.argv[2] ? [] : ['.']), '--remote-debugging-port=9349', '--disable-gpu'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', value => { logs += value; }); child.stderr.on('data', value => { logs += value; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)); let socket; let seq = 0; const pending = new Map(); const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; }
async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`Condition failed: ${expression}`); }
async function click(text) { if (!await evaluate(`(() => {const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});el?.click();return !!el;})()`)) throw new Error(`Button missing: ${text}`); await pause(250); }
async function screenshot(name) { const result = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(folder, `${name}.png`), Buffer.from(result.data, 'base64')); }
try {
  let target;
  for (let i = 0; i < 100; i++) { try { target = (await fetch('http://127.0.0.1:9349/json').then(r => r.json())).find(t => t.type === 'page'); if (target) break; } catch { /* starting */ } await pause(200); }
  if (!target) throw new Error(logs);
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.method === 'Runtime.exceptionThrown') errors.push(value.params); const wait = pending.get(value.id); if (wait) { clearTimeout(wait.timer); pending.delete(value.id); if (value.error) wait.reject(value.error); else wait.resolve(value.result); } });
  await send('Runtime.enable'); await send('Page.enable'); await until('Boolean(window.signal && document.querySelector(".sidebar"))');
  await click('Sales'); await until('Boolean(document.querySelector(".outreach-policy"))');
  await until('Boolean(document.querySelector(".prospect-policy"))');
  await until('Boolean(document.querySelector(".website-prospect-policy"))');
  if (!await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="Sync website requests").disabled')) throw new Error('Website reads must be blocked offline');
  await evaluate('document.querySelector(".website-prospect-policy").scrollIntoView()'); await screenshot('website-source-desktop');
  if (!await evaluate('[...document.querySelectorAll("button")].filter(b=>["Load audiences","Sync audience now"].includes(b.textContent)).every(b=>b.disabled)')) throw new Error('Audience reads must be blocked offline');
  await evaluate('document.querySelector(".prospect-source").scrollIntoView()'); await screenshot('prospect-source-desktop');
  await evaluate('document.querySelector(".lead-import").open=true');
  const csv = 'name,email,source,permission,consent,notes\nPat,imported@example.test,Signup form,opted-in,Marketing checkbox for Lemonade on 2026-09-15,Document search\nResearch,research@example.test,Conference,unknown,,Needs qualification';
  await evaluate(`(() => { const e=document.querySelector('[aria-label="Prospect CSV"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e, ${JSON.stringify(csv)}); e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await click('Preview prospects'); await until('document.querySelector(".lead-import-preview")?.textContent.includes("2 new prospects")');
  if (!await evaluate('window.signal.sales().then(v=>!v.leads.some(l=>l.value.contact==="imported@example.test"))')) throw new Error('Preview wrote a lead');
  await evaluate('document.querySelector(".lead-import-preview details").open=true; document.querySelector(".lead-import").scrollIntoView()'); await screenshot('prospect-import-desktop');
  await click('Import into Lemonade'); await until('document.querySelector(".lead-import-preview")?.textContent.includes("Import complete")');
  if (!await evaluate('window.signal.sales().then(v=>v.leads.some(l=>l.value.contact==="imported@example.test" && l.value.permission==="opted-in") && v.leads.some(l=>l.value.contact==="research@example.test" && l.value.permission==="unknown"))')) throw new Error('Import lost permissions');
  await click('Preview prospects'); await until('document.querySelector(".lead-import-preview")?.textContent.includes("2 existing contacts unchanged")');
  await evaluate('document.querySelector(".outreach-policy input[type=checkbox]").click()');
  await evaluate('(() => { const e=document.querySelectorAll(".outreach-policy select")[1]; e.value="2"; e.dispatchEvent(new Event("change",{bubbles:true})); })()');
  await click('Save outreach settings');
  await until('window.signal.outreach().then(v=>v.policies.some(p=>p.enabled && p.dailyLimit===2 && p.followUpDays.join() === "3,7"))');
  await evaluate('document.querySelector(".sales-outreach").scrollIntoView()'); await screenshot('outreach-desktop');
  await evaluate('location.reload()'); await until('document.querySelector(".outreach-policy input[type=checkbox]")?.checked');
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 800, deviceScaleFactor: 1, mobile: false });
  await evaluate('document.querySelector(".outreach-policy").scrollIntoView()'); await screenshot('outreach-small');
  await until('document.querySelectorAll(".outreach-policy select")[1]?.value === "2"');
  await evaluate('document.querySelector(".outreach-policy fieldset").scrollIntoView()'); await screenshot('outreach-followups-small');
  await until('document.querySelector(".outreach-sequence")?.textContent.includes("0 of 2 follow-ups confirmed")');
  await evaluate('document.querySelector(".outreach-sequence").scrollIntoView()'); await screenshot('outreach-sequence-small');
  await click('Stop this outreach sequence');
  await until('document.querySelector(".outreach-sequence")?.textContent.includes("The owner stopped this outreach sequence")');
  if (!await evaluate('window.signal.outreach().then(v=>v.sequences.some(s=>s.rootId==="fixture-sent" && s.status==="stopped" && s.nextAt===null))')) throw new Error('Sequence stop was not persisted');
  await evaluate('document.querySelector(".lead-import").open=true; document.querySelector(".lead-import").scrollIntoView()'); await screenshot('prospect-import-small');
  await evaluate('document.querySelector(".prospect-policy").scrollIntoView()'); await screenshot('prospect-source-small');
  await evaluate('document.querySelector(".website-prospect-policy").scrollIntoView()'); await screenshot('website-source-small');
  if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Outreach layout overflow');
  await click('Operations'); await until('document.body.innerText.includes("Proactive outreach enabled")');
  await until('document.body.innerText.includes("Automatic prospect ingestion enabled")');
  await until('document.body.innerText.includes("Run reads website requests Lemonade website requests")');
  await until('Boolean(document.querySelector(".operation-readiness"))');
  await evaluate('document.querySelectorAll(".operation-account input:checked").forEach(e=>e.click())'); await click('Save operating settings');
  await until('window.signal.operations().then(v=>v.states[0].accountIds.length===0 && v.readiness[0].activities.some(a=>a.label==="Initial outreach") && !v.readiness[0].activities.some(a=>a.label==="Publishing"))');
  await evaluate('document.querySelector(".operation-readiness").scrollIntoView()'); await screenshot('run-readiness-small');
  if (!await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="Run operation").disabled')) throw new Error('Run must be disabled offline');
  await click('Sales'); await until('Boolean(document.querySelector(".outreach-policy"))');
  await until('Boolean(document.querySelector(".prospect-policy"))'); await click('Disable prospect source');
  await until('window.signal.prospects().then(v=>v.sources.length===2 && !v.sources.find(s=>s.provider!=="signal-blog").enabled && v.sources.find(s=>s.provider==="signal-blog").enabled)');
  await click('Disable website source');
  await until('window.signal.prospects().then(v=>v.sources.length===2 && v.sources.every(s=>!s.enabled))');
  await evaluate(`(() => { const e=document.querySelector('[aria-label="Sales business"]'); e.value=[...e.options].find(o=>o.text==='CineGen').value; e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await until('document.querySelectorAll(".sales-source").length===0 && !document.querySelector(".outreach-policy input[type=checkbox]")?.checked');
  if (!await evaluate('document.querySelectorAll(".outreach-policy select")[1]?.value === "0"')) throw new Error('Follow-up policy crossed businesses');
  if (await evaluate('document.querySelector(".sales-outreach").textContent.includes("prospect@example.test")')) throw new Error('Outreach crossed businesses');
  if (await evaluate('document.querySelector(".lead-import textarea").value || document.querySelector(".lead-import-preview") || document.querySelector(".sales-outreach").textContent.includes("imported@example.test")')) throw new Error('Import crossed businesses');
  if (await evaluate('document.querySelector(".prospect-source").textContent.includes("Lemonade signups")')) throw new Error('Audience crossed businesses');
  if (await evaluate('document.querySelector(".website-prospect-policy").textContent.includes("Lemonade website requests") || document.querySelector(".website-prospect-policy select").value')) throw new Error('Website source crossed businesses');
  if (errors.length) throw new Error('Renderer errors');
  console.log(JSON.stringify({ ok: true, settingsPersisted: true, followUpSettingsPersisted: true, sequenceProgressVisible: true, sequenceStopPersisted: true, publishingOptional: true, runReadinessVisible: true, prospectImport: true, audienceReadsBlockedOffline: true, audienceDisabled: true, audienceRunScopeVisible: true, importPreviewReadOnly: true, importDeduplicated: true, permissionsPreserved: true, runPolicyVisible: true, offlineRunBlocked: true, businessIsolation: true, viewports: ['1440x900','720x800'], rendererErrors: errors.length }));
} finally { socket?.close(); child.kill(); writeFileSync(join(folder,'outreach-ui.log'),logs); }
