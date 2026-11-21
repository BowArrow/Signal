// Inspect an existing, idle acceptance profile. Never create replacement answers.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Cdp} from '../apps/demo-studio/cdp.mjs';
import {studioCommand} from '../apps/demo-studio/client.mjs';
const arg=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.split('=').slice(1).join('=');
const connection=arg('connection'), receiptFile=arg('receipt'), port=arg('port');
assert.ok(connection&&receiptFile&&/^\d+$/.test(port),'Pass connection, receipt and the isolated product CDP port.');
const command=c=>studioCommand(c,connection),delay=ms=>new Promise(r=>setTimeout(r,ms));
const receipt=JSON.parse(await readFile(receiptFile,'utf8'));
const runId=receipt.run.id,exported=receipt.steps.find(s=>s.operation?.action==='result.export').operation.result;
const original=await readFile(exported.path,'utf8');
const folder='data/demo-studio/markdown-review/'+Date.now();await mkdir(folder,{recursive:true});
const state=await command({action:'status'});assert.equal(state.activeSession,receipt.sessionId);assert.equal(state.recording,null);assert.equal(state.connected,true);
const pages=await fetch('http://127.0.0.1:'+port+'/json').then(r=>r.json());
const page=pages.find(p=>p.type==='page'&&p.url.startsWith('file:')&&p.url.includes('surface=panel'));
const cdp=await new Cdp().connect(page.webSocketDebuggerUrl);let priorTheme;const checks=[];
try {
 priorTheme=await cdp.evaluate('window.lemonade.getSettings().then(s=>s.theme)');
 await cdp.call('Page.reload');await delay(1800);
 await command({action:'result.open',runId,exportId:exported.exportId});await delay(400);
 for(const theme of ['dark','light'])for(const width of [1180,390]){
  await cdp.evaluate('window.lemonade.patchSettings('+JSON.stringify({theme})+')');
  await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:width===390?760:700,deviceScaleFactor:1,mobile:false});await delay(350);
  const result=await cdp.evaluate(`(()=>{const d=document.querySelector('dialog[open]'),md=d?.querySelector('.markdown'),b=d?.querySelector('header button');return {lists:md?.querySelectorAll('li').length,strong:md?.querySelectorAll('strong').length,text:md?.innerText,mathErrors:md?.querySelectorAll('.katex-error').length,plain:!!d?.querySelector('.source-viewer__text'),overflow:d.scrollWidth>d.clientWidth,closeVisible:b.getBoundingClientRect().right<=innerWidth,actions:md?.querySelectorAll('a,button').length};})()`);
  assert.equal(result.lists,3);assert.ok(result.strong>=4);assert.ok(result.text.includes('$120 increase'));assert.ok(!result.text.includes('**'));assert.equal(result.mathErrors,0);assert.equal(result.plain,false);assert.equal(result.overflow,false);assert.equal(result.closeVisible,true);assert.equal(result.actions,0);
  const shot=await cdp.call('Page.captureScreenshot',{format:'png'});await writeFile(folder+'/export-'+theme+'-'+width+'.png',Buffer.from(shot.data,'base64'));checks.push({theme,width,...result});
 }
 await cdp.call('Emulation.clearDeviceMetricsOverride');await cdp.evaluate('window.lemonade.patchSettings('+JSON.stringify({theme:priorTheme})+')');
 await command({action:'key',key:'Escape'});await command({action:'result.open',runId});await delay(600);
 const note=await cdp.evaluate(`(()=>{const md=document.querySelector('.projects-preview .markdown');return {lists:md?.querySelectorAll('li').length,strong:md?.querySelectorAll('strong').length,text:md?.innerText};})()`);
 assert.equal(note.lists,3);assert.ok(note.text.includes('$120 increase'));assert.ok(!note.text.includes('**'));
 await cdp.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Edit note').click()");await delay(200);
 assert.equal(await cdp.evaluate("document.querySelector('.projects-editor').value"),original);
 await cdp.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Cancel').click()");
 await command({action:'source.open',runId,citationId:'1'});await delay(200);
 assert.equal(await cdp.evaluate("document.querySelector('.source-viewer__text mark').textContent.includes('$2400')"),true);
 await command({action:'key',key:'Escape'});
 assert.equal(createHash('sha256').update(await readFile(exported.path)).digest('hex'),exported.sha256);
 await command({action:'result.open',runId,exportId:exported.exportId});
 await writeFile(folder+'/receipt.json',JSON.stringify({passed:true,checks,note,sourceHighlightPreserved:true,editorSourceUnchanged:true,exportHash:exported.sha256},null,2));console.log(JSON.stringify({passed:true,folder}));
}finally{
 await cdp.call('Emulation.clearDeviceMetricsOverride');
 if(priorTheme)await cdp.evaluate('window.lemonade.patchSettings('+JSON.stringify({theme:priorTheme})+')');
 cdp.socket.close();
}
