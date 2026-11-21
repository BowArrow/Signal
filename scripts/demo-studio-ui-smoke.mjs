import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { Cdp } from '../apps/demo-studio/cdp.mjs';
const root=resolve('data/demo-studio/ui-check');await mkdir(root,{recursive:true});
const config=JSON.parse(await readFile('data/demo-studio/connection.json','utf8'));
const port=19379;
const child=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(root,'chrome-'+Date.now())}`,`--remote-debugging-port=${port}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let cdp;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try{
  let target;
  for(let i=0;i<80;i++){target=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json()).then(a=>a.find(p=>p.type==='page')).catch(()=>null);if(target)break;await delay(200);}
  assert.ok(target);cdp=await new Cdp().connect(target.webSocketDebuggerUrl);
  await cdp.call('Page.navigate',{url:config.url+'/#key='+config.token});
  for(let i=0;i<80;i++){if(await cdp.evaluate('document.getElementById("connection")?.textContent === "Studio ready" || document.getElementById("connection")?.textContent === "Lemonade connected"'))break;await delay(200);}
  assert.equal(await cdp.evaluate('document.getElementById("message").textContent'),'');
  assert.equal(await cdp.evaluate('location.hash'),'');
  const until=async expression=>{for(let i=0;i<150;i++){if(await cdp.evaluate(expression))return;await delay(200);}throw new Error('UI did not finish: '+expression);};
  await cdp.evaluate('document.getElementById("session-title").value="A walkthrough from Demo Studio";document.getElementById("launch").click()');
  await until('document.getElementById("connection").textContent === "Lemonade connected" && !document.getElementById("capture").disabled');
  await cdp.evaluate('document.getElementById("capture-format").value="square";document.getElementById("set-format").click()');
  await until('document.getElementById("capture-detail").textContent.includes("square") && !document.getElementById("capture").disabled');
  await cdp.evaluate('document.getElementById("cursor-move").click()');
  await until('!document.getElementById("cursor-move").disabled');
  await cdp.evaluate('document.getElementById("shot-title").value="Lemonade expanded workspace";document.getElementById("capture").click()');
  await until('document.getElementById("take-count").textContent === "1"');
  await cdp.evaluate('document.getElementById("record").click()');
  await until('document.getElementById("record").textContent.includes("Stop recording") && !document.getElementById("record").disabled');
  await delay(1800);
  await cdp.evaluate('document.getElementById("record").click()');
  await until('document.getElementById("take-count").textContent === "2" && !document.getElementById("record").disabled');
  await cdp.evaluate('document.getElementById("note").value="A real Lemonade workspace, ready for a fictional demo. No model response has been requested.";document.getElementById("save-note").click()');
  await until('document.getElementById("notes").textContent.includes("fictional demo")');
  await cdp.evaluate('document.getElementById("export").click()');
  await until('document.getElementById("assets").textContent.includes("Capture manifest") && !document.getElementById("export").disabled');
  await cdp.evaluate('document.getElementById("edit-duration").value="1";document.getElementById("add-shot").click();document.getElementById("edit-format").value="portrait";document.getElementById("edit-text").value="Real product. Clear next step.";document.getElementById("text-end").value="1";document.getElementById("render-edit").click()');
  await until('document.getElementById("take-count").textContent === "3" && !document.getElementById("render-edit").disabled');
  for(const width of [1440,900,390]){
    await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await delay(600);
    assert.equal(await cdp.evaluate('document.documentElement.scrollWidth>innerWidth'),false,`no overflow at ${width}`);
    await writeFile(join(root,`studio-${width}.png`),await cdp.image());
    await cdp.evaluate('document.getElementById("edit-title").closest("details").open=true;document.getElementById("edit-title").closest("details").scrollIntoView()');await delay(200);
    assert.equal(await cdp.evaluate('document.documentElement.scrollWidth>innerWidth'),false,`edit controls no overflow at ${width}`);
    await writeFile(join(root,`editing-${width}.png`),await cdp.image());
    await cdp.evaluate('window.scrollTo(0,0)');
  }
  await cdp.evaluate('document.getElementById("agent-help").click()');
  assert.equal(await cdp.evaluate('document.getElementById("agent-dialog").open'),true);
  await writeFile(join(root,'agent-help-390.png'),await cdp.image());
  await writeFile(join(root,'receipt.json'),JSON.stringify({passed:true,viewports:[1440,900,390],authenticatedUi:true,realLaunch:true,formatControl:true,cursorControl:true,editRendered:true,screenshotButton:true,recordButtons:true,noteForm:true,exportButton:true,agentHelp:true,checkedAt:new Date().toISOString()},null,2));
  console.log('Demo Studio UI passed at 1440, 900 and 390 pixels.');
}finally{await cdp?.call('Browser.close').catch(()=>{});cdp?.close();if(child.pid&&child.exitCode===null){try{execFileSync('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{/* Chrome may have already exited. */}}}
