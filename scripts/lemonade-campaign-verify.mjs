import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
const out=resolve('output/lemonade-work-assistant-20261112');
const ffroot=join(process.env.LOCALAPPDATA,'Signal/runtime/video-tools/ffmpeg');
const ff=join(ffroot,readdirSync(ffroot).find(p=>existsSync(join(ffroot,p,'bin/ffmpeg.exe'))),'bin/ffmpeg.exe');
const probe=join(dirname(ff),'ffprobe.exe'),videos=[];
mkdirSync(join(out,'review'),{recursive:true});
for(const name of readdirSync(join(out,'video'))){
 const file=join(out,'video',name),args=['-v','error','-show_entries','format=duration:stream=codec_name,width,height,r_frame_rate','-of','json',file];
 const info=JSON.parse(execFileSync(probe,args,{encoding:'utf8',windowsHide:true}));assert.equal(info.streams[0].width,1080);assert.equal(info.streams[0].height,1920);assert.equal(info.streams[0].codec_name,'h264');
 execFileSync(ff,['-v','error','-i',file,'-f','null','-'],{windowsHide:true,timeout:60000});
 execFileSync(ff,['-v','error','-y','-i',file,'-vf','fps=1/2,scale=216:384,tile=5x2','-frames:v','1',join(out,'review',name+'.jpg')],{windowsHide:true,timeout:60000});videos.push({file:name,...info,fullDecode:true});
}
const rows=JSON.parse(readFileSync(join(out,'campaigns.json'))),db=new DatabaseSync(join(process.env.APPDATA,'signal','signal.db'),{readOnly:true});
for(const r of rows){const u=new URL(r.url);assert.equal(u.hostname,'siplemona.de');assert.equal(u.searchParams.get('utm_source'),'signal');assert.equal(u.searchParams.get('utm_campaign'),r.campaignId);assert(/^[A-Za-z0-9_-]{8,100}$/.test(r.campaignId));const assets=db.prepare('select status,due_at,published_url from studio_assets where campaign_id=?').all(r.campaignId);assert.equal(assets.length,2);for(const a of assets){assert.equal(a.status,'draft');assert.equal(a.due_at,null);assert.equal(a.published_url,null);}if(r.platform==='bluesky')assert([...r.caption].length<=300,'Bluesky caption too long');}
db.close();
const result={checkedAt:new Date().toISOString(),videos,campaigns:rows.length,assets:rows.length*2,draftOnly:true,scheduled:0,published:0,linksValid:true,sourceCaptureSession:'a4992979-0e7c-47c2-88d4-f4d988fae621',priceLaunch:'held'};
writeFileSync(join(out,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({videos:videos.length,fullDecode:true,campaigns:rows.length,linksValid:true,draftOnly:true}));
