import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, readdir, access, rename, unlink, realpath } from 'node:fs/promises';
import { join, resolve, dirname, extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { Cdp } from './cdp.mjs';
import { prepareProfile } from './profile.mjs';
import { commandSchema, formats } from './protocol.mjs';
import { renderEdit } from './edit.mjs';
import { ltxStatus, prepareLtx, submitLtx, pollLtx } from './ltx.mjs';
import { startLtxRuntime, stopLtxRuntime } from './ltx-runtime.mjs';

export const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const exists = file => access(file).then(() => true, () => false);
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}
async function locateFfmpeg() {
  if (process.env.DEMO_STUDIO_FFMPEG) return process.env.DEMO_STUDIO_FFMPEG;
  const root = join(process.env.LOCALAPPDATA || '', 'Signal/runtime/video-tools/ffmpeg');
  for (const name of await readdir(root).catch(() => [])) {
    const exe = join(root, name, 'bin/ffmpeg.exe'); if (await exists(exe)) return exe;
  }
  return 'ffmpeg';
}

export class Studio {
  constructor({ root = join(workspace, 'data/demo-studio'), lemonade = resolve(workspace, '../Lemonade'), executable = process.env.DEMO_STUDIO_LEMONADE_EXE } = {}) {
    this.root = root; this.lemonade = lemonade; this.executable = executable; this.queue = Promise.resolve();
  }
  async initialize() {
    await mkdir(join(this.root, 'sessions'), { recursive: true });
    this.ffmpeg = await locateFfmpeg();
    this.videoAvailable = await promisify(execFile)(this.ffmpeg, ['-version'], { windowsHide: true, timeout: 5000 }).then(() => true, () => false);
  }
  command(input) {
    const command = commandSchema.parse(input);
    const next = this.queue.then(() => this.execute(command));
    this.queue = next.catch(() => {}); return next;
  }
  async persist() {
    if (!this.session) return;
    const file = join(this.folder, 'session.json'), bytes = JSON.stringify(this.session, null, 2);
    const save = async () => {
      const temporary = file + '.' + randomUUID() + '.tmp';
      await writeFile(temporary, bytes);
      for(let i=0;;i++) { try { await rename(temporary,file); break; } catch(error) { if(i===4||!['EPERM','EBUSY','EACCES'].includes(error.code))throw error;await delay(40*(i+1)); } }
    };
    this.saving = (this.saving || Promise.resolve()).catch(()=>{}).then(save); await this.saving;
  }
  async status() {
    const sessions = [];
    for (const id of await readdir(join(this.root, 'sessions'))) {
      try { const s = JSON.parse(await readFile(join(this.root, 'sessions', id, 'session.json'), 'utf8')); if(s.ltxPlans)s.ltxPlans=s.ltxPlans.map(({graph: _graph,...plan})=>plan);sessions.push(s); } catch { /* Ignore incomplete folders. */ }
    }
    return { product: 'Lemonade', connected: !!this.cdp && this.child?.exitCode === null && this.cdp.socket?.readyState === WebSocket.OPEN,
      recording: this.recording ? { title: this.recording.title, startedAt: this.recording.startedAt, error: this.recording.error } : null,
      videoAvailable: this.videoAvailable, activeSession: this.session?.id || null, outputRoot: join(this.root, 'sessions'),
      capture: this.session?.capture || {format:'landscape',fps:24}, formats,
      guidePath: join(workspace, 'apps/demo-studio/README.md'),
      sessions: sessions.sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,100) };
  }
  requireSession() { if (!this.cdp || this.child?.exitCode !== null) throw new Error('Launch a demo session first.'); }
  async launch(title, sessionId) {
    if (this.child && this.child.exitCode !== null) await this.close();
    if (this.cdp || this.child) throw new Error('Close the current demo session before starting another.');
    const id = sessionId || randomUUID(); this.folder = join(this.root, 'sessions', id);
    if(sessionId) {
      this.session=JSON.parse(await readFile(join(this.folder,'session.json'),'utf8'));
      if(this.session.id!==id)throw new Error('Session identity does not match its folder.');
    }
    const lock=join(this.folder,'product-lock.json');await mkdir(this.folder,{recursive:true});
    let previous;try {previous=JSON.parse(await readFile(lock,'utf8'));}catch{ /* No live owner or prior lease. */ }
    if(previous){let alive=false;for(const pid of [previous.pid,previous.productPid].filter(Boolean)){try{process.kill(pid,0);alive=true;}catch{ /* No live owner or prior lease. */ }}if(alive)throw Object.assign(new Error('Another Studio or Lemonade process owns this demo session.'),{code:'SESSION_BUSY'});await unlink(lock);}
    const lease=randomUUID();await writeFile(lock,JSON.stringify({pid:process.pid,lease}),{flag:'wx'});this.productLease={lock,lease};
    try {
    const {home,fixtureDir,configPath}=await prepareProfile(this.folder,id,{resume:!!sessionId});
    const port = await freePort(), modelPort = await freePort();
    const exe = this.executable || join(this.lemonade, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
    if (!await exists(exe)) throw new Error('Lemonade was not found. Set DEMO_STUDIO_LEMONADE_EXE to a packaged Lemonade executable.');
    if (!this.executable && !await exists(join(this.lemonade, 'out/main/index.js'))) throw new Error('Build Lemonade first, or set DEMO_STUDIO_LEMONADE_EXE to its packaged executable.');
    this.session = sessionId ? {...this.session,status:'starting'} : { id, title, product: 'Lemonade', capture:{format:'landscape',fps:24}, createdAt: new Date().toISOString(), status: 'starting', source: { executable: exe, isolatedHome: home, sampleDocuments: fixtureDir }, assets: [], events: [], notes: [] };
    await this.persist();
    const env = { ...process.env, LEMONADE_HOME: home, LEMONADE_DEBUG_MULTI: '1', LEMONADE_DEBUG_SHOW_PANEL: '1', LEMONADE_DEBUG_OLLAMA_PORT: String(modelPort), LEMONADE_STUDIO_CONFIG: configPath };
    delete env.ELECTRON_RUN_AS_NODE;
    this.child = spawn(exe, [...(this.executable ? [] : [this.lemonade]), `--user-data-dir=${join(this.folder, 'chrome')}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { env, windowsHide: true, stdio: 'ignore' });
    let launchError;
    this.child.once('error', error => { launchError = error; });
    await writeFile(lock,JSON.stringify({pid:process.pid,productPid:this.child.pid,lease}));
      let target;
      for (let i = 0; i < 100; i++) {
        if (launchError) throw launchError;
        if (this.child.exitCode !== null) throw new Error('Lemonade exited before its demo window opened.');
        const targets = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(800) }).then(r => r.json()).catch(() => []);
        target = targets.find(t => t.type === 'page' && t.url.includes('surface=panel') && t.url.startsWith('file:'));
        if (target) break;
        await delay(300);
      }
      if (!target) throw new Error('Lemonade did not open its product window within 30 seconds.');
      this.cdp = await new Cdp().connect(target.webSocketDebuggerUrl);
      for (let i = 0; i < 40; i++) {
        if (await this.cdp.evaluate('document.body?.innerText.length > 10')) break;
        await delay(250);
      }
      // Use the product's own expanded mode so its layout and native window agree.
      const initial = await this.cdp.observe();
      const expand = initial.controls.find(control => control.name === 'Expand');
      if (expand) await this.cdp.click(await this.cdp.point(expand.ref, initial.revision));
      await delay(600);
      const viewport = await this.cdp.evaluate('({width:innerWidth,height:innerHeight,screenWidth:screen.availWidth,screenHeight:screen.availHeight})');
      this.session.source.viewport = viewport;
      this.session.status = 'open'; await this.persist();
      const product=await this.productCommand({action:'product.status'}).catch(error=>({ready:false,code:error.code||'BRIDGE_UNAVAILABLE',detail:error.message}));
      return { saved: true, sessionId: id, resumed:!!sessionId, sampleDocuments: fixtureDir, product, observation: await this.cdp.observe() };
    } catch (error) { await this.close(); throw error; }
  }
  async productCommand(command) {
    this.requireSession();
    const reply=await this.cdp.evaluate(`window.lemonade.demo(${JSON.stringify(command)})`,60000);
    if(!reply?.ok){
      const error={code:reply?.error?.code||'BRIDGE_UNAVAILABLE',message:reply?.error?.message||'The product bridge is unavailable. Build the updated Lemonade app.'};
      this.session.events.push({action:command.action,at:new Date().toISOString(),error});await this.persist();throw Object.assign(new Error(error.message),{code:error.code});
    }
    const value=reply.value;
    if(command.action==='product.status')this.session.product=value;
    if(['turn.status','operation.status'].includes(command.action)){
      const key=command.action==='turn.status'?'runs':'operations';this.session.product??={};this.session.product[key]??=[];
      const old=this.session.product[key].findIndex(v=>v.id===value.id);
      if(old<0)this.session.product[key].push(value);else this.session.product[key][old]=value;
    }
    if(command.action==='operation.status'&&value?.state==='completed'&&value.result?.exportId){
      const output=value.result, filename=`result-${output.exportId}.${extname(output.path).slice(1)}`;
      const path=join(this.folder,'assets',filename);
      if(!['.md','.txt'].includes(extname(path))||await realpath(path)!==await realpath(output.path))throw new Error('Export receipt does not identify a session asset.');
      const bytes=await readFile(path);if(createHash('sha256').update(bytes).digest('hex')!==output.sha256)throw new Error('Export hash verification failed.');
      if(!this.session.assets.some(a=>a.id===filename))this.session.assets.push({id:filename,kind:'document',title:'Exported AI answer',path,url:`/assets/${this.session.id}/${filename}`,bytes:bytes.length,sha256:output.sha256,createdAt:new Date(output.at).toISOString(),provenance:'edited-ai-answer',runId:output.runId,versionId:output.versionId});
    }
    if(!['product.status','turn.status','operation.status'].includes(command.action))this.session.events.push({action:command.action,at:new Date().toISOString(),command,result:value});await this.persist();
    return value;
  }
  async asset(filename, bytes, kind, title, extra = {}) {
    const file = join(this.folder, 'assets', filename); await writeFile(file, bytes);
    const asset = { id: filename, kind, title, path: file, url: `/assets/${this.session.id}/${filename}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), createdAt: new Date().toISOString(), ...extra };
    this.session.assets.push(asset); await this.persist(); return { saved: true, sessionId: this.session.id, asset };
  }
  async startRecording(title, maxSeconds=120) {
    if (this.recording) throw new Error('A recording is already running.');
    if (!this.videoAvailable) throw new Error('Install FFmpeg or set DEMO_STUDIO_FFMPEG, then restart the studio to record MP4 clips. Screenshots still work.');
    const id = randomUUID(), folder = join(this.folder, 'frames', id); await mkdir(folder, { recursive: true });
    const dimensions = await this.cdp.evaluate('({width:innerWidth,height:innerHeight})');
    const recording = { id, title, folder, dimensions, maxSeconds, capture:{...(this.session.capture||{format:'landscape',fps:24})}, startedAt: Date.now(), frames: [], stopped: false, error: null };
    this.recording = recording;
    recording.loop = (async () => {
      while (!recording.stopped && Date.now() - recording.startedAt < maxSeconds*1000) {
        const at = Date.now();
        try {
          const bytes = await this.cdp.image('jpeg'); const filename = `frame-${String(recording.frames.length).padStart(5,'0')}.jpg`;
          await writeFile(join(folder, filename), bytes); recording.frames.push({ filename, at });
        } catch (error) { recording.error = error.message; break; }
        await delay(Math.max(0, 1000/recording.capture.fps - (Date.now() - at)));
      }
      if (!recording.stopped) {
        this.queue = this.queue.then(() => this.recording === recording ? this.stopRecording() : undefined).catch(error => { recording.error = error.message; });
      }
    })();
    return { recording: true, maxSeconds, targetFramesPerSecond:recording.capture.fps,format:recording.capture.format,audio:false };
  }
  async stopRecording() {
    const rec = this.recording; if (!rec) throw new Error('No recording is running.');
    rec.stopped = true; await rec.loop;
    const stoppedAt = Date.now();
    if (!rec.frames.length) { this.recording = null; throw new Error(rec.error || 'No video frames were captured.'); }
    const lines = rec.frames.flatMap((frame, i) => [`file '${frame.filename}'`, `duration ${Math.max(0.04, ((rec.frames[i+1]?.at ?? stoppedAt) - frame.at)/1000).toFixed(3)}`]);
    lines.push(`file '${rec.frames.at(-1).filename}'`);
    await writeFile(join(rec.folder, 'frames.txt'), lines.join('\n'));
    const filename = `clip-${rec.id}.mp4`, target = join(this.folder, 'assets', filename);
    try {
      const [width,height]=formats[rec.capture.format];
      await promisify(execFile)(this.ffmpeg, ['-hide_banner','-loglevel','error','-y','-f','concat','-safe','1','-i',join(rec.folder,'frames.txt'),'-vf',`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,'-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-fps_mode','vfr','-movflags','+faststart',target], { windowsHide: true, timeout: 120000, maxBuffer: 1024*1024 });
      const durationSeconds=(stoppedAt-rec.frames[0].at)/1000;
      return await this.asset(filename, await readFile(target), 'video', rec.title, { durationSeconds, frameCount: rec.frames.length, width,height,targetFps:rec.capture.fps,actualCaptureFps:rec.frames.length/durationSeconds, capture:'sampled-ui',provenance:'captured-product',audio:false,...(rec.error?{captureError:rec.error}:{}) });
    } finally { this.recording = null; }
  }
  async export() {
    const markdown = [`# ${this.session.title}`, '', 'Product: Lemonade', 'Captured from the real product in an isolated demo workspace. Sample documents are fictional.', '', '## Captures', ...this.session.assets.filter(a => a.kind !== 'script' && a.kind !== 'manifest').map(a => `- [${a.title.replace(/[[\]\r\n]/g,' ')}](${a.id}) (${a.kind}; SHA-256 ${a.sha256})`), '', '## Script and observations', ...this.session.notes.map(n => `\n${n.text}`), '', '## Review before publication', 'Verify the full clip, any product claims, and sample data. Clips have no audio and use sampled product frames. Nothing has been published.'].join('\n');
    const id = randomUUID();
    const script = await this.asset(`demo-script-${id}.md`, Buffer.from(markdown), 'script', 'Demo script and shot list');
    const manifest = await this.asset(`manifest-${id}.json`, Buffer.from(JSON.stringify({ ...this.session, exportedAt: new Date().toISOString(), publicationStatus: 'not-published' }, null, 2)), 'manifest', 'Capture manifest');
    return { saved: true, sessionId: this.session.id, folder: join(this.folder, 'assets'), script: script.asset, manifest: manifest.asset };
  }
  async close() {
    let recordingError;
    if (this.recording) { try { await this.stopRecording(); } catch (error) { recordingError = error.message; } }
    this.cdp?.close(); this.cdp = null;
    if (this.child?.pid && this.child.exitCode === null) {
      if (process.platform === 'win32') await promisify(execFile)('taskkill', ['/pid', String(this.child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
      else this.child.kill('SIGTERM');
    }
    this.child = null;
    if(this.productLease){const {lock,lease}=this.productLease;const current=JSON.parse(await readFile(lock,'utf8').catch(()=>'null'));if(current?.lease===lease)await unlink(lock).catch(()=>{});this.productLease=null;}
    if (this.session) { this.session.status = 'closed'; await this.persist(); }
    return { closed: true, ...(recordingError ? { recordingError } : {}) };
  }
  async execute(c) {
    if (c.action === 'status') return this.status();
    if (c.action === 'ltx.status') return ltxStatus();
    if (c.action === 'ltx.start') { if(this.child?.exitCode===null)throw new Error('Finish capturing and close the Lemonade demo window before starting LTX. Your saved takes and session stay available.'); return startLtxRuntime(); }
    if (c.action === 'ltx.stop') return stopLtxRuntime();
    if(c.action==='session.open'){
      if(this.child?.exitCode===null)throw new Error('Close the current demo window before editing a different session.');
      const folder=join(this.root,'sessions',c.sessionId);
      const lock=JSON.parse(await readFile(join(folder,'product-lock.json'),'utf8').catch(()=>'null'));
      if(lock){let alive=false;try{process.kill(lock.pid,0);alive=true;}catch{ /* No live owner or prior lease. */ }if(alive)throw Object.assign(new Error('Another Studio process owns this demo session.'),{code:'SESSION_BUSY'});}
      const session=JSON.parse(await readFile(join(folder,'session.json'),'utf8'));
      this.folder=folder;this.session=session;this.session.status='closed';await this.persist();return {saved:true,sessionId:session.id,editing:true};
    }
    if (c.action === 'launch') return this.launch(c.title);
    if (c.action === 'product.resume') {
      if(this.child?.exitCode===null&&this.session?.id===c.sessionId)return {sessionId:c.sessionId,resumed:true,product:await this.productCommand({action:'product.status'})};
      return this.launch(undefined,c.sessionId);
    }
    if (c.action === 'close') return this.close();
    if(['product.status','product.setup','documents.import','operation.status','turn.send','turn.status','source.open','result.open','result.save','result.export'].includes(c.action))return this.productCommand(c);
    if(c.action==='samples.list')return (await this.productCommand({action:'product.status'})).samples;
    if(this.recording&&['edit.render','ltx.submit','asset.import'].includes(c.action))throw new Error('Finish the recording before rendering or importing media.');
    if (['export','note','asset.import','edit.render','ltx.prepare','ltx.submit','ltx.poll','format.set'].includes(c.action)) { if (!this.session) throw new Error('Launch a demo session first.'); }
    else this.requireSession();
    let result;
    switch (c.action) {
      case 'observe': {
        const observation=await this.cdp.observe();
        const product=await this.productCommand({action:'product.status'}).catch(error=>({code:error.code||'BRIDGE_UNAVAILABLE',detail:error.message}));
        const surface=await this.cdp.evaluate(`(() => {const p=document.querySelector('[data-product-view]'),s=document.querySelector('dialog[open][data-source-file]');return {view:p?.dataset.productView,activeProject:p?.dataset.projectId,activeDocument:p?.dataset.documentId,activeSource:s?{file:s.dataset.sourceFile,sha256:s.dataset.sourceHash}:null,blockingDialogs:[...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"],.permission-prompt')].map(e=>({text:e.innerText.slice(0,1600)}))};})()`);
        return {...observation,product,surface};
      }
      case 'format.set': if(this.recording)throw new Error('Stop the recording before changing its format.');this.session.capture={format:c.format,fps:c.fps};result={saved:true,...this.session.capture,dimensions:formats[c.format]};break;
      case 'cursor.move': {this.cdp.cursorVisible=true;const size=await this.cdp.evaluate('({w:innerWidth,h:innerHeight})');await this.cdp.move(c.x*size.w,c.y*size.h,c.durationMs);break;}
      case 'cursor.set': this.cdp.cursorVisible=c.visible;this.cdp.clicksVisible=c.clicks;await this.cdp.cursor(40,40,false,c.visible);break;
      case 'wait': await delay(c.milliseconds);break;
      case 'edit.render': result=await renderEdit(this,c.edit);break;
      case 'ltx.prepare': result=await prepareLtx(this,c.direction);break;
      case 'ltx.submit': result=await submitLtx(this,c.planId);break;
      case 'ltx.poll': result=await pollLtx(this,c.planId);break;
      case 'asset.import': {
        const extension=extname(c.path).toLowerCase();
        const allowed=c.role==='reference'?['.png','.jpg','.jpeg','.webp']:c.role==='audio'?['.wav','.mp3','.m4a']:['.mp4'];
        if(!isAbsolute(c.path)||!allowed.includes(extension))throw new Error('Choose an absolute path to a supported image, video or audio file.');
        const {stat}=await import('node:fs/promises');if((await stat(c.path)).size>100*1024*1024)throw new Error('Imports are limited to 100 MB.');
        result=await this.asset(`import-${randomUUID()}${extension}`,await readFile(c.path),c.role==='reference'?'image':c.role==='audio'?'audio':'video',c.title,{provenance:c.role,sourcePath:c.path});break;
      }
      case 'click': await this.cdp.click(await this.cdp.point(c.ref,c.revision)); break;
      case 'fill': await this.cdp.click(await this.cdp.point(c.ref,c.revision,true)); await this.cdp.key('a',2); await this.cdp.key('Backspace'); await this.cdp.call('Input.insertText',{text:c.text}); break;
      case 'key': await this.cdp.evaluate('window.__demoStudio = null'); await this.cdp.key(c.key); break;
      case 'scroll': await this.cdp.evaluate('window.__demoStudio = null'); await this.cdp.call('Input.dispatchMouseEvent',{type:'mouseWheel',x:c.x,y:c.y,deltaX:0,deltaY:c.delta}); break;
      case 'screenshot': result = await this.asset(`shot-${randomUUID()}.png`, await this.cdp.image(), 'image',c.title); break;
      case 'record.start': result = await this.startRecording(c.title,c.maxSeconds); break;
      case 'record.stop': result = await this.stopRecording(); break;
      case 'note': this.session.notes.push({ text:c.text, at:new Date().toISOString() }); result = {saved:true}; break;
      case 'export': if(this.cdp)await this.productCommand({action:'product.status'});result = await this.export(); break;
    }
    this.session.events.push({ ...c, at: new Date().toISOString() }); await this.persist();
    return result || { performed: c.action, next: 'observe' };
  }
}
