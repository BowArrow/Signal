import test from 'node:test';
import assert from 'node:assert/strict';
import { commandSchema, editSchema, directionSchema } from '../protocol.mjs';
import { directorPrompt } from '../director.mjs';
const direction={title:'Reference continuity',duration:3,ratio:'16:9',referenceAssetId:'reference.png',subject:'A fictional subject in the reference wardrobe',geometry:'Subject screen-left in the foreground; wall in background.',firstFrame:'Already looking toward the window.',camera:'Locked tripod.',lighting:'Soft window light from screen-left.',atmosphere:'Clean air.',physics:'Feet remain planted with natural weight.',acting:'Small eye movement and breathing.',locks:'Same identity and wardrobe.',beats:[{start:0,end:3,action:'Turns eyes toward camera.'}]};
test('Joey direction keeps the required ordered blocks and exact timed action',()=>{
  const prompt=directorPrompt(directionSchema.parse(direction));
  let index=-1;for(const label of ['STYLE:','NO ON-SCREEN TEXT:','CRITICAL:','ASSETS:','GEOMETRY MAP:','FIRST FRAME:','OPTICS:','CAMERA:','LIGHT & COLOUR:','ATMOSPHERE:','ACTION TIMING:','PHYSICS:','ACTING:','AUDIO:','LOCKS:']){assert.ok(prompt.indexOf(label)>index);index=prompt.indexOf(label);}
  assert.match(prompt,/0-3s: Turns eyes/);assert.doesNotMatch(prompt,/8K|Seedance/);
});
test('shot beats must cover the shot without gaps, overlaps or negative time',()=>{
  for(const beats of [[{start:1,end:3,action:'Move'}],[{start:0,end:2,action:'Move'}],[{start:0,end:2,action:'Move'},{start:1,end:3,action:'Move'}]])assert.equal(directionSchema.safeParse({...direction,beats}).success,false);
});
test('edit timings, source sizes and pointer ranges are bounded',()=>{
  const edit={clips:[{assetId:'shot.png',duration:3}],titles:[{text:"100% local: [draft]",start:0,end:3}]};assert.equal(editSchema.safeParse(edit).success,true);
  assert.equal(editSchema.safeParse({...edit,titles:[{text:'x',start:2,end:1}]}).success,false);
  assert.equal(commandSchema.safeParse({action:'cursor.move',x:1.1,y:0}).success,false);
  assert.equal(commandSchema.safeParse({action:'format.set',format:'portrait',fps:60}).success,false);
  assert.equal(editSchema.safeParse({clips:[{assetId:'x',duration:3,zoom:{to:9}}]}).success,false);
});
