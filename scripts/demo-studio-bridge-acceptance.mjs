// Real inference only. A failed or incorrect comparison is retained as failed.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Studio} from '../apps/demo-studio/studio.mjs';
import {studioCommand} from '../apps/demo-studio/client.mjs';
const connection=process.argv.find(a=>a.startsWith('--connection='))?.slice(13);
if(!connection)throw Error('Pass --connection=<isolated Studio connection.json>.');
const root=resolve('data/demo-studio/bridge-acceptance',String(Date.now()));await mkdir(root,{recursive:true});
const command=c=>studioCommand(c,connection),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const receipt={startedAt:new Date().toISOString(),passed:false,realInference:true,steps:[]};let recording=false;
const save=()=>writeFile(join(root,'receipt.json'),JSON.stringify(receipt,null,2));
const step=async c=>{const startedAt=Date.now();const result=await command(c);receipt.steps.push({command:c,startedAt,completedAt:Date.now(),result});await save();return result;};
async function operation(op){
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){
    const current=await command({action:'operation.status',operationId:op.id});
    if(current.state==='failed')throw Object.assign(Error(current.error.message),{code:current.error.code});
    if(current.state==='completed'){receipt.steps.push({operation:current});await save();return current.result;}
    if(op.action==='result.export'){
      const view=await command({action:'observe'});
      const dialog=view.surface?.blockingDialogs?.find(d=>d.text.includes('Export demo answer')&&d.text.includes(receipt.sessionId)&&/result-[a-f0-9-]+\.md/.test(d.text));
      const allow=view.controls.find(c=>c.name==='Allow once'&&!c.disabled);
      // The user explicitly requested this session export. Confirm only that exact in-product write prompt.
      if(dialog&&allow)await step({action:'click',ref:allow.ref,revision:view.revision});
    }
    await sleep(300);
  }
  throw Object.assign(Error('The product operation needs attention. Inspect the existing operation before retrying.'),{code:'OPERATION_TIMEOUT'});
}
try{
  const status=await step({action:'product.status'});receipt.sessionId=status.sessionId;
  if(!status.ready)throw Object.assign(Error(status.code==='LICENSE_REQUIRED'?'Activate this isolated profile in Lemonade Licence.':'Select an installed local model in Lemonade Models.'),{code:status.code});
  await step({action:'format.set',format:'landscape',fps:12});
  await step({action:'record.start',title:'Real report comparison, sources, edited answer and export',maxSeconds:600});recording=true;
  const imported=await operation(await step({action:'documents.import',projectId:status.projectId,sampleIds:['supplier-original','supplier-revised']}));
  await step({action:'screenshot',title:'Imported synthetic reports'});
  const submitted=await step({action:'turn.send',projectId:status.projectId,documentIds:imported.documents.map(d=>d.id),prompt:'Compare the two attached supplier reports. Explain what changed in quantity, price and delivery date. Calculate the price difference and cite both sources.',requestId:randomUUID()});
  let run;const deadline=Date.now()+480000;
  while(Date.now()<deadline){run=await command({action:'turn.status',runId:submitted.runId});if(['completed','failed'].includes(run.state))break;await sleep(750);}
  receipt.run=run;await save();
  if(run.state!=='completed')throw Object.assign(Error(run.error?.message||'The model did not finish within the acceptance deadline.'),{code:run.error?.code||'INFERENCE_TIMEOUT'});
  if(!/\$\s*120\b|\b120\s*(?:dollars|USD)\b/i.test(run.answer)||!run.answer.includes('[1]')||!run.answer.includes('[2]'))throw Object.assign(Error('The actual answer did not state a $120 difference with both source citations.'),{code:'COMPARISON_FAILED'});
  await step({action:'screenshot',title:'Actual AI comparison'});await sleep(2000);
  for(const [citationId,amount] of [['1','2400'],['2','2520']]){
    await step({action:'source.open',runId:run.id,citationId});await sleep(700);
    const observed=await step({action:'observe'});
    if(!observed.text.replaceAll(',','').includes('$'+amount))throw Error('The source amount was not visible in the recorded product surface.');
    await step({action:'screenshot',title:'Visible source '+citationId});await sleep(2000);await step({action:'key',key:'Escape'});
  }
  const opened=await step({action:'result.open',runId:run.id});await sleep(1000);
  await step({action:'scroll',delta:590,x:900,y:540});await sleep(700);
  await step({action:'screenshot',title:'Original answer as an editable project note'});await sleep(1500);
  const edited=run.answer+'\n\nReviewed against the two synthetic source reports.';
  await step({action:'result.save',runId:run.id,text:edited,baseVersion:opened.baseVersion,reason:'Add an editorial review note; preserve the AI comparison.'});await sleep(1200);
  await step({action:'screenshot',title:'Edited answer in Lemonade'});await sleep(2000);
  const exported=await operation(await step({action:'result.export',runId:run.id,format:'md'}));
  const reopened=await step({action:'result.open',runId:run.id,exportId:exported.exportId});await sleep(1000);
  if(reopened.text!==edited)throw Error('Reopened export did not match the saved edit.');
  const bytes=await readFile(exported.path);if(createHash('sha256').update(bytes).digest('hex')!==exported.sha256)throw Error('Export hash mismatch.');
  await step({action:'screenshot',title:'Reopened exported answer'});await sleep(2000);
  receipt.video=await step({action:'record.stop'});recording=false;
  const recorder=new Studio();await recorder.initialize();
  await promisify(execFile)(recorder.ffmpeg,['-hide_banner','-v','error','-xerror','-i',receipt.video.asset.path,'-f','null','-'],{windowsHide:true,timeout:180000});
  receipt.decodeVerified=true;
  receipt.manifest=await step({action:'export'});receipt.passed=true;receipt.visualReview='pending';receipt.completedAt=new Date().toISOString();await save();
  console.log(JSON.stringify({passed:true,receipt:join(root,'receipt.json'),video:receipt.video.asset.path,visualReview:'pending'}));
}catch(error){
  receipt.error={code:error.code||'ACCEPTANCE_FAILED',message:error.message};receipt.completedAt=new Date().toISOString();
  if(recording){try{receipt.video=await command({action:'record.stop'});}catch(captureError){receipt.captureError=captureError.message;}}
  await save();console.log(JSON.stringify({passed:false,receipt:join(root,'receipt.json'),error:receipt.error}));process.exitCode=1;
}
