import {studioCommand} from '../apps/demo-studio/client.mjs';
import {writeFileSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const out=resolve('output/lemonade-work-assistant-20261112');
await studioCommand({action:'session.open',sessionId:'a4992979-0e7c-47c2-88d4-f4d988fae621'});
const ids={};for(const name of ['agent','review','sheet','trial']){const r=await studioCommand({action:'asset.import',path:join(out,'artwork',name+'-1920.png'),title:'Work assistant / '+name,role:'reference'});ids[name]=r.asset.id;}
const r=await studioCommand({action:'edit.render',edit:{title:'Lemonade / Ask, review, keep working',format:'portrait',clips:[{assetId:ids.agent,duration:4},{assetId:ids.review,duration:5},{assetId:ids.sheet,duration:5},{assetId:ids.trial,duration:5}],titles:[]}});
copyFileSync(r.asset.path,join(out,'video','e-work-assistant-1080x1920.mp4'));writeFileSync(join(out,'receipts','render-e-work-assistant.json'),JSON.stringify(r,null,2));console.log(JSON.stringify({file:'e-work-assistant-1080x1920.mp4',duration:r.asset.durationSeconds}));
