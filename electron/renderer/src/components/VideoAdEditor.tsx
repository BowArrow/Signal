import { useState } from 'react';
import type { VideoAction, VideoAd, VideoView } from '../../../../src/shared/video.js';

export function VideoAdEditor({ productId, view, busy, action }: { productId: string; view: VideoView; busy: boolean; action: (value: VideoAction) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [musicTitle, setMusicTitle] = useState(''); const [musicPreview, setMusicPreview] = useState(''); const [musicError, setMusicError] = useState('');
  const [edit, setEdit] = useState<VideoAd>({ title: '', ratio: '9:16', clips: [], headline: '', callToAction: '', destination: '' });
  const clips = view.jobs.filter(job => job.productId === productId && job.kind === 'shot' && job.output && job.approvedAt);
  const tracks = view.music.filter(track => track.productId === productId);
  const duration = edit.clips.reduce((sum, clip) => sum + clip.duration, 3);
  const change = (index: number, value: Partial<VideoAd['clips'][number]>) => setEdit({ ...edit, clips: edit.clips.map((clip, i) => i === index ? { ...clip, ...value } : clip) });
  return <details className="video-ad-editor"><summary>Assemble a finished ad</summary>
    <p>Use approved clips, add narration, music, text and a three-second end card. Editing runs locally on CPU. Ads stay in the production queue for playback review.</p>
    <label>Imported clip title<input minLength={3} maxLength={120} value={title} onChange={e => setTitle(e.target.value)} /></label>
    <button type="button" className="btn" disabled={busy || !view.ffmpegReady || title.trim().length < 3} onClick={() => void action({ type: 'import-clip', productId, title })}>Import MP4 footage</button>
    {!clips.length && <p>Import footage or finish a generated shot, then preview and approve it in the production queue.</p>}
    <details><summary>Audio library and voice setup</summary>
      <p>Local narration: {view.narrationReady ? 'ready · Kokoro stock voices' : 'not installed'}. Runs on CPU with two threads and a 4 GB memory cap.</p>
      <button type="button" className="btn" disabled={busy || view.offline} onClick={() => void action({ type: 'install-narration' })}>{view.narrationReady ? 'Verify voice setup' : 'Set up local voice'}</button>
      {!view.narrationReady && <p>The one-time setup downloads about 354 MB of model files plus dependencies. Requires Python 3.11; narration then works offline.</p>}
      <label>Music title<input minLength={3} maxLength={120} value={musicTitle} onChange={e => setMusicTitle(e.target.value)} /></label>
      <p>Import a track you have rights to use in your ads. Supported: WAV, MP3, M4A and FLAC.</p>
      <button type="button" className="btn" disabled={busy || !view.ffmpegReady || musicTitle.trim().length < 3} onClick={() => void action({ type: 'import-music', productId, title: musicTitle })}>Import music</button>
    </details>
    <form onSubmit={e => { e.preventDefault(); void action({ type: 'assemble', productId, value: edit }); }}>
      <label>Ad title<input required minLength={3} maxLength={120} value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} /></label>
      <label>Ad frame shape<select value={edit.ratio} onChange={e => setEdit({ ...edit, ratio: e.target.value as VideoAd['ratio'] })}><option value="9:16">Portrait · 9:16</option><option value="16:9">Landscape · 16:9</option><option value="1:1">Square · 1:1</option></select></label>
      {edit.clips.map((clip, index) => <fieldset key={index}><legend>Clip {index + 1}</legend>
        <label>Approved footage<select value={clip.jobId} onChange={e => change(index, { jobId: e.target.value, start: 0, duration: Math.min(5, clips.find(job => job.id === e.target.value)?.duration ?? 5) })}>{clips.map(job => <option key={job.id} value={job.id}>{job.title} · {job.duration.toFixed(1)} seconds</option>)}</select></label>
        <label>Start in seconds<input required type="number" min={0} max={300} step={0.1} value={clip.start} onChange={e => change(index, { start: Number(e.target.value) })} /></label>
        <label>Length in seconds<input required type="number" min={1} max={15} step={0.1} value={clip.duration} onChange={e => change(index, { duration: Number(e.target.value) })} /></label>
        <label>Text overlay · optional<input maxLength={90} value={clip.caption} onChange={e => change(index, { caption: e.target.value })} /></label>
        <button type="button" className="btn" disabled={index === 0} onClick={() => { const next = [...edit.clips]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; setEdit({ ...edit, clips: next }); }}>Move earlier</button>
        <button type="button" className="btn" onClick={() => setEdit({ ...edit, clips: edit.clips.filter((_, i) => i !== index) })}>Remove clip</button>
      </fieldset>)}
      <button type="button" className="btn" disabled={!clips.length || edit.clips.length >= 6} onClick={() => { const first = clips[0]; if (first) setEdit({ ...edit, clips: [...edit.clips, { jobId: first.id, start: 0, duration: Math.min(5, first.duration), caption: '' }] }); }}>Add approved clip</button>
      <label>End-card headline<input required maxLength={60} value={edit.headline} onChange={e => setEdit({ ...edit, headline: e.target.value })} /></label>
      <label>Call to action<input required maxLength={40} value={edit.callToAction} onChange={e => setEdit({ ...edit, callToAction: e.target.value })} /></label>
      <label>Destination on this business’s website<input required type="url" maxLength={160} placeholder="https://your-site.com/get-started" value={edit.destination} onChange={e => setEdit({ ...edit, destination: e.target.value })} /></label>
      <fieldset><legend>Sound and narration</legend>
        <label className="video-check"><input type="checkbox" checked={edit.keepSourceAudio !== false} onChange={e => setEdit({ ...edit, keepSourceAudio: e.target.checked })} />Keep clip audio · lowered when narration is present</label>
        <label className="video-check"><input type="checkbox" checked={Boolean(edit.narration)} disabled={!view.narrationReady} onChange={e => { const next = { ...edit }; if (e.target.checked) next.narration = { text: '', voice: 'af_heart', speed: 1, start: 0, captions: true }; else delete next.narration; setEdit(next); }} />Generate local narration</label>
        {edit.narration && <>
          <label>Narration script<textarea required minLength={3} maxLength={900} rows={4} value={edit.narration.text} onChange={e => setEdit({ ...edit, narration: { ...edit.narration!, text: e.target.value } })} /></label>
          <label>Voice<select value={edit.narration.voice} onChange={e => setEdit({ ...edit, narration: { ...edit.narration!, voice: e.target.value as NonNullable<VideoAd['narration']>['voice'] } })}><option value="af_heart">Heart · US feminine</option><option value="am_michael">Michael · US masculine</option><option value="bf_emma">Emma · UK feminine</option><option value="bm_george">George · UK masculine</option></select></label>
          <label>Speaking speed<input type="number" min={0.8} max={1.2} step={0.05} value={edit.narration.speed} onChange={e => setEdit({ ...edit, narration: { ...edit.narration!, speed: Number(e.target.value) } })} /></label>
          <label>Narration starts at · seconds<input type="number" min={0} max={Math.min(20, duration - 1)} step={0.1} value={edit.narration.start} onChange={e => setEdit({ ...edit, narration: { ...edit.narration!, start: Number(e.target.value) } })} /></label>
          <label className="video-check"><input type="checkbox" checked={edit.narration.captions} onChange={e => setEdit({ ...edit, narration: { ...edit.narration!, captions: e.target.checked } })} />Show narration captions</label>
          <p>Shorten the script if it exceeds the edit. Signal keeps the spoken ending intact. Review pronunciation and caption timing in the final preview.</p>
        </>}
        <label>Background music<select value={edit.music?.trackId ?? ''} onChange={e => { const next = { ...edit }; if (e.target.value) next.music = { trackId: e.target.value, gainDb: -22 }; else delete next.music; setEdit(next); setMusicPreview(''); setMusicError(''); }}><option value="">No added music</option>{tracks.map(track => <option value={track.id} key={track.id}>{track.title}</option>)}</select></label>
        {edit.music && <><label>Music level · dB<input type="number" min={-36} max={-6} value={edit.music.gainDb} onChange={e => setEdit({ ...edit, music: { ...edit.music!, gainDb: Number(e.target.value) } })} /></label><button type="button" className="btn" onClick={() => { void window.signal.videoPreview(productId, edit.music!.trackId, 'music').then(value => setMusicPreview(value.dataUrl)).catch(error => setMusicError(String(error))); }}>Preview music</button></>}
        {musicPreview && <audio src={musicPreview} controls />}{musicError && <p role="alert">{musicError}</p>}
      </fieldset>
      <p>{duration.toFixed(1)} seconds including the end card. Maximum 60 seconds. Narration captions follow the generated script; existing clip dialogue is not transcribed.</p>
      <button className="btn btn-primary" disabled={busy || !view.ffmpegReady || !edit.clips.length || duration > 60}>Create finished ad</button>
    </form>
  </details>;
}
