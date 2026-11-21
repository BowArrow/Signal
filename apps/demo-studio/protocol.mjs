import { z } from 'zod';

const text = z.string().trim().min(1).max(500);
export const formats = { landscape: [1920,1080], portrait: [1080,1920], square: [1080,1080], feed: [1080,1350] };
const point = z.number().min(0).max(1);
export const editSchema = z.object({
  title: text.default('Marketing edit'), format: z.enum(['landscape','portrait','square','feed']).default('landscape'),
  clips: z.array(z.object({ assetId: text, start: z.number().min(0).max(120).default(0), duration: z.number().min(0.5).max(30),
    fit: z.enum(['contain','cover']).default('contain'),
    zoom: z.object({ from: z.number().min(1).max(3).default(1), to: z.number().min(1).max(3).default(1), x: point.default(.5), y: point.default(.5) }).default({}),
  }).strict()).min(1).max(12),
  titles: z.array(z.object({text: z.string().min(1).max(180), start:z.number().min(0), end:z.number().positive(), position:z.enum(['top','center','bottom']).default('bottom'),size:z.number().int().min(24).max(100).default(48)}).strict()).max(20).default([]),
  audioAssetId: text.optional(), audioGain: z.number().min(0).max(1).default(.8),
}).strict().superRefine((value,ctx)=>{
  const duration=value.clips.reduce((n,c)=>n+c.duration,0);
  if(duration>120)ctx.addIssue({code:'custom',message:'Edits are limited to 120 seconds.'});
  for(const title of value.titles)if(title.end<=title.start||title.end>duration)ctx.addIssue({code:'custom',message:'Title timing must fit inside the edit.'});
});
export const directionSchema=z.object({
  title:text,duration:z.number().int().min(3).max(5).default(3),ratio:z.enum(['16:9','9:16','1:1']).default('16:9'),referenceAssetId:text,
  subject:text,geometry:text,firstFrame:text,camera:text,lighting:text,atmosphere:text,physics:text,acting:text,locks:text,
  fov:z.enum(['84','63','47','34','29','18']).default('47'),
  beats:z.array(z.object({start:z.number().min(0),end:z.number().positive(),action:text}).strict()).min(1).max(6),
}).strict().superRefine((v,c)=>{let end=0;for(const b of v.beats){if(b.start!==end||b.end<=b.start)c.addIssue({code:'custom',message:'Action beats must be continuous and ordered.'});end=b.end;}if(end!==v.duration)c.addIssue({code:'custom',message:'Action beats must cover the full shot duration.'});});
export const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }).strict(),
  z.object({action:z.literal('product.resume'),sessionId:z.string().uuid()}).strict(),
  z.object({action:z.literal('product.status')}).strict(),
  z.object({action:z.literal('product.setup'),view:z.enum(['license','models'])}).strict(),
  z.object({action:z.literal('samples.list')}).strict(),
  z.object({action:z.literal('documents.import'),projectId:z.string().uuid(),sampleIds:z.array(z.string().regex(/^[a-zA-Z0-9-]{1,80}$/)).min(1).max(20)}).strict(),
  z.object({action:z.literal('operation.status'),operationId:z.string().uuid()}).strict(),
  z.object({action:z.literal('turn.send'),projectId:z.string().uuid(),documentIds:z.array(z.string().uuid()).min(1).max(20),prompt:z.string().trim().min(1).max(6000),requestId:z.string().uuid()}).strict(),
  z.object({action:z.literal('turn.status'),runId:z.string().uuid()}).strict(),
  z.object({action:z.literal('source.open'),runId:z.string().uuid(),citationId:z.string().regex(/^\d{1,2}$/)}).strict(),
  z.object({action:z.literal('result.open'),runId:z.string().uuid(),exportId:z.string().uuid().optional()}).strict(),
  z.object({action:z.literal('result.save'),runId:z.string().uuid(),text:z.string().max(24000),baseVersion:z.string().uuid(),reason:text}).strict(),
  z.object({action:z.literal('result.export'),runId:z.string().uuid(),format:z.enum(['md','txt']).default('md')}).strict(),
  z.object({action:z.literal('session.open'),sessionId:z.string().uuid()}).strict(),
  z.object({ action: z.literal('launch'), title: text.default('Lemonade walkthrough') }).strict(),
  z.object({ action: z.literal('observe') }).strict(),
  z.object({ action:z.literal('format.set'),format:z.enum(['landscape','portrait','square','feed']),fps:z.number().int().min(8).max(30).default(24) }).strict(),
  z.object({ action:z.literal('cursor.move'),x:point,y:point,durationMs:z.number().int().min(0).max(10000).default(700) }).strict(),
  z.object({ action:z.literal('cursor.set'),visible:z.boolean(),clicks:z.boolean().default(true) }).strict(),
  z.object({ action:z.literal('wait'),milliseconds:z.number().int().min(0).max(10000) }).strict(),
  z.object({ action:z.literal('asset.import'),path:z.string().min(1).max(2000),title:text,role:z.enum(['reference','generated','audio']) }).strict(),
  z.object({ action:z.literal('edit.render'),edit:editSchema }).strict(),
  z.object({ action:z.literal('ltx.status') }).strict(),
  z.object({ action:z.literal('ltx.start') }).strict(),
  z.object({ action:z.literal('ltx.stop') }).strict(),
  z.object({ action:z.literal('ltx.prepare'),direction:directionSchema }).strict(),
  z.object({ action:z.literal('ltx.submit'),planId:z.string().uuid() }).strict(),
  z.object({ action:z.literal('ltx.poll'),planId:z.string().uuid() }).strict(),
  z.object({ action: z.literal('click'), ref: z.string().regex(/^e\d+$/), revision: z.string() }).strict(),
  z.object({ action: z.literal('fill'), ref: z.string().regex(/^e\d+$/), revision: z.string(), text: z.string().max(12000) }).strict(),
  z.object({ action: z.literal('key'), key: z.enum(['Enter', 'Tab', 'Escape', 'Backspace', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) }).strict(),
  z.object({ action: z.literal('scroll'), delta: z.number().int().min(-1500).max(1500), x: z.number().min(0).max(4096).default(600), y: z.number().min(0).max(2160).default(500) }).strict(),
  z.object({ action: z.literal('screenshot'), title: text.default('Product screenshot') }).strict(),
  z.object({ action: z.literal('record.start'), title: text.default('Product walkthrough'),maxSeconds:z.number().int().min(10).max(600).default(120) }).strict(),
  z.object({ action: z.literal('record.stop') }).strict(),
  z.object({ action: z.literal('note'), text: z.string().trim().min(1).max(6000) }).strict(),
  z.object({ action: z.literal('export') }).strict(),
  z.object({ action: z.literal('close') }).strict(),
]);

