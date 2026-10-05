import { useState } from 'react';
import type { VideoAction } from '../../../../src/shared/video.js';
import type { VideoCampaignPolicy, VideoCampaignView } from '../../../../src/shared/video-campaigns.js';

export function VideoCampaigns({ productId, view, busy, action }: { productId: string; view: VideoCampaignView; busy: boolean; action: (value: VideoAction) => Promise<void> }) {
  const saved = view.policies.find(p => p.productId === productId)!;
  const [draft, setDraft] = useState<VideoCampaignPolicy>(saved);
  const status = view.statuses.find(s => s.productId === productId);
  return <details className="video-campaigns"><summary>Automatic video production</summary>
    <p>Run can research and direct a cloud character shot, then assemble it into an ad after you approve the clip. The finished ad needs playback approval. YouTube delivery follows its separate settings.</p>
    <form onSubmit={e => { e.preventDefault(); const { enabled, intervalHours, objective } = draft; void action({ type: 'campaign-configure', productId, value: { enabled, intervalHours, objective } }); }}>
      <label className="video-check"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />Create video ads while this business is running</label>
      <label>Minimum hours between production cycles<input type="number" min={24} max={168} value={draft.intervalHours} onChange={e => setDraft({ ...draft, intervalHours: Number(e.target.value) })} /></label>
      <label>What should these ads accomplish?<textarea minLength={20} maxLength={1200} rows={3} value={draft.objective} onChange={e => setDraft({ ...draft, objective: e.target.value })} /></label>
      <button className="btn" disabled={busy}>Save video production schedule</button>
      <p className="growth-muted">Saving pauses this business. Configure the cloud key, budget, agent allowance and approved character before Run. A cycle waits for review before creating another; failed planning does not trigger replacement renders.</p>
    </form>
    {status && <p role="status">{status.detail}</p>}
  </details>;
}
