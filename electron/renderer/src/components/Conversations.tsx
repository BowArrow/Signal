import { useState } from 'react';
import type { Delivery, OperationAction } from '../../../../src/shared/operations.js';
import { blueskyPostUrl, type ConversationSnapshot } from '../../../../src/shared/conversations.js';

export function Conversations({ productId, jobs, snapshots, busy, offline, act }: {
  productId: string; jobs: Delivery[]; snapshots: ConversationSnapshot[]; busy: boolean; offline: boolean;
  act: (action: OperationAction) => Promise<void>;
}) {
  const conversations = jobs.filter(job => job.productId === productId && job.provider === 'bluesky' && job.reply && job.status === 'published' && job.receipt);
  const [showArchived, setShowArchived] = useState(false);
  const archived = (id: string) => snapshots.some(s => s.productId === productId && s.deliveryId === id && s.archivedAt != null);
  const active = conversations.filter(job => !archived(job.id));
  const unseen = snapshots.filter(s => s.productId === productId && s.archivedAt == null).reduce((sum, s) => sum + s.replies.filter(r => !s.reviewedUris.includes(r.uri)).length, 0);
  const open = (url: string | null) => { if (url) void window.signal.openExternal(url); };
  return <section className="card operation-explanation operation-conversations" id="conversations" aria-label="Tracked conversations">
    <h2>Conversations</h2>
    <p>{active.length} active public conversations · {unseen} responses to review · {conversations.length - active.length} archived</p>
    <label><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived conversations</label>
    <p>See what the person asked, what Signal sent, and who replied. Email conversations are in Sales.</p>
    {!conversations.length && <p>No confirmed public replies yet. Researched posts appear under Search activity until Signal actually replies.</p>}
    {!active.length && conversations.length > 0 && <p>No active conversations. Archived replies remain in history and are no longer checked automatically.</p>}
    {conversations.filter(job => showArchived || !archived(job.id)).map(job => {
      const snapshot = snapshots.find(s => s.deliveryId === job.id && s.productId === productId);
      const unread = snapshot?.replies.filter(reply => !snapshot.reviewedUris.includes(reply.uri)) ?? [];
      return <article className="conversation-thread" key={job.id}>
        <h3>{job.title}</h3>
        <p className="muted">Bluesky · Sent {new Date(job.receipt!.confirmedAt).toLocaleString()}</p>
        <div className="conversation-message"><strong>Original post</strong><p>{job.reply!.text}</p></div>
        <div className="conversation-message conversation-sent"><strong>Signal’s reply</strong><p>{job.body}</p></div>
        <div className="operation-actions">
          <button className="btn" onClick={() => open(blueskyPostUrl(job.reply!.uri))}>Open original post</button>
          <button className="btn" onClick={() => open(blueskyPostUrl(job.receipt!.id))}>Open conversation</button>
          {!archived(job.id) && <button className="btn" disabled={busy || offline} onClick={() => void act({ type: 'refresh-conversation', productId, id: job.id })}>Check responses</button>}
          <button className="btn" disabled={busy} onClick={() => void act({ type: 'track-conversation', productId, id: job.id, tracking: archived(job.id) })}>{archived(job.id) ? 'Resume tracking' : 'Stop tracking'}</button>
          {unread.length > 0 && <button className="btn" disabled={busy} onClick={() => void act({ type: 'review-conversation', productId, id: job.id, uris: unread.map(reply => reply.uri) })}>Mark shown responses reviewed</button>}
        </div>
        <p role="status">{archived(job.id) ? snapshot?.detail : snapshot?.status === 'current' ? snapshot.replies.length ? 'Responses found. Review them below or continue the conversation on Bluesky.' : 'No responses observed at the last check.' : snapshot?.detail ?? 'Responses have not been checked yet.'}</p>
        {snapshot?.checkedAt && <p className="muted">Last successful check: {new Date(snapshot.checkedAt).toLocaleString()}</p>}
        {snapshot?.replies.map(reply => <div className="conversation-message" key={reply.uri}>
          <strong>@{reply.handle}{reply.originalAuthor ? ' · Original author' : ''}{snapshot.reviewedUris.includes(reply.uri) ? ' · Reviewed' : ' · New'}</strong>
          <p>{reply.text}</p>
          <p className="muted">{new Date(reply.postedAt).toLocaleString()}</p>
          <button className="btn" onClick={() => open(reply.url)}>Open response</button>
        </div>)}
      </article>;
    })}
    {conversations.length > 0 && <p className="muted">While marketing runs, Signal checks recent threads about every 15 minutes. Checks cover up to two reply levels; the live thread may contain more. Responses stay here for review; Signal does not automatically send another reply in these threads.</p>}
  </section>;
}
