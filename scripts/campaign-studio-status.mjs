import {studioCommand} from '../apps/demo-studio/client.mjs';
const s=await studioCommand({action:'status'});
console.log(JSON.stringify({connected:s.connected,activeSession:s.activeSession?.id,videoAvailable:s.videoAvailable,sessions:s.sessions.map(x=>({id:x.id,title:x.title,assets:x.assets?.filter(a=>a.kind==='video').map(a=>({id:a.id,title:a.title})),ready:x.product?.ready})).slice(0,12)},null,2));
