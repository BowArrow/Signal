/* global fetch, WebSocket, setTimeout, clearTimeout */
// Check the installed desktop's private publishing configuration without revealing keys.
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const dir=mkdtempSync(join(tmpdir(),'signal-installed-'));
const env={...process.env,SIGNAL_DATABASE_URL:join(dir,'signal.db'),SIGNAL_OFFLINE:'1'};
delete env.ELECTRON_RUN_AS_NODE;
for(const key of Object.keys(env))if(/^SIGNAL_(LEMONADE|CINEGEN)_(PUBLISH_KEY|AUTO_PUBLISH)$/.test(key))delete env[key];
const child=spawn(join(process.env.LOCALAPPDATA,'Programs/Signal/Signal.exe'),['--inspect=9341'],{env,cwd:dir,windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let ws;
try{
 let tabs;
 for(let i=0;i<100;i++){try{tabs=await (await fetch('http://127.0.0.1:9341/json')).json();break;}catch{ /* Wait for the inspector. */ }await delay(100);}
 ws=new WebSocket(tabs[0].webSocketDebuggerUrl);
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));await delay(2500);
 const result=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Inspector timeout')),10000);
  ws.addEventListener('message',event=>{const d=JSON.parse(event.data);if(d.id===1){clearTimeout(timer);resolve(d.result?.result?.value);}});
  ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:`({lemonadeKeyLoaded:!!process.env.SIGNAL_LEMONADE_PUBLISH_KEY,cinegenKeyLoaded:!!process.env.SIGNAL_CINEGEN_PUBLISH_KEY,lemonadeAutoPublish:process.env.SIGNAL_LEMONADE_AUTO_PUBLISH==='true',cinegenAutoPublish:process.env.SIGNAL_CINEGEN_AUTO_PUBLISH==='true'})`,returnByValue:true}}));
 });
 assert.deepEqual(result,{lemonadeKeyLoaded:true,cinegenKeyLoaded:true,lemonadeAutoPublish:true,cinegenAutoPublish:true});
 console.log(JSON.stringify({installedDesktopConfiguration:result,isolatedDatabase:true}));
}finally{ws?.close();child.kill();}
