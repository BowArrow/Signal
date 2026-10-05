/* global fetch, WebSocket, setTimeout, clearTimeout */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const folder = resolve('data/video-validation'); mkdirSync(folder, { recursive: true });
const stamp = Date.now(); const database = resolve(folder, `ui-${stamp}.db`);
const env = { ...process.env, SIGNAL_DATABASE_URL: database, SIGNAL_OFFLINE: '1', SIGNAL_PROFILE_DIR: resolve(folder, `profile-${stamp}`) }; delete env.ELECTRON_RUN_AS_NODE;
const fixture = spawnSync(process.execPath, [require.resolve('tsx/cli'), 'scripts/studio-ui-fixture.ts', database], { env, encoding: 'utf8', windowsHide: true });
if (fixture.status) throw new Error(fixture.stderr || fixture.stdout);
const adFfmpeg = process.argv[3]?.startsWith('--') ? undefined : process.argv[3]; const useNarration = process.argv.includes('--audio');
if (adFfmpeg) {
  const seed = spawnSync(process.execPath, [require.resolve('tsx/cli'), 'scripts/video-ad-ui-fixture.ts', database, env.SIGNAL_PROFILE_DIR, adFfmpeg], { env, encoding: 'utf8', windowsHide: true });
  if (seed.status) throw new Error(seed.stderr || seed.stdout);
}
const targetApp = process.argv[2] === '--dev' ? undefined : process.argv[2];
const child = spawn(targetApp ?? require('electron'), [...(targetApp ? [] : ['.']), '--disable-gpu', '--remote-debugging-port=9361', `--user-data-dir=${folder}/profile-${stamp}`], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms)); let socket; let seq = 0; const waiting = new Map(); const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 20000); waiting.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; }
async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(100); } throw new Error(`Condition failed: ${expression}`); }
async function click(label) { if (!await evaluate(`(() => { const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}); e?.click(); return !!e; })()`)) throw new Error(`Missing button: ${label}`); await delay(200); }
async function screenshot(name) { const result = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(resolve(folder, `${name}.png`), Buffer.from(result.data, 'base64')); }
try {
  let target;
  for (let i = 0; i < 100; i++) { try { const targets = await fetch('http://127.0.0.1:9361/json').then(r => r.json()); target = targets.find(t => t.type === 'page'); if (target) break; } catch { /* launching */ } await delay(200); }
  if (!target) throw new Error(logs);
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails); const waiter = waiting.get(message.id); if (waiter) { clearTimeout(waiter.timer); waiting.delete(message.id); if (message.error) waiter.reject(message.error); else waiter.resolve(message.result); } });
  await send('Runtime.enable'); await send('Page.enable');
  await until('Boolean(window.signal && document.querySelector(".sidebar"))');
  await click('Creative studio'); await until('Boolean(document.querySelector(".video-production"))');
  await evaluate('document.querySelector(".video-production details").open=true');
  if (!await evaluate('document.querySelector(".video-production select").value === "local"')) throw new Error('Local rendering should be the default');
  await click('Save video settings');
  const state = await evaluate('window.signal.video()');
  if (process.argv.includes('--expect-h3-hold')) {
    if (!state.localRenderHold?.includes('unexpected Windows restart')) throw new Error('H3 incident hold missing from app');
    if (!await evaluate('document.querySelector(".video-production").textContent.includes("Local H3 rendering is paused")')) throw new Error('H3 incident hold missing from studio');
    const check = await evaluate('window.signal.videoAction({type:"check-local"})');
    if (check.local.ready || !check.local.detail.includes('unexpected Windows restart')) throw new Error('Local setup bypassed the H3 hold');
  }
  if (state.config.renderer !== 'local' || state.config.localProfile !== 'mick4' || state.config.localCheckpoint !== 'w4a8') throw new Error('Local preset did not persist');
  if (state.config.h3DailyBudgetUsd !== 0 || state.config.h3MaxShotUsd !== 0 || state.config.agentCloudEnabled) throw new Error('Cloud spending should require saved owner settings');
  await evaluate('document.querySelector(".video-production").scrollIntoView()'); await screenshot('video-desktop');
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 900, deviceScaleFactor: 1, mobile: false }); await screenshot('video-small');
  if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Video layout overflow');
  await evaluate('(()=>{const e=document.querySelector("select[aria-label=\\"Video renderer\\"]");e.value="cloud";e.dispatchEvent(new Event("change",{bubbles:true}));})()');
  if (!await evaluate('document.querySelector(".video-production").textContent.includes("H3 maximum estimated cost per shot")')) throw new Error('Cloud budget controls missing');
  await evaluate('(()=>{const e=[...document.querySelectorAll(".video-production label")].find(e=>e.textContent.includes("H3 estimated budget per"));e.scrollIntoView()})()'); await screenshot('cloud-budget-small');
  if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Cloud budget layout overflow');
  if (process.argv.includes('--expect-campaigns')) {
    await evaluate('document.querySelector(".video-campaigns").open=true');
    await evaluate('document.querySelector(".video-campaigns").scrollIntoView()'); await screenshot('video-campaign-small');
    if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Video schedule layout overflow');
    await click('Save video production schedule');
    if (!await evaluate('window.signal.video().then(v=>v.campaigns.policies.every(p=>!p.enabled))')) throw new Error('Saving disabled schedules enabled production');
    await delay(2200);
    if (await evaluate('document.querySelectorAll(".video-campaigns").length') !== 1) throw new Error('Duplicate automatic production panels');
  }
  if (adFfmpeg) {
    await evaluate('document.querySelector(".video-ad-editor").open=true');
    await click('Add approved clip');
    if (!await evaluate('document.querySelector(".video-ad-editor").textContent.includes("Synthetic editing fixture")')) throw new Error('Approved footage missing from editor');
    await evaluate('document.querySelector(".video-ad-editor").scrollIntoView()'); await screenshot('ad-editor-small');
    if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Ad editor layout overflow');
    if (useNarration) {
      if (!await evaluate('window.signal.video().then(v=>v.narrationReady)')) throw new Error('Local narration is not installed');
      await evaluate('(()=>{const label=[...document.querySelectorAll(".video-ad-editor label")].find(e=>e.textContent.includes("Generate local narration"));label.querySelector("input").click()})()');
      if (!await evaluate('Boolean(document.querySelector(".video-ad-editor textarea"))')) throw new Error('Narration controls did not open');
      await evaluate('document.querySelector(".video-ad-editor textarea").scrollIntoView()'); await screenshot('narration-controls');
    }
    const ad = await evaluate('window.signal.video().then(async v=>{const source=v.jobs.find(j=>j.id==="ad-source-fixture");const r=await window.signal.videoAction({type:"assemble",productId:source.productId,value:{title:"UI ad fixture",ratio:"9:16",clips:[{jobId:source.id,start:0,duration:2,caption:"Local editing fixture"}],headline:"Example end card",callToAction:"See the example",destination:"https://siplemona.de/get-started",...'+(useNarration ? '{narration:{text:"An example edit.",voice:"af_heart",speed:1,start:0,captions:true},music:{trackId:"music-fixture",gainDb:-22}}' : '{}')+'}});return r.view.jobs.find(j=>j.kind==="ad")})');
    await until('window.signal.video().then(v=>v.jobs.some(j=>j.id==='+JSON.stringify(ad.id)+' && j.output && j.phase==="attention"))');
    const savedAd = await evaluate('window.signal.video().then(v=>v.jobs.find(j=>j.id==='+JSON.stringify(ad.id)+'))');
    writeFileSync(resolve(folder,'ad-ui-result.json'),JSON.stringify({fixtureOnly:true,profile:env.SIGNAL_PROFILE_DIR,job:savedAd},null,2));
    const preview = await evaluate('window.signal.videoPreview('+JSON.stringify(ad.productId)+','+JSON.stringify(ad.id)+',"output")');
    if (preview.mime!=='video/mp4' || !preview.dataUrl.startsWith('data:video/mp4;base64,')) throw new Error('Ad preview missing');
    await evaluate('window.signal.videoAction({type:"approve-clip",productId:'+JSON.stringify(ad.productId)+',id:'+JSON.stringify(ad.id)+'})');
    if (!await evaluate('window.signal.video().then(v=>v.jobs.some(j=>j.id==='+JSON.stringify(ad.id)+' && j.phase==="ready" && j.approvedAt))')) throw new Error('Ad approval not persisted');
    await evaluate('document.querySelector(".youtube-publishing").open=true');
    await until('Boolean([...document.querySelectorAll(".youtube-publishing button")].find(e=>e.textContent==="Queue approved ad for YouTube"))');
    await click('Queue approved ad for YouTube');
    await until('document.querySelector(".youtube-publishing").textContent.includes("UI ad fixture · queued")');
    const publishing = await evaluate('window.signal.video().then(v=>v.publishing)');
    if (publishing.jobs.length !== 1 || publishing.jobs[0].startedAt !== undefined || publishing.jobs[0].privacy !== 'private') throw new Error('Offline fixture must queue without uploading');
    await evaluate('document.querySelector(".youtube-publishing").scrollIntoView()'); await screenshot('youtube-small');
    if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('YouTube panel overflow');
    await click('Stop this upload');
    await until('document.querySelector(".youtube-publishing").textContent.includes("Cancelled before upload.")');
    await send('Emulation.setDeviceMetricsOverride', {width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await screenshot('ad-editor-desktop');
    await evaluate('document.querySelector(".youtube-publishing").scrollIntoView()'); await screenshot('youtube-desktop');
  }
  const result = await evaluate('window.signal.marketing().then(v=>v.products.map(p=>p.id))');
  await evaluate('window.signal.videoAction({type:"bible", productId:'+JSON.stringify(result[0])+',value:{premise:"Find the answer in your own files.",audience:"Busy small teams",visualStyle:"Natural warm office photography.",world:"Everyday workspace with afternoon sunlight.",rules:"Keep the same blue wardrobe."}})');
  for (let i=0;i<4;i++) { const id=result[(i+1)%2]; await evaluate('(()=>{const e=document.querySelector(".page-head select");e.value='+JSON.stringify(id)+';e.dispatchEvent(new Event("change",{bubbles:true}));})()'); await delay(300); if (await evaluate('document.querySelectorAll(".video-production").length')!==1) throw new Error('Duplicate video panel'); }
  if (errors.length) throw new Error(JSON.stringify(errors));
  const summary = {ok:true,startedAt:stamp,finishedAt:Date.now(),target:targetApp ?? 'development',h3HoldChecked:process.argv.includes('--expect-h3-hold'),cloudBudgets:true,localDefault:true,mickPresetSaved:true,businessSwitching:true,viewports:['1440x900','720x900'],rendererErrors:errors.length,adEditing: Boolean(adFfmpeg),narration:useNarration};
  writeFileSync(resolve(folder, 'ui-result.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary));
} finally { socket?.close(); child.kill(); writeFileSync(resolve(folder, 'ui.log'), logs); }
