import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { Cdp } from '../apps/demo-studio/cdp.mjs';
const root=resolve('data/demo-studio/ltx-ui-check');await mkdir(root,{recursive:true});
const connection=JSON.parse(await readFile('data/demo-studio/connection.json','utf8'));
const port=19380;
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(root,'chrome-'+Date.now())}`,`--remote-debugging-port=${port}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let cdp;
try{
  let target;for(let i=0;i<60;i++){target=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json()).then(a=>a.find(t=>t.type==='page')).catch(()=>null);if(target)break;await delay(250);}
  assert.ok(target);cdp=await new Cdp().connect(target.webSocketDebuggerUrl);
  await cdp.call('Page.navigate',{url:connection.url+'/#key='+connection.token});
  for(let i=0;i<60;i++){if(await cdp.evaluate('["Studio ready","Lemonade connected"].includes(document.getElementById("connection")?.textContent)'))break;await delay(250);}
  assert.equal(await cdp.evaluate('document.getElementById("message").textContent'),'');
  await cdp.evaluate('document.getElementById("ltx-status").closest("details").open=true;document.getElementById("ltx-status").click()');
  for(let i=0;i<100;i++){if(await cdp.evaluate('document.getElementById("ltx-readiness").textContent.length>0'))break;await delay(250);}
  const readiness=await cdp.evaluate('document.getElementById("ltx-readiness").textContent');assert.ok(readiness.length);
  for(const width of [1440,390]){
    await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    await cdp.evaluate('document.getElementById("ltx-status").closest("details").scrollIntoView()');await delay(300);
    assert.equal(await cdp.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    assert.equal(await cdp.evaluate('!!document.getElementById("ltx-start") && !!document.getElementById("ltx-stop")'),true);
    await writeFile(join(root,`ltx-${width}.png`),await cdp.image());
  }
  await writeFile(join(root,'receipt.json'),JSON.stringify({checkedAt:new Date().toISOString(),widths:[1440,390],readiness,controlsPresent:true,noOverflow:true},null,2));
  console.log({verified:true,readiness});
}finally{cdp?.close();chrome.kill();}
