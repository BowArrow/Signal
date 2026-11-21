const $ = id => document.getElementById(id);
let state, selected, observation, busy=false, playing=false, previewBusy=false;
let editShots=[];
let productOperation, productRun, productVersion, productExport, productPolling=false;
const message = (text,error=false) => { $('message').textContent=text; $('message').classList.toggle('error',error); };
async function request(path,options={}) { const response=await fetch(path,options); const value=await response.json(); if(!response.ok) throw new Error(value.error); return value; }
async function command(value) { return request('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}); }
async function act(value) {
  if(busy) return; busy=true; updateButtons();
  if(value.action==='edit.render')message('Rendering the edit locally. Longer videos can take several minutes.');
  try {
    const result=await command(value);
    if(value.action==='launch'||value.action==='session.open'||value.action==='product.resume'){selected=result.sessionId;playing=false;editShots=[];drawShots();}
    if(result.observation) showObservation(result.observation);
    if(value.action==='observe')showObservation(result);
    if(value.action==='ltx.status')$('ltx-readiness').textContent=result.reason;
    if(value.action==='ltx.start'||value.action==='ltx.stop')$('ltx-readiness').textContent=result.detail||`LTX ${result.status}.`;
    if(value.action==='ltx.prepare'){$('ltx-readiness').textContent=result.readiness.reason;$('ltx-prompt').textContent=result.prompt;}
    if(value.action==='export')message('Demo pack saved. Download the script and capture manifest from Saved takes.');
    else if(value.action==='screenshot'||value.action==='record.stop')message('Take saved on this computer.');
    else if(value.action==='note'){message('Note saved.');$('note').value='';}
    else if(value.action==='edit.render')message('Marketing edit saved. Play the full video in Saved takes before publishing.');
    else if(value.action==='ltx.submit'||value.action==='ltx.poll')message(`LTX: ${result.status||'saved'}. ${result.detail||'Generated footage still needs visual review.'}`,result.status==='failed'||result.status==='attention');
    else message('');
    await refresh(); await preview(); return result;
  }catch(error){message(error.message,true);}finally{busy=false;updateButtons();}
}
function updateButtons(){
  const active=!!state?.connected && selected===state.activeSession;
  $('launch').disabled=busy||!!state?.connected;
  for(const id of ['capture','record','close','observe'])$(id).disabled=busy||!active;
  $('record').disabled=busy||!active||!state?.videoAvailable;
  for(const id of ['export','save-note'])$(id).disabled=busy||!state?.activeSession||selected!==state.activeSession;
  document.querySelectorAll('.keys button').forEach(b=>b.disabled=busy||!active);
  for(const id of ['set-format','add-shot','render-edit','import-asset','ltx-prepare','ltx-submit','ltx-poll'])$(id).disabled=busy||selected!==state?.activeSession||!state?.activeSession;
  for(const id of ['cursor-move','cursor-hide'])$(id).disabled=busy||!active;
  for(const id of ['ltx-start','ltx-stop','ltx-status'])$(id).disabled=busy;
  for(const id of ['product-check','product-license','product-models','product-import','product-send','product-run-check','product-result-open','product-result-save','product-result-export','product-export-open'])$(id).disabled=busy||!active;
  $('product-resume').disabled=busy||!selected||!!state?.connected;
  $('record').textContent=state?.recording?'■ Stop recording':'● Record clip';
  $('record').classList.toggle('active',!!state?.recording);
}
function element(tag,text,className){const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;}
function showObservation(value){
  observation=value;$('control-list').replaceChildren();$('screen-text').textContent=value.text;
  for(const control of value.controls){
    const row=element('div',null,'control');const button=element('button',control.name||control.role);button.disabled=control.disabled;
    button.onclick=()=>act({action:'click',ref:control.ref,revision:observation.revision});row.append(button);
    if(control.editable){const input=element('input');input.placeholder='Text to enter';input.setAttribute('aria-label',`Text for ${control.name||control.role}`);const fill=element('button','Type');fill.onclick=()=>act({action:'fill',ref:control.ref,revision:observation.revision,text:input.value});row.append(input,fill);}
    $('control-list').append(row);
  }
}
function showAsset(asset){
  playing=true;$('empty-preview').hidden=true;
  if(asset.kind==='video'){$('preview').hidden=true;$('video').hidden=false;$('video').src=asset.url;}
  else if(asset.kind==='image'){$('video').pause();$('video').hidden=true;$('preview').hidden=false;$('preview').src=asset.url;}
}
function render(){
  const session=state.sessions.find(s=>s.id===selected);
  if(state.guidePath)$('agent-prompt').textContent=`Use Signal Demo Studio on this computer. Read ${state.guidePath} and its directing guide. Follow Joey's shot structure. Capture the real Lemonade product with intentional cursor moves, then assemble an edit with the right format, zooms, timed text and any approved audio. Check ltx.status before preparing or rendering generated footage; preserve the runtime hold and memory limits. Export the video and manifest, and review the full result. Do not publish or start Work/Codex tasks without my approval.`;
  $('connection').textContent=state.connected?'Lemonade connected':'Studio ready';$('connection').classList.toggle('live',state.connected);
  $('stage-title').textContent=session?.title||'Your product, in focus';
  $('capture-detail').textContent=state.videoAvailable?`Silent capture · ${state.capture?.format||'landscape'} · up to ${state.capture?.fps||24} fps · 2-minute limit`:'Video needs FFmpeg. Screenshots are ready.';
  $('sessions').replaceChildren();
  for(const s of state.sessions){const button=element('button',s.title,`session${selected===s.id?' selected':''}`);button.append(element('small',`${new Date(s.createdAt).toLocaleDateString()} · ${s.assets.length} files`));button.onclick=()=>{if(!state.connected){act({action:'session.open',sessionId:s.id});return;}selected=s.id;playing=false;$('video').pause();render();preview();};$('sessions').append(button);}
  $('assets').replaceChildren();const assets=session?.assets||[];$('take-count').textContent=assets.filter(a=>['video','image'].includes(a.kind)).length;
  if(!assets.length)$('assets').append(element('p','Your screenshots and clips will appear here.','empty'));
  for(const asset of [...assets].reverse()){
    const box=element('div',null,'asset');
    if(asset.kind==='image'){const img=element('img');img.src=asset.url;img.alt=asset.title;img.loading='lazy';box.append(img);}
    const title=element(['image','video'].includes(asset.kind)?'button':'p',asset.title);if(title.tagName==='BUTTON')title.onclick=()=>showAsset(asset);box.append(title);
    box.append(element('small',asset.kind==='video'?`${asset.durationSeconds.toFixed(1)} seconds · silent MP4`:asset.kind));
    const link=element('a','Download');link.href=asset.url+'?download';link.download=asset.id;box.append(link);$('assets').append(box);
  }
  $('notes').replaceChildren(...(session?.notes||[]).map(n=>element('p',n.text)));
  const options=(id,assets,blank=false)=>{const select=$(id),previous=select.value;select.replaceChildren();if(blank){const opt=element('option','Silent');opt.value='';select.append(opt);}for(const asset of assets){const option=element('option',asset.title);option.value=asset.id;select.append(option);}if([...select.options].some(o=>o.value===previous))select.value=previous;};
  options('edit-source',assets.filter(a=>['image','video'].includes(a.kind)));
  options('edit-audio',assets.filter(a=>a.kind==='audio'),true);
  options('ltx-reference',assets.filter(a=>a.kind==='image'&&a.provenance==='reference'));
  options('ltx-plan',(session?.ltxPlans||[]).map(p=>({id:p.id,title:p.direction.title+' · '+p.status})));
  updateButtons();
}
async function refresh(){state=await request('/api/status');if(!selected)selected=state.activeSession||state.sessions[0]?.id;render();}
async function preview(){
  if(previewBusy||playing)return;
  if(!state?.connected||selected!==state.activeSession){const shot=state?.sessions.find(s=>s.id===selected)?.assets.findLast(a=>a.kind==='image');if(shot)showAsset(shot);else{$('empty-preview').hidden=false;$('preview').hidden=true;$('video').hidden=true;}return;}
  previewBusy=true;
  try{const response=await fetch('/api/preview');if(!response.ok)return;const url=URL.createObjectURL(await response.blob());const previous=$('preview').dataset.objectUrl;$('preview').src=url;$('preview').dataset.objectUrl=url;if(previous)URL.revokeObjectURL(previous);$('preview').hidden=false;$('empty-preview').hidden=true;$('video').hidden=true;}finally{previewBusy=false;}
}
$('launch-form').onsubmit=e=>{e.preventDefault();act({action:'launch',title:$('session-title').value});};
$('capture').onclick=()=>{playing=false;act({action:'screenshot',title:$('shot-title').value||'Product screenshot'});};
$('record').onclick=()=>{playing=false;act(state.recording?{action:'record.stop'}:{action:'record.start',title:$('shot-title').value||'Product walkthrough'});};
$('close').onclick=()=>act({action:'close'});
$('observe').onclick=()=>{playing=false;act({action:'observe'});};
$('note-form').onsubmit=e=>{e.preventDefault();act({action:'note',text:$('note').value});};
$('export').onclick=()=>act({action:'export'});
document.querySelectorAll('[data-key]').forEach(button=>button.onclick=()=>act({action:'key',key:button.dataset.key}));
$('scroll-up').onclick=()=>act({action:'scroll',delta:-600});$('scroll-down').onclick=()=>act({action:'scroll',delta:600});
$('agent-help').onclick=()=>$('agent-dialog').showModal();
function showProduct(value){
  const model=value.model?.name||'No model selected';
  $('product-readiness').textContent=value.ready?`Ready. ${model}.`:`${value.code||'Not ready'}: ${value.licensing?.ready?'': 'Activate this profile in Licence. '}${value.model?.ready?'':'Select an installed local model. '} ${model}`;
  const checked=new Set([...$('product-samples').querySelectorAll('input:checked')].map(e=>e.value));
  $('product-samples').replaceChildren(element('legend','Approved sample files'));
  for(const sample of value.samples||[]){const label=element('label',sample.name),box=element('input');box.type='checkbox';box.value=sample.id;box.checked=checked.size?checked.has(sample.id):true;label.prepend(box);$('product-samples').append(label);}
  const previous=$('product-runs').value;$('product-runs').replaceChildren();
  for(const run of value.runs||[]){const option=element('option',`${run.state}: ${run.prompt.slice(0,70)}`);option.value=run.id;$('product-runs').append(option);}
  if([...$('product-runs').options].some(o=>o.value===previous))$('product-runs').value=previous;
}
async function checkProduct(){const value=await act({action:'product.status'});if(value)showProduct(value);return value;}
function showRun(run){
  $('product-answer').textContent=`${run.state}${run.error?': '+run.error.code+' '+run.error.message:''}\n\n${run.answer||''}`;
  $('product-sources').replaceChildren();
  for(const source of run.citations||[]){const button=element('button',`Open source ${source.citationId}`);button.onclick=()=>act({action:'source.open',runId:run.id,citationId:source.citationId});$('product-sources').append(button);}
}
$('product-resume').onclick=async()=>{const result=await act({action:'product.resume',sessionId:selected});if(result?.product)showProduct(result.product);};
$('product-check').onclick=checkProduct;
$('product-license').onclick=()=>act({action:'product.setup',view:'license'});
$('product-models').onclick=()=>act({action:'product.setup',view:'models'});
$('product-import').onclick=async()=>{const p=await checkProduct();if(!p)return;const sampleIds=[...$('product-samples').querySelectorAll('input:checked')].map(e=>e.value);const op=await act({action:'documents.import',projectId:p.projectId,sampleIds});if(op){productOperation=op.id;message('Import started. Recording can continue.');}};
$('product-send').onclick=async()=>{const p=await checkProduct();if(!p)return;const ids=new Set([...$('product-samples').querySelectorAll('input:checked')].map(e=>e.value));const run=await act({action:'turn.send',projectId:p.projectId,documentIds:p.documents.filter(d=>ids.has(d.sampleId)).map(d=>d.id),prompt:$('product-prompt').value,requestId:globalThis.crypto.randomUUID()});if(run){productRun=run.runId;await checkProduct();$('product-runs').value=productRun;message('Lemonade is working. Recording can continue.');}};
$('product-run-check').onclick=async()=>{const run=await act({action:'turn.status',runId:$('product-runs').value});if(run)showRun(run);};
$('product-result-open').onclick=async()=>{const result=await act({action:'result.open',runId:$('product-runs').value});if(result){productVersion=result.baseVersion;$('product-result-text').value=result.versions.find(v=>v.id===productVersion)?.text||'';}};
$('product-result-save').onclick=async()=>{const result=await act({action:'result.save',runId:$('product-runs').value,text:$('product-result-text').value,baseVersion:productVersion,reason:$('product-edit-reason').value});if(result){productVersion=result.baseVersion;message('Edited version saved. The original answer is retained.');}};
$('product-result-export').onclick=async()=>{const op=await act({action:'result.export',runId:$('product-runs').value,format:'md'});if(op){productOperation=op.id;message('Export started. Approve the file write in Lemonade if prompted.');}};
$('product-export-open').onclick=()=>{if(productExport)act({action:'result.open',runId:productExport.runId,exportId:productExport.exportId});else message('Export an answer first.',true);};
setInterval(async()=>{
  if(productPolling||busy||(!productOperation&&!productRun))return;productPolling=true;
  try{
    if(productOperation){const op=await command({action:'operation.status',operationId:productOperation});if(['completed','failed'].includes(op.state)){productOperation=null;if(op.result?.exportId)productExport=op.result;message(op.state==='failed'?`${op.error.code}: ${op.error.message}`:'Product operation saved.',op.state==='failed');showProduct(await command({action:'product.status'}));await refresh();}}
    if(productRun){const run=await command({action:'turn.status',runId:productRun});showRun(run);if(['completed','failed'].includes(run.state))productRun=null;}
  }catch(error){message(error.message,true);}finally{productPolling=false;}
},1500);
$('agent-prompt').textContent='Use Signal Demo Studio on this computer. Read apps/demo-studio/README.md in the Signal repository. Use its client.mjs to launch Lemonade, observe the screen, interact, capture screenshots and clips, and export a demo pack. Use fictional data and verify the real result. Do not publish or start Work/Codex tasks without my approval.';
$('copy-prompt').onclick=async()=>{try{await navigator.clipboard.writeText($('agent-prompt').textContent);$('copy-prompt').textContent='Copied';}catch{message('Select and copy the instruction in the dialog.',true);}};
const number=id=>Number($(id).value);
$('set-format').onclick=()=>act({action:'format.set',format:$('capture-format').value,fps:number('capture-fps')});
$('cursor-move').onclick=()=>act({action:'cursor.move',x:number('cursor-x')/100,y:number('cursor-y')/100,durationMs:Math.round(number('cursor-time')*1000)});
$('cursor-hide').onclick=()=>act({action:'cursor.set',visible:false});
function drawShots(){ $('edit-shots').replaceChildren();editShots.forEach((shot,i)=>{const row=element('li',`${shot.duration}s · zoom ${shot.zoom.from} to ${shot.zoom.to} `);const remove=element('button','Remove');remove.onclick=()=>{editShots.splice(i,1);drawShots();};row.append(remove);$('edit-shots').append(row);}); }
$('add-shot').onclick=()=>{if(!$('edit-source').value)return message('Choose a source take first.',true);editShots.push({assetId:$('edit-source').value,start:number('edit-start'),duration:number('edit-duration'),fit:$('edit-fit').value,zoom:{from:number('zoom-from'),to:number('zoom-to'),x:number('focus-x')/100,y:number('focus-y')/100}});drawShots();};
$('render-edit').onclick=()=>act({action:'edit.render',edit:{title:$('edit-title').value,format:$('edit-format').value,clips:editShots,titles:$('edit-text').value?[{text:$('edit-text').value,start:number('text-start'),end:number('text-end'),position:$('text-position').value}]:[],...($('edit-audio').value?{audioAssetId:$('edit-audio').value}:{})}});
$('import-asset').onclick=()=>act({action:'asset.import',path:$('import-path').value,title:$('import-title').value,role:$('import-role').value});
$('ltx-status').onclick=()=>act({action:'ltx.status'});
$('ltx-start').onclick=()=>act({action:'ltx.start'});
$('ltx-stop').onclick=()=>act({action:'ltx.stop'});
$('ltx-prepare').onclick=()=>act({action:'ltx.prepare',direction:{title:$('ltx-title').value,referenceAssetId:$('ltx-reference').value,duration:3,ratio:'16:9',subject:$('ltx-subject').value,geometry:$('ltx-geometry').value,firstFrame:'Open on the supplied reference composition, already in the described action.',camera:$('ltx-camera').value,lighting:$('ltx-light').value,atmosphere:'Clean air; no invented smoke or particles.',physics:'Natural weight, contact shadows and secondary motion. Nothing floats or slides.',acting:'Natural micro-movement and breathing where appropriate. No speech.',locks:'Same subject, wardrobe, geography, light direction and screen direction throughout.',beats:[{start:0,end:3,action:$('ltx-action').value}]}});
$('ltx-submit').onclick=()=>act({action:'ltx.submit',planId:$('ltx-plan').value});
$('ltx-poll').onclick=()=>act({action:'ltx.poll',planId:$('ltx-plan').value});
try {
  const token=new URLSearchParams(location.hash.slice(1)).get('key');history.replaceState(null,'',location.pathname);
  if(token)await request('/connect',{method:'POST',headers:{Authorization:`Bearer ${token}`}});
  await refresh();await preview();
  setInterval(()=>{if(state?.recording)$('recording-status').textContent=`Recording ${Math.floor((Date.now()-state.recording.startedAt)/1000)}s`;else $('recording-status').textContent='';preview().catch(()=>{});},1200);
  setInterval(()=>{if(!busy)refresh().catch(error=>message(error.message,true));},6000);
}catch(error){$('connection').textContent='Not connected';message(error.message,true);}
