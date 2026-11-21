import {readFileSync} from 'node:fs';
export function generationHold(now=new Date()) {
  try {
    const policy=JSON.parse(readFileSync(new URL('../../campaigns/alex-creator/activity-policy.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
    const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',hourCycle:'h23'}).format(now));
    if(policy.version!==1||policy.generationEnabled!==true)return {ready:false,reason:'Alex generation is paused.'};
    if(hour>=14)return {ready:false,reason:'Outside 00:00-14:00 America/Los_Angeles.'};
    return {ready:true,reason:'Generation enabled in the Pacific production window; supervisor checks session and games.'};
  } catch(error) {return {ready:false,reason:'Generation policy unavailable: '+error.message};}
}
