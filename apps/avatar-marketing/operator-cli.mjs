import {join,resolve} from 'node:path';
import {Operator,root,readJson,saveJson,calendar,dayAt} from './operator.mjs';
import {buildJob} from './production-job.mjs';
const [command='status',...args]=process.argv.slice(2);
const config=await readJson(join(root,'campaigns/alex-creator/automation.json'));
const operator=new Operator({config});
const input=async()=>{if(args[0]!=='--file'||!args[1])throw new Error(command+' requires --file path/to/input.json');return readJson(resolve(args[1]));};
try {
  let result;
  if(command==='status')result=await operator.status();
  else if(command==='plan')result=calendar(config,args[0]||dayAt(Date.now()),Number(args[1]||7));
  else if(command==='source')result=await operator.addSource(await input());
  else if(command==='submit')result=await operator.submit(await input());
  else if(command==='attach-export'){if(!args[0]||!args[1])throw new Error('attach-export job-id receipt.json');result=await operator.attachExport(args[0],args[1]);}
  else if(command==='review')result=await operator.review(await input());
  else if(command==='claim')result=await operator.claim(await input());
  else if(command==='record')result=await operator.record(await input());
  else if(command==='metrics')result=await operator.metrics(await input());
  else if(command==='learning')result=await operator.learning();
  else if(command==='preflight')result=await buildJob(operator,null,{preflightOnly:true});
  else if(command==='build')result=await buildJob(operator,args[0]);
  else if(command==='tick') {
    const s=await operator.load(),job=s.jobs.find(j=>j.state==='queued');
    result=job?await buildJob(operator,job.id):{started:false,reason:'No queued production brief. Fredward supplies research, original script and inspected cutaway.'};
  }else throw new Error('Commands: status, plan [date] [days], source/submit/review/claim/record/metrics --file JSON, attach-export ID RECEIPT, build ID, tick, preflight, learning');
  await saveJson(join(root,'data/alex-operator/last-'+command+'.json'),{at:new Date().toISOString(),result});
  if(['tick','build'].includes(command))await saveJson(join(root,'data/alex-operator/status.json'),await operator.status());
  console.log(JSON.stringify(result,null,2));
}catch(e){await saveJson(join(root,'data/alex-operator/last-error.json'),{at:new Date().toISOString(),command,error:e.message});console.error(e.message);process.exitCode=1;}
