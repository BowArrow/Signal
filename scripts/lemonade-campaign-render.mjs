import {studioCommand} from '../apps/demo-studio/client.mjs';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const out=resolve('output/lemonade-work-assistant-20261112');
mkdirSync(join(out,'video'),{recursive:true});mkdirSync(join(out,'receipts'),{recursive:true});
await studioCommand({action:'session.open',sessionId:'a4992979-0e7c-47c2-88d4-f4d988fae621'});
const imported={};
for(const id of ['hook-a','hook-b','hook-c','result','review','export','trial']){
 const r=await studioCommand({action:'asset.import',path:join(out,'artwork',id+'-1920.png'),title:'2026-11-12 / '+id,role:'reference'});
 imported[id]=r.asset.id;
}
const receipts=[];
for(const [key,hook] of [['a-task','hook-a'],['b-result','hook-b'],['c-proof','hook-c']]){
 const edit={title:'Lemonade work assistant / '+key,format:'portrait',clips:[{assetId:imported[hook],duration:3},{assetId:imported.result,duration:6},{assetId:imported.export,duration:5},{assetId:imported.trial,duration:5}],titles:[]};
 const r=await studioCommand({action:'edit.render',edit});
 copyFileSync(r.asset.path,join(out,'video',key+'-1080x1920.mp4'));receipts.push(r);
 writeFileSync(join(out,'receipts','render-'+key+'.json'),JSON.stringify(r,null,2));console.log(JSON.stringify({variant:key,path:r.asset.path,duration:r.asset.durationSeconds}));
}
// A separate proof clip preserves genuine motion and makes no speed claim.
const edit={title:'Lemonade / source verification proof',format:'portrait',clips:[
 {assetId:imported['hook-b'],duration:3},
 {assetId:'clip-1df4cc27-29dd-416a-98bf-33b70a79847a.mp4',start:1,duration:5},
 {assetId:'clip-df9eb9b1-5bae-463b-af54-81b6af2e4c87.mp4',start:0,duration:4},
 {assetId:'clip-cc4826d8-071f-4061-ae2e-8c569664f88f.mp4',start:0,duration:4},
 {assetId:imported.trial,duration:5}],titles:[{text:'Actual capture · fictional reports · edited sequence',start:3,end:16,position:'bottom',size:30}]};
const r=await studioCommand({action:'edit.render',edit});copyFileSync(r.asset.path,join(out,'video','d-source-proof-1080x1920.mp4'));receipts.push(r);
writeFileSync(join(out,'receipts','render-d-source-proof.json'),JSON.stringify(r,null,2));
await studioCommand({action:'note',text:'November 12 work-assistant campaign: four new silent caption-led edits. Real supplier report comparison and citations, fictional data, editorial review. No speed benchmark. New $9/$79 price artwork is held until live billing and website are verified. Nothing published or scheduled.'});
const exported=await studioCommand({action:'export'});writeFileSync(join(out,'receipts','studio-export.json'),JSON.stringify(exported,null,2));
writeFileSync(join(out,'video-manifest.json'),JSON.stringify(receipts.map(r=>r.asset),null,2));console.log('Four videos saved through Signal Demo Studio.');
