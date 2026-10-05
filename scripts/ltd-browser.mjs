import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const folder = resolve('output/ltd-rollout'); mkdirSync(folder, { recursive: true });
const handoff = process.argv.includes('--handoff');
const submit = process.argv.includes('--submit');
if (handoff && process.argv[2] !== 'kenmoo') throw Error('Human handoff is only configured for KenMoo');
if (submit && process.argv[2] !== 'lifetimo') throw Error('Submission is only configured for Lifetimo');
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
  const urls = { kenmoo: 'https://kenmoo.me/contact/', lifetimo: 'https://lifetimo.com/contact-us/', ltdhunt: 'https://ltdhunt.com/contact', ltdhuntchat: 'https://webchat.missiveapp.com/2b3fceda-9598-4988-b60a-a9f097626175/webchat', preview: 'https://siplemona.de/ads/lemonade-ltd/?utm_source=lifetimo&utm_medium=community&utm_campaign=lemonade-ltd-lifetimo-20260921' };
  const key = process.argv[2]; if (!urls[key]) throw Error('Choose a known community');
  await cdp('Page.navigate', { url: urls[key] });
  for (let i = 0; i < 80; i++) { if (await ev('document.readyState === "complete"')) break; await delay(250); }
  await delay(3000);
  if (submit || handoff) {
    const draft = JSON.parse(readFileSync(join(folder, `${key}-request.json`), 'utf8'));
    const receiptPath = join(folder, `${key}-receipt.json`);
    if (existsSync(receiptPath) && !(handoff && JSON.parse(readFileSync(receiptPath,'utf8')).status === 'awaiting_human_captcha_and_submit')) throw Error('A prior attempt exists; inspect it before any repeat submission.');
    const fields = key === 'lifetimo' ? { 'form-field-lname': draft.name, 'form-field-lemail': draft.email, 'form-field-lsubject': draft.subject, 'form-field-lmessage': draft.message } : { 'b1-6-1': 'Casey', 'b1-7-1': 'Shore', 'b1-5-1': draft.email, 'b1-8-1': 'AIonX LLC / Lemonade', 'b1-9-1': draft.productUrl, 'b1-3-1': draft.message };
    await ev(`(() => { const fields=${JSON.stringify(fields)}; for(const [id,value] of Object.entries(fields)){const e=document.getElementById(id);if(!e)throw Error('Missing field '+id);Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));} return true; })()`);
    const valid = await ev(`document.getElementById(${JSON.stringify(Object.keys(fields)[0])}).form.checkValidity()`);
    if (!valid) throw Error('Form validation failed before submission');
    if (handoff) {
      await ev("document.getElementById('b1-3-1').scrollIntoView({block:'center'})");
      writeFileSync(receiptPath, JSON.stringify({ status: 'awaiting_human_captcha_and_submit', at: new Date().toISOString(), contactUrl: urls[key], draftFile: `${key}-request.json`, browserPort: port, profile }, null, 2));
      console.log('KenMoo form prepared. User must complete CAPTCHA and submit.');
    } else {
      writeFileSync(receiptPath, JSON.stringify({ status: 'attempting', at: new Date().toISOString(), contactUrl: urls[key], draftFile: `${key}-request.json` }, null, 2));
      await ev("document.getElementById('form-field-lmessage').form.querySelector('button[type=submit]').click()");
      await delay(12000);
      const outcome = await ev(`({url:location.href,messages:[...document.querySelectorAll('.elementor-message')].map(e=>({text:e.innerText,classes:e.className})),text:document.body.innerText.slice(0,10000)})`);
      const accepted = outcome.messages.some(m => m.classes.includes('elementor-message-success'));
      writeFileSync(receiptPath, JSON.stringify({status:accepted?'form_accepted':'unconfirmed_or_rejected',at:new Date().toISOString(),contactUrl:urls[key],draftFile:`${key}-request.json`,outcome},null,2));
      console.log(JSON.stringify({key,accepted,messages:outcome.messages}));
    }
  }
  if (key === 'ltdhunt') {
    await ev(`[...document.querySelectorAll('a')].find(a=>a.textContent.includes("Let's Connect")).click()`);
    await delay(4000);
    const tree = await cdp('Page.getFrameTree');
    const contexts = [];
    for (const f of tree.frameTree.childFrames ?? []) {
      if (!f.frame.url.includes('missiveapp')) continue;
      try {
        const world = await cdp('Page.createIsolatedWorld', {frameId:f.frame.id,worldName:'inspect-contact'});
        const r = await cdp('Runtime.evaluate',{contextId:world.executionContextId,returnByValue:true,expression:`({url:location.href,text:document.body.innerText,fields:[...document.querySelectorAll('input,textarea,button')].map(e=>({tag:e.tagName,type:e.type,name:e.name,placeholder:e.placeholder,text:e.innerText}))})`});
        contexts.push(r.result.value);
      } catch (error) { contexts.push({error:error.message}); }
    }
    writeFileSync(join(folder,'ltdhunt-chat-state.json'),JSON.stringify({tree,contexts},null,2));
    console.log(JSON.stringify({chat:contexts}));
  }
  const state = await ev(`({url:location.href,title:document.title,text:document.body.innerText.slice(0,18000), forms:[...document.forms].map(f=>({id:f.id,action:f.action,fields:[...f.querySelectorAll('input,textarea,select,button')].map(e=>({tag:e.tagName,id:e.id,name:e.name,type:e.type,placeholder:e.placeholder,label:e.labels?.[0]?.innerText,required:e.required,visible:!!e.getClientRects().length,...(e.tagName==='BUTTON'?{text:e.innerText}:{})}))})),iframes:[...document.querySelectorAll('iframe')].map(f=>({src:f.src,title:f.title})),links:[...document.querySelectorAll('a')].filter(a=>/connect|contact|mail|message/i.test(a.textContent+a.href)).map(a=>({text:a.textContent,href:a.href}))})`);
  writeFileSync(join(folder, `${key}-contact-inspection.json`), JSON.stringify(state, null, 2));
  const shot = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(folder, `${key}-contact.png`), Buffer.from(shot.data, 'base64'));
  console.log(JSON.stringify(state));
  if (key === 'preview') {
    const checks = [];
    for (const width of [1280, 390]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
      await ev('document.fonts.ready');
      const result = await ev(`({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,trial:document.querySelector('#trial').href,video:document.querySelector('video').currentSrc})`);
      if (result.overflow || !result.trial.includes('utm_source=signal') || !result.trial.includes('utm_content=lifetimo') || !result.trial.includes('utm_campaign=lemonade-ltd-lifetimo-20260921')) throw Error('Ad page viewport or tracking failure');
      const shot = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(folder, `live-ad-${width}.png`), Buffer.from(shot.data, 'base64')); checks.push(result);
    }
    writeFileSync(join(folder, 'live-ad-browser.json'), JSON.stringify(checks, null, 2));console.log(JSON.stringify(checks));
    await cdp('Page.navigate', {url:checks[0].trial});
    let campaign;
    for(let i=0;i<60;i++) {campaign=await ev('typeof window.getSignalCampaign === "function" ? window.getSignalCampaign() : null');if(campaign)break;await delay(250);}
    if(campaign!=='lemonade-ltd-lifetimo-20260921')throw Error('Homepage lost the LTD checkout campaign hint');
    writeFileSync(join(folder,'checkout-campaign-browser.json'),JSON.stringify({campaign,verifiedAt:new Date().toISOString(),purchaseAttempted:false},null,2));
  }
  if (handoff) {
    console.log('Keeping the human CAPTCHA window open until it is closed.');
    await new Promise(resolve => browser.once('exit', resolve));
  }
} finally { ws?.close(); browser.kill(); }
