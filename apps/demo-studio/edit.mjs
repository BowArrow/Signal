import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { formats } from './protocol.mjs';

export async function renderEdit(studio,edit){
  if(!studio.videoAvailable)throw new Error('FFmpeg is required to render an edit.');
  const folder=join(studio.folder,'edits',randomUUID());await mkdir(folder,{recursive:true});
  const [width,height]=formats[edit.format];const duration=edit.clips.reduce((n,c)=>n+c.duration,0);
  const run=args=>promisify(execFile)(studio.ffmpeg,['-hide_banner','-loglevel','error','-y',...args],{cwd:folder,windowsHide:true,timeout:180000,maxBuffer:1024*1024});
  const inputs=[];
  for(const [i,clip] of edit.clips.entries()){
    const asset=studio.session.assets.find(a=>a.id===clip.assetId);
    if(!asset||!['image','video'].includes(asset.kind))throw new Error('Choose a saved image or video from this session.');
    if(asset.kind==='video'&&typeof asset.durationSeconds==='number'&&clip.start+clip.duration>asset.durationSeconds+.08)throw new Error('The requested trim goes past the end of its source clip.');
    const mode=clip.fit==='cover'?`scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`:`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x151b29`;
    const frames=Math.round(clip.duration*30),zoom=`${clip.zoom.from}+(${clip.zoom.to}-${clip.zoom.from})*min(1,on/${Math.max(1,frames-1)})`;
    const filter=`fps=30,${mode},setsar=1,zoompan=z='${zoom}':x='max(0,min(iw-iw/zoom,iw*${clip.zoom.x}-iw/zoom/2))':y='max(0,min(ih-ih/zoom,ih*${clip.zoom.y}-ih/zoom/2))':d=1:s=${width}x${height}:fps=30`;
    await run([...(asset.kind==='image'?['-loop','1']:['-ss',String(clip.start)]),'-i',asset.path,'-t',String(clip.duration),'-vf',filter,'-an','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p',`segment-${i}.mp4`]);
    inputs.push(`file 'segment-${i}.mp4'`);
  }
  await writeFile(join(folder,'clips.txt'),inputs.join('\n'));
  await run(['-f','concat','-safe','1','-i','clips.txt','-c','copy','joined.mp4']);
  // Relative, generated filenames keep Windows drive colons and user text out of filter syntax.
  const font=process.env.DEMO_STUDIO_FONT || join(process.env.WINDIR || 'C:/Windows','Fonts','segoeui.ttf');
  if(edit.titles.length)await copyFile(font,join(folder,'font.ttf'));
  const filters=[];
  for(const [i,title] of edit.titles.entries()){
    const maxChars=Math.max(14,Math.floor((width*.84)/(title.size*.55)));
    const wrapped=title.text.split('\n').flatMap(line=>{const lines=[''];for(const word of line.split(/\s+/)){if((lines.at(-1)+' '+word).trim().length>maxChars&&lines.at(-1))lines.push('');lines[lines.length-1]=(lines.at(-1)+' '+word).trim();}return lines;}).join('\n');
    await writeFile(join(folder,`title-${i}.txt`),wrapped);
    const y=title.position==='top'?'h*0.08':title.position==='center'?'(h-text_h)/2':'h*0.88-text_h';
    filters.push(`drawtext=fontfile=font.ttf:textfile=title-${i}.txt:expansion=none:fontsize=${title.size}:fontcolor=white:box=1:boxcolor=0x151b29@0.88:boxborderw=18:line_spacing=8:x=(w-text_w)/2:y=${y}:enable='gte(t,${title.start})*lt(t,${title.end})'`);
  }
  let audio;
  if(edit.audioAssetId){audio=studio.session.assets.find(a=>a.id===edit.audioAssetId&&a.kind==='audio');if(!audio)throw new Error('Choose imported audio from this session.');}
  const filename=`edit-${randomUUID()}.mp4`,output=join(studio.folder,'assets',filename);
  await run(['-i','joined.mp4',...(audio?['-i',audio.path]:[]),...(filters.length?['-vf',filters.join(',')]:[]),'-map','0:v:0',...(audio?['-map','1:a:0','-af',`volume=${edit.audioGain},apad`,'-c:a','aac']:['-an']),'-t',String(duration),'-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',output]);
  await writeFile(join(folder,'edit.json'),JSON.stringify(edit,null,2));
  return studio.asset(filename,await readFile(output),'video',edit.title,{durationSeconds:duration,width,height,fps:30,audio:!!audio,provenance:'edited',edit,sources:edit.clips.map(c=>c.assetId),reviewStatus:'draft'});
}
