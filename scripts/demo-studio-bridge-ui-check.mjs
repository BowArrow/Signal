// UI fixture only. Never connects to, captures, or changes the owner's product window.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {startServer} from '../apps/demo-studio/server.mjs';
import {Cdp} from '../apps/demo-studio/cdp.mjs';
const root=resolve('data/demo-studio/bridge-ui-check');await mkdir(root,{recursive:true});
const id='11111111-1111-4111-8111-111111111111';
const fixture={root,initialize:async()=>{},status:async()=>({connected:false,activeSession:id,videoAvailable:true,capture:{format:'landscape',fps:24},sessions:[{id,title:'Automation controls (UI fixture)',createdAt:new Date().toISOString(),assets:[],notes:[]}]}),command:async()=>({})};
const instance=await startServer({studio:fixture,port:0});
const port=19431,chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run',`--user-data-dir=${join(root,'chrome-'+Date.now())}`,`--remote-debugging-port=${port}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let cdp;
try{
  let target;for(let i=0;i<80;i++){target=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json()).then(a=>a.find(t=>t.type==='page')).catch(()=>null);if(target)break;await sleep(100);}
  assert.ok(target);cdp=await new Cdp().connect(target.webSocketDebuggerUrl);await cdp.call('Page.navigate',{url:instance.origin+'/#key='+instance.token});
  for(let i=0;i<80;i++){if(await cdp.evaluate('document.getElementById("connection")?.textContent==="Studio ready"'))break;await sleep(100);}
  assert.equal(await cdp.evaluate('document.getElementById("message").textContent'),'');
  await cdp.evaluate('document.getElementById("product-workflow").open=true');
  for(const width of [1440,390]){
    await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false});
    await cdp.evaluate('document.getElementById("product-workflow").scrollIntoView()');await sleep(250);
    assert.equal(await cdp.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    assert.equal(await cdp.evaluate('document.getElementById("product-resume").disabled'),false);
    assert.equal(await cdp.evaluate('document.getElementById("product-send").disabled'),true);
    await writeFile(join(root,`controls-${width}.png`),await cdp.image());
  }
  await writeFile(join(root,'receipt.json'),JSON.stringify({fixture:true,widths:[1440,390],noOverflow:true,resumeAvailable:true,disconnectedControlsDisabled:true},null,2));
  console.log('PASS: 1440/390 layouts, no overflow, resume enabled and disconnected product controls disabled (UI fixture).');
}finally{cdp?.close();chrome.kill();await instance.close();}
