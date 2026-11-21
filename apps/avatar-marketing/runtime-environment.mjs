// Application configuration for child processes only. Never changes OS/user settings.
import {readFile,access} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
export async function runtimeEnvironment(workspace) {
  const config=JSON.parse((await readFile(join(workspace,'campaigns/alex-creator/runtime-paths.json'),'utf8')).replace(/^\uFEFF/,''));
  if(config.version!==1||typeof config.localAppData!=='string'||typeof config.appData!=='string'||!isAbsolute(config.localAppData)||!isAbsolute(config.appData))throw new Error('Explicit absolute host runtime paths required.');
  const local=join(config.localAppData,'Signal/runtime');
  const installed=join(config.appData,'signal/runtime/creative/comfy-owned-v1');
  for(const file of [join(local,'video-tools/ffmpeg/ffmpeg-9.0.1-essentials_build/bin/ffmpeg.exe'),join(local,'video-tools/ffmpeg/ffmpeg-9.0.1-essentials_build/bin/ffprobe.exe'),join(local,'ltx25-models/alex-guided-model-receipt.json'),join(installed,'python_embeded/python.exe'),join(installed,'ComfyUI/main.py')])await access(file);
  return {LOCALAPPDATA:config.localAppData,APPDATA:config.appData,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'};
}
