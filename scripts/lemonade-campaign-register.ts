import {app} from 'electron';
import {join,resolve} from 'node:path';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {eq} from 'drizzle-orm';
import {createApp} from '../src/core/app.js';
import {silentLogger} from '../src/core/lib/logger.js';
import {studioAction,copyWarnings} from '../src/core/studio/store.js';
import {studioCampaigns,studioAssets} from '../src/core/db/schema.js';
import {studioCopySchema} from '../src/shared/studio.js';
import {newId} from '../src/core/lib/id.js';
const out=resolve('output/lemonade-work-assistant-20261112'),productId='CzP0iRc7x8uUdmTdZE25h';
app.disableHardwareAcceleration();app.setPath('userData',join(out,'register-profile'));
const platforms=['linkedin','instagram','tiktok','youtube','facebook','x','bluesky','threads'];
const variants=[{id:'a-task',hook:'Two reports. What changed?'},{id:'b-result',hook:'The new quote is $120 higher.'},{id:'c-proof',hook:'An answer you can check.'},{id:'e-work-assistant',hook:'Ask for a change. Review the edit.'}];
app.whenReady().then(async()=>{
 const signal=createApp({databaseUrl:join(process.env.APPDATA!,'signal','signal.db'),logger:silentLogger,migrate:false});
 try{
  const rows=[];
  for(const platform of platforms)for(const variant of variants){
   const title=`Nov 12 / ${platform} / ${variant.id} / work assistant`;
   let campaign=signal.db.select().from(studioCampaigns).all().find(c=>c.productId===productId&&c.brief.title===title);
   if(!campaign){studioAction(signal,{type:'campaign',productId,value:{title,channel:'content',objective:'Measure qualified site visits and trial downloads from a specific work-task demonstration.',audience:'Independent consultants and small-business operators comparing client or supplier files on Windows or Linux.',offer:'14-day free trial, no credit card. New $9 monthly / $79 annual pricing is pending live verification; evergreen assets do not mention price.',formats:['social','video-script'],experimentId:''}});campaign=signal.db.select().from(studioCampaigns).all().find(c=>c.productId===productId&&c.brief.title===title)!;}
   const url=campaign.trackedUrl;
   const profile=['instagram','tiktok','youtube'].includes(platform);
   const caption=variant.id==='e-work-assistant'?(['x','bluesky'].includes(platform)?`I’m building Lemonade, a desktop work assistant. Give it a task in your files, review proposed edits, and keep working in an editable workbook. Sample-file tour. Windows/Linux; 14-day free trial. ${url}`:`Ask for a change. Review the edit.\n\nI’m building Lemonade, a desktop work assistant. This tour shows proposed file changes you can review, and a workbook you can inspect and edit. Keep file changes set to Ask to review what gets written.\n\nThese are product examples with sample files, not a timed autonomous run. Local inference runs on your computer; setup, licensing and optional network tools use a connection.\n\n14-day free trial, no credit card. Windows 11 and Linux. ${profile?'Use the Lemonade link in my profile.':url}\n\n#Lemonade #WorkAssistant`):platform==='bluesky'?`I’m building Lemonade, a desktop work assistant. This sample comparison found a $120 change, with sources to check. Review and export the result. Windows/Linux; 14-day free trial. ${url}`:
    platform==='x'?`I’m building Lemonade, a desktop work assistant. Two sample reports, a $120 change, and sources you can check. Review, export, keep working. 14-day free trial for Windows/Linux. ${url}`:
    `${variant.hook}\n\nI’m building Lemonade, a desktop work assistant for working with your own files. In this recorded example, it compares two fictional supplier reports and identifies a $120 price change and a later delivery date. You can check the sources, review the answer and export a working note.\n\nLocal model inference runs on your computer. Setup, licensing and optional network tools need a connection. Results and speed depend on your model and hardware.\n\nTry it free for 14 days, no credit card. Windows 11 and Linux. ${profile?'Use the Lemonade link in my profile.':url}\n\nFictional sample data; edited sequence. #Lemonade #WorkAssistant`;
   const instructions=profile?`Put this tracked URL in the profile website field before posting: ${url}. ${platform==='youtube'?'Shorts description/comment URLs are not clickable. Use the channel profile link, or a related long-form demo with its own clickable destination.':platform==='tiktok'?'Use a profile website link only if the account has that field; otherwise display siplemona.de and record that attribution will be incomplete.':'Use the profile website link; do not rely on a feed caption URL being clickable.'}`:`Use the tracked URL in the post. Record the actual public post URL after publication. ${platform==='x'?'The platform counts URLs using its own shortened-link length.':'Check the final composer character count.'}`;
   const script=variant.id==='e-work-assistant'?`0–4s: Ask for a change. Review the edit.\n4–9s: Review the proposed file change with permissions set to Ask.\n9–14s: Editable workbook product example.\n14–19s: 14-day free trial, Windows/Linux.\n\nSilent caption-led product tour using sample-file screens. Separate examples, not an autonomous or timed run. Optional founder narration: “I’m building Lemonade to help with work in your own files. Ask for a change, check the proposed edit, and keep working in a file you can inspect. Try it on your next task.”\n\nFile: video/${variant.id}-1080x1920.mp4\n${instructions}`:`0–3s: ${variant.hook}\n3–9s: Real sample comparison result with source citations.\n9–14s: Explain review and export.\n14–19s: 14-day trial, Windows/Linux, siplemona.de.\n\nSilent caption-led edit. This is an edited demonstration, not a speed benchmark or autonomous workflow. Optional founder narration: “Two versions of a supplier report. Lemonade identifies what changed, with sources I can check. I review the result and export my working note. Try it with your own files.”\n\nFile: video/${variant.id}-1080x1920.mp4\n${instructions}`;
   for(const [kind,body] of [['social',caption],['video-script',script]] as const){
    const existing=signal.db.select().from(studioAssets).all().find(a=>a.campaignId===campaign!.id&&a.kind===kind);if(existing)continue;
    const copy=studioCopySchema.parse({title:`${platform}: ${variant.hook}`,body,rationale:'Test concrete task, visible outcome and verifiable source hooks with the same audience and CTA. Organic reference views do not establish conversion performance.',evidence:['https://siplemona.de/','https://ads.tiktok.com/business/en/blog/creative-best-practices-top-performing-ads/','https://support.google.com/youtube/answer/13748639'],reviewNotes:['Prepared for owner posting only. No publication or scheduling authorized.','Fictional data and edited timing disclosed. No customer savings, speed or autonomy claim.','Price artwork is held until new live checkout and website pricing are verified.']});
    signal.db.insert(studioAssets).values({id:newId(),productId,campaignId:campaign.id,kind,copy,status:'draft',warnings:copyWarnings(body),dueAt:null,destination:platform,publishedUrl:null,createdAt:Date.now()}).run();
   }
   rows.push({platform,variant:variant.id,campaignId:campaign.id,url,caption,instructions,video:`video/${variant.id}-1080x1920.mp4`});
  }
  writeFileSync(join(out,'campaigns.json'),JSON.stringify(rows,null,2));
  writeFileSync(join(out,'tracked-links.csv'),'platform,variant,campaign_id,url\n'+rows.map(r=>[r.platform,r.variant,r.campaignId,r.url].join(',')).join('\n')+'\n');
  mkdirSync(join(out,'captions'),{recursive:true});
  for(const platform of platforms)writeFileSync(join(out,'captions',platform+'.txt'),rows.filter(r=>r.platform===platform).map(r=>`${r.variant.toUpperCase()}\n\n${r.caption}\n\nPOSTING NOTES\n${r.instructions}\n\n`).join('\n--------------------\n\n'));
  console.log(JSON.stringify({campaigns:rows.length,assets:rows.length*2,status:'draft',published:0,scheduled:0,output:out}));
 }finally{signal.close();}
}).then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1)});
