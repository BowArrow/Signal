import {copyFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {json,save,exists,sha256,upscale} from './relayvsr.mjs';

// Adapt a processed shot to the existing room-audio/captioned editor contract.
export async function finishRender(sourceFolder,folder){
  sourceFolder=resolve(sourceFolder);folder=resolve(folder);
  const source=await json(join(sourceFolder,'receipt.json'));
  if(!source.decodeVerified||source.videoSha256!==await sha256(source.video))throw new Error('Source render changed.');
  const receiptPath=join(folder,'receipt.json');
  if(await exists(receiptPath)){
    const completed=await json(receiptPath);
    if(completed.upscale?.sourceVideoSha256!==source.videoSha256||completed.videoSha256!==await sha256(completed.video))throw new Error('Processed render changed.');
    return {folder,receipt:receiptPath,resumed:true};
  }
  const result=await upscale(source.video,join(folder,'relay'));
  await mkdir(folder,{recursive:true});await copyFile(result.path,join(folder,'video.mp4'));await copyFile(join(sourceFolder,'input.json'),join(folder,'input.json'));
  const native=source.info.streams.find(s=>s.codec_type==='video');
  const receipt={...source,video:join(folder,'video.mp4'),videoSha256:result.sha256,info:result.info,nativeResolution:[native.width,native.height],elapsedSeconds:source.elapsedSeconds+result.elapsedSeconds,qualityApproved:false,upscale:{model:'RelayVSR native 2x INT8',sourceVideoSha256:source.videoSha256,receipt:join(folder,'relay/receipt.json'),elapsedSeconds:result.elapsedSeconds,audioVerification:result.audioVerification}};
  await save(receiptPath,receipt);return {folder,receipt:receiptPath};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))finishRender(process.argv[2],process.argv[3]).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});