export const apiDescription = {
  product: 'Lemonade', version: 3,
  formats,
  workflow: 'launch -> observe -> click/fill/key/scroll -> screenshot or record.start/record.stop -> note -> export -> close',
  commands: [
    {action:'product.resume',sessionId:'saved session UUID'}, {action:'product.status'}, {action:'product.setup',view:'license'}, {action:'samples.list'},
    {action:'documents.import',projectId:'project UUID returned by product.status',sampleIds:['supplier-original','supplier-revised']},
    {action:'operation.status',operationId:'ID returned by import or export'},
    {action:'turn.send',projectId:'approved project UUID',documentIds:['imported document UUID'],prompt:'Compare the attached reports and cite the sources.',requestId:'new UUID; reuse for a retry of identical input'},
    {action:'turn.status',runId:'returned run UUID'}, {action:'source.open',runId:'returned run UUID',citationId:'1'},
    {action:'result.open',runId:'completed run UUID'}, {action:'result.save',runId:'completed run UUID',text:'edited answer',baseVersion:'version UUID from result.open',reason:'Editorial review'},
    {action:'result.export',runId:'completed run UUID',format:'md'}, {action:'result.open',runId:'completed run UUID',exportId:'saved export UUID'},
    { action: 'launch', title: 'Fictional client project' }, { action: 'observe' },
    { action: 'click', ref: 'e1', revision: 'use the revision returned by observe' },
    { action: 'fill', ref: 'e2', revision: 'use the revision returned by observe', text: 'Demo text' },
    { action: 'key', key: 'Enter' }, { action: 'scroll', delta: 600 },
    { action: 'screenshot', title: 'Project overview' },
    { action: 'record.start', title: 'A project walkthrough' }, { action: 'record.stop' },
    { action: 'note', text: 'Narration or an observation, not a verified product claim.' },
    { action: 'export' }, { action: 'close' }, { action: 'status' },
    {action:'session.open',sessionId:'saved session UUID'},
    { action:'format.set',format:'portrait',fps:24 },{action:'cursor.move',x:.7,y:.4,durationMs:1000},{action:'cursor.set',visible:true,clicks:true},{action:'wait',milliseconds:1000},
    { action:'asset.import',path:'absolute local image, MP4, or audio path',title:'Scene reference',role:'reference' },
    { action:'edit.render',edit:{title:'Product in focus',format:'portrait',clips:[{assetId:'saved take ID',start:0,duration:3,fit:'contain',zoom:{from:1,to:1.5,x:.5,y:.5}}],titles:[{text:'A clear message',start:0,end:3,position:'bottom'}]} },
    {action:'ltx.start'},{action:'ltx.stop'},{action:'ltx.status'},{action:'ltx.prepare',direction:'See README.md for the structured Joey shot direction schema.'},{action:'ltx.submit',planId:'saved plan UUID'},{action:'ltx.poll',planId:'saved plan UUID'},
  ],
  limits: 'One dedicated Lemonade session. References expire after interaction. Capture targets 8-30 fps; actual frame rate is reported. Edits support 12 shots and 20 timed titles, up to 120 seconds. LTX uses the existing bounded 3-5 second preview workflow and respects the local production hold. No arbitrary script, shell, publishing, or personal-profile attachment.',
};
