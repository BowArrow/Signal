import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Studio} from '../studio.mjs';
import {commandSchema} from '../protocol.mjs';
import {prepareProfile} from '../profile.mjs';

test('resuming preserves settings, licence bytes, samples and source approvals',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'studio-resume-')),id=randomUUID();
  const p=await prepareProfile(folder,id);
  await writeFile(join(p.home,'settings.json'),JSON.stringify({defaultModel:'user-selected-model',theme:'light'}));
  // Sentinel bytes are not a valid licence and are never used by Lemonade.
  await writeFile(join(p.home,'license.json'),'sentinel-do-not-copy-or-reset');
  const before=await Promise.all(['settings.json','license.json','studio-config.json'].map(name=>readFile(join(p.home,name),'utf8')));
  await prepareProfile(folder,id,{resume:true});
  assert.deepEqual(await Promise.all(['settings.json','license.json','studio-config.json'].map(name=>readFile(join(p.home,name),'utf8'))),before);
  assert.match(await readFile(join(p.fixtureDir,'supplier-original.txt'),'utf8'),/\$2,400/);
});

test('product commands reject paths, scripts, private project shortcuts and unbounded capture',()=>{
  for(const c of [{action:'documents.import',projectId:randomUUID(),paths:['C:/private.txt']},{action:'turn.send',projectId:randomUUID(),documentIds:[randomUUID()],prompt:'hi',requestId:randomUUID(),code:'process.exit()'},{action:'result.export',runId:randomUUID(),path:'C:/elsewhere.txt'},{action:'source.open',runId:randomUUID(),citationId:'../../private'},{action:'record.start',maxSeconds:10000}])assert.equal(commandSchema.safeParse(c).success,false);
});

test('queued product operations release the command queue for recording and errors keep their code',async()=>{
  const root=await mkdtemp(join(tmpdir(),'studio-product-')),id=randomUUID(),studio=new Studio({root});
  studio.folder=join(root,'sessions',id);await mkdir(studio.folder,{recursive:true});studio.session={id,assets:[],events:[],notes:[]};studio.child={exitCode:null};
  studio.cdp={evaluate:async expression=>expression.includes('turn.send')?{ok:true,value:{runId:randomUUID(),state:'queued'}}:{ok:false,error:{code:'MODEL_NOT_READY',message:'Select a model.'}}};
  studio.startRecording=async()=>({recording:true});
  const run=await studio.command({action:'turn.send',projectId:randomUUID(),documentIds:[randomUUID()],prompt:'Compare',requestId:randomUUID()});
  assert.equal(run.state,'queued');assert.equal((await studio.command({action:'record.start'})).recording,true);
  await assert.rejects(studio.command({action:'product.status'}),e=>e.code==='MODEL_NOT_READY');
});

test('concurrent saves retain complete JSON and an owned session cannot be opened elsewhere',async()=>{
  const root=await mkdtemp(join(tmpdir(),'studio-persist-')),id=randomUUID(),studio=new Studio({root});
  studio.folder=join(root,'sessions',id);await mkdir(studio.folder,{recursive:true});studio.session={id,assets:[],events:[],notes:[]};
  await Promise.all(Array.from({length:20},(_,i)=>{studio.session.notes.push({text:String(i)});return studio.persist();}));
  assert.equal(JSON.parse(await readFile(join(studio.folder,'session.json'),'utf8')).notes.length,20);
  await writeFile(join(studio.folder,'product-lock.json'),JSON.stringify({pid:process.pid}));
  const second=new Studio({root});await assert.rejects(second.command({action:'session.open',sessionId:id}),e=>e.code==='SESSION_BUSY');
});
