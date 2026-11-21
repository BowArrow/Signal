# Direct a marketing video

Use the local client described in README.md. The same commands work for Dots, Codex, or Signal's source adapter. No model is embedded in the studio. The director is the connected agent; it must observe and inspect actual outputs.

## Joey's directing structure

This workflow adapts the owner's **cinema-director-v3** skill from `C:\Users\cshor\Documents\WebProjects\CineGen\.scene2d-work.local\joey\cinema-director-v3\cinema-director-v3\SKILL.md`. That original skill targets Seedance. Here the engine is explicitly **LTX 2.5**, and the existing local preview workflow limits it to one reference and 3–5 seconds. Do not copy Seedance duration/reference ceilings or label a small local preview “8K.”

Keep each shot specific: a visible action, an opening composition, screen-relative placement and depth, a fixed lens/FOV, deliberate camera movement, motivated lighting, physical contact and continuity. Describe identity and wardrobe separately from action. Timecoded beats must cover the full shot without gaps or overlaps. Every generated prompt uses the ordered spine: header, style, no text, critical constraints, assets, geometry, first frame, optics, camera, lighting, atmosphere, action timing, physics, acting, audio and continuity locks.

Use captured Lemonade footage to prove product behavior. LTX provides separately labelled scene footage. Add readable marketing titles in the editor; do not ask LTX to invent product UI, captions or testimonials. Inspect the source, the result and consecutive frames. Keep identity, hands, geometry, exposure and screen direction consistent. An encoded file is not a visual-quality pass.

## Capture a directed product take

```js
await studioCommand({action:'format.set',format:'landscape',fps:24});
await studioCommand({action:'record.start',title:'Open the project'});
await studioCommand({action:'cursor.move',x:0.25,y:0.25,durationMs:900});
const screen = await studioCommand({action:'observe'});
// Choose the exact intended control from screen.controls; do not guess refs.
await studioCommand({action:'click',ref:chosen.ref,revision:screen.revision});
await studioCommand({action:'wait',milliseconds:1200});
const take = await studioCommand({action:'record.stop'});
```

The visible pointer is an annotation inside the dedicated demo window. Mouse movement also dispatches real hover input. `click` draws a short ring; `cursor.set` can hide it. Capture preserves elapsed timing, including waits, and records actual frame rate. Edits can zoom smoothly even when the product capture has fewer frames.

## Assemble footage, zooms, titles and audio

```js
await studioCommand({action:'edit.render',edit:{
  title:'Keep client work together',format:'portrait',
  clips:[
    {assetId:take.asset.id,start:0,duration:2,fit:'contain',zoom:{from:1,to:1.4,x:0.5,y:0.45}},
    {assetId:anotherTake.asset.id,start:1,duration:3,fit:'cover',zoom:{from:1.3,to:1,x:0.5,y:0.5}}
  ],
  titles:[{text:'Keep the next step in view',start:0.3,end:4.8,position:'bottom',size:48}],
  audioAssetId:optionalImportedNarrationId,audioGain:0.8
}});
```

Omit `audioAssetId` for silent output. Import audio using `asset.import` with role `audio`; supported formats are WAV, MP3 and M4A. It starts at edit time zero, is padded with silence if short and trimmed if long. Source audio is muted. Narration/music generation and automatic lip-sync are outside this editor. Zoom focal points are normalized within the delivery frame after fitting. Titles support explicit start/end times and top/center/bottom placement; strings are read as text, never filter expressions. Each clip supports 0.5–30 seconds, the edit up to 120 seconds. Longer CPU renders can take several minutes. Inspect the full result and the saved manifest before publication.

## Prepare an LTX shot

First import an actual scene reference image with role `reference`. Then:

```js
const plan=await studioCommand({action:'ltx.prepare',direction:{
  title:'A quiet decision',referenceAssetId:reference.asset.id,duration:3,ratio:'16:9',
  subject:'Describe the person, permanent features and wardrobe visible in the chosen reference.',
  geometry:'Subject screen-left in the foreground; desk mid-ground; window background. Preserve these relationships.',
  firstFrame:'Match the reference composition, already breathing naturally.',
  fov:'47',camera:'Locked tripod, no focal drift.',
  lighting:'Soft daylight from screen-right, matching the reference exposure and colour.',
  atmosphere:'Clean air, no invented haze or particles.',
  physics:'Natural body weight and contact shadows; no sliding or floating.',
  acting:'A small eye movement toward the desk; relaxed brow, no speech.',
  locks:'Same identity, wardrobe, geography and light direction throughout.',
  beats:[{start:0,end:1,action:'Eyes glance toward the desk, shoulders remain relaxed.'},
         {start:1,end:3,action:'Gaze settles; natural breathing continues.'}]
}});
```

Replace every description with what the reference actually shows. The studio saves the full prompt, reference and workflow. Source references are fitted without cropping faces; the existing low-memory graph uses 512×320 landscape, 320×512 portrait or 384×384 square previews. These approximate preview ratios are separate from exact delivery sizes in the editor. The prepared prompt uses no generated captions or dialogue; output is silent.

Finish product capture, stop recording and call `close` to release the Lemonade demo window. The saved session and takes remain available for `ltx.prepare` and editing. This machine did not have enough RAM headroom for the live agent test while another Lemonade demo was open. Keep capture and LTX generation sequential.

Call `ltx.start`, then poll `ltx.status` until ready. The studio starts the installed, offline renderer on `127.0.0.1:8198`, with a 16 GiB commit ceiling, 3 GiB working-set ceiling, 6 GiB GPU headroom target, and the existing 6/8 GiB RAM/commit reserves and GPU watchdog. A single asynchronous weight-transfer stream keeps overlapping text-encoder staging buffers within the GPU budget. Text encoding, video sampling and decoding use the managed GPU runtime. Startup returns immediately. `ltx.stop` releases only the studio-owned renderer and refuses while jobs are queued. The supervisor also exits if its owning studio process exits.

`ltx.submit` requires installed models, live supervision and runtime validation. Local preview validation is saved in `%LOCALAPPDATA%/Signal/runtime/ltx25-studio-preview.json`, tied to the runtime source fingerprint and the exact existing hold. It enables reviewed local previews up to the validated duration while the separate Signal production hold stays intact. A new hold or runtime change invalidates the receipt. Do not delete holds or weaken reserves. If the watchdog stops a job, inspect the reported resource reason rather than retrying automatically. External supervised services can still be configured with `DEMO_STUDIO_LTX_URL` and `DEMO_STUDIO_LTX_LIMITS`; the studio does not take ownership of them. Model/node presence is checked on submission, and a busy renderer is left alone.

Once ready, submit the saved plan exactly once, then poll its ID. If a request is uncertain, inspect the plan/status rather than submitting duplicates. Finished generated footage is labelled `generated-ltx` and `qualityApproved:false`. Review it before including it in an edit. No cloud fallback or automatic publishing is provided.

References: [LTX image-to-video guidance](https://docs.ltx.io/open-source-model/usage-guides/image-to-video), [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html).
