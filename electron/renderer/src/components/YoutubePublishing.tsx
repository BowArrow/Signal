import { useState } from 'react';
import type { VideoAction, VideoView } from '../../../../src/shared/video.js';
import { youtubeCanUpload, type YoutubePolicyInput } from '../../../../src/shared/video-publishing.js';

export function YoutubePublishing({ productId, view, busy, action }: { productId: string; view: VideoView; busy: boolean; action: (value: VideoAction) => Promise<void> }) {
  const saved = view.publishing?.policies.find(p => p.productId === productId);
  const [draft, setDraft] = useState<YoutubePolicyInput>({ enabled: saved?.enabled ?? false, accountId: saved?.accountId ?? '', privacy: saved?.privacy ?? 'private', dailyLimit: saved?.dailyLimit ?? 1, autoQueue: saved?.autoQueue ?? false, madeForKids: saved?.madeForKids ?? false, containsSyntheticMedia: saved?.containsSyntheticMedia ?? true });
  const [uncertain, setUncertain] = useState(false);
  if (!view.publishing) return null;
  const jobs = view.publishing.jobs.filter(j => j.productId === productId);
  const ads = view.jobs.filter(j => j.productId === productId && j.kind === 'ad' && j.phase === 'ready' && j.approvedAt && j.output);
  return <details className="youtube-publishing"><summary>YouTube delivery</summary>
    <p>Run can upload approved ads to your channel. Pause stops further video transfer; YouTube can still finish processing an accepted upload.</p>
    <form onSubmit={e => { e.preventDefault(); void action({ type: 'youtube-configure', productId, value: draft }); }}>
      <label className="video-check"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />Enable YouTube uploads when this business is running</label>
      <label>YouTube channel<select aria-label="YouTube delivery channel" value={draft.accountId} onChange={e => setDraft({ ...draft, accountId: e.target.value })}><option value="">Choose a channel</option>{view.publishing.accounts.filter(a => a.productId === productId).map(a => <option key={a.id} value={a.id} disabled={a.status !== 'verified' || !youtubeCanUpload(a)}>{a.label}{youtubeCanUpload(a) ? '' : ' — reconnect with upload permission'}</option>)}</select></label>
      <label>Video visibility<select value={draft.privacy} onChange={e => setDraft({ ...draft, privacy: e.target.value as YoutubePolicyInput['privacy'] })}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label>
      <p className="growth-muted">YouTube may keep API uploads private until the Google API project passes its audit. Signal displays the visibility YouTube confirms.</p>
      <label>Uploads per rolling 24 hours<input type="number" min={1} max={3} value={draft.dailyLimit} onChange={e => setDraft({ ...draft, dailyLimit: Number(e.target.value) })} /></label><p className="growth-muted">Shared across businesses using this channel. The lowest enabled limit applies; attempted uploads count.</p>
      <label className="video-check"><input type="checkbox" checked={draft.autoQueue} onChange={e => setDraft({ ...draft, autoQueue: e.target.checked })} />Automatically queue ads approved after these settings are saved</label>
      <p className="growth-muted">Uses the approved ad title, end-card headline, call to action and a tracked business website link as the YouTube description.</p>
      <label className="video-check"><input type="checkbox" checked={draft.madeForKids} onChange={e => setDraft({ ...draft, madeForKids: e.target.checked })} />These videos are made for children</label>
      <label className="video-check"><input type="checkbox" checked={draft.containsSyntheticMedia} onChange={e => setDraft({ ...draft, containsSyntheticMedia: e.target.checked })} />Disclose realistic altered or AI-generated content</label>
      <button className="btn" disabled={busy || view.offline}>Save YouTube delivery settings</button><p className="growth-muted">Saving checks the channel and pauses this business. Use Run after reviewing the saved settings.</p>
    </form>
    {saved?.channelId && <p>Saved channel: {saved.channelTitle} · {saved.privacy} · {saved.enabled ? 'enabled with Run' : 'disabled'}</p>}
    {ads.length ? ads.map(ad => <article key={ad.id}><h4>{ad.title}</h4><p>{ad.assembly?.headline} — {ad.assembly?.callToAction}</p><p>{ad.assembly?.destination}</p><button className="btn" disabled={busy || !saved?.enabled || jobs.some(j => j.sourceId === ad.id && (j.status !== 'cancelled' || j.startedAt !== undefined))} onClick={() => void action({ type: 'youtube-queue', productId, id: ad.id })}>Queue approved ad for YouTube</button></article>) : <p>Assemble and approve a finished ad to queue it here.</p>}
    {jobs.length > 0 && <label className="video-check"><input type="checkbox" checked={uncertain} onChange={e => setUncertain(e.target.checked)} />When stopping an attempted upload, I understand it may already exist on YouTube and will not be deleted.</label>}
    {jobs.map(job => <article key={job.id}><h4>{job.metadata.title} · {job.status}</h4><p>{job.detail}</p><progress aria-label="YouTube upload progress" max={job.asset.bytes} value={job.bytesSent} /><details><summary>Upload description</summary><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{job.metadata.description}</p></details>{job.receipt && <p><a href={job.receipt.url} target="_blank" rel="noreferrer">View video on YouTube</a> · confirmed {job.receipt.privacy}</p>}{job.status === 'attention' && <button className="btn" disabled={busy} onClick={() => void action({ type: 'youtube-retry', productId, id: job.id })}>Check existing upload again</button>}{!['delivered', 'cancelled'].includes(job.status) && <button className="btn" disabled={busy || (job.startedAt !== undefined && !uncertain)} onClick={() => void action({ type: 'youtube-cancel', productId, id: job.id, acceptUncertain: uncertain })}>Stop this upload</button>}</article>)}
  </details>;
}
