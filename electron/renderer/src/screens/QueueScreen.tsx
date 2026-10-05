import { useCallback, useEffect, useMemo, useState } from 'react';
import type { QueueItemView } from '../../../../src/shared/ipc.js';
import { relativeTime } from '../lib/format.js';

const REJECTION_REASONS = [
  'Product named too early',
  'Marketing register',
  'Numbers I cannot verify',
  'Thread already answered',
  'Wrong community',
  'Not worth replying to',
];

interface Props {
  readonly onToast: (message: string, kind?: 'ok' | 'warn') => void;
  readonly onChanged: () => void;
}

export function QueueScreen({ onToast, onChanged }: Props): React.JSX.Element {
  const [items, setItems] = useState<QueueItemView[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState(REJECTION_REASONS[0] as string);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const next = await window.signal.queue();
    setItems(next);
    setSelectedId((current) => {
      if (current && next.some((i) => i.draftId === current)) return current;
      return next[0]?.draftId ?? null;
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => items?.find((i) => i.draftId === selectedId) ?? null,
    [items, selectedId],
  );

  // Keyed on the draft id rather than the item, so a background refresh does
  // not clobber text that is being typed.
  const openDraftId = selected?.draftId ?? null;
  const openDraftBody = selected?.body ?? '';
  useEffect(() => {
    if (openDraftId) setBody(openDraftBody);
    // openDraftBody is deliberately not a dependency: re-running on every
    // refresh would discard an in-progress edit.
  }, [openDraftId]);

  const saveEdit = useCallback(async () => {
    if (!selected || body === selected.body) return;
    await window.signal.editDraft(selected.draftId, body);
    await load();
  }, [selected, body, load]);

  const doApprove = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      // Persist the edit first — approving publishes what is stored, and a
      // change still sitting in this textarea is not what was reviewed.
      if (body !== selected.body) await window.signal.editDraft(selected.draftId, body);

      const result = await window.signal.approve(selected.draftId);
      if (!result.ok) {
        onToast(result.blockedBy ?? 'refused', 'warn');
        await load();
        return;
      }
      onToast(
        result.method === 'manual'
          ? `copied to your clipboard — paste it, then it is recorded${result.trackedUrl ? ' with a tracked link' : ''}`
          : 'published',
      );
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }, [selected, body, load, onChanged, onToast]);

  const doReject = useCallback(async () => {
    if (!selected) return;
    await window.signal.reject(selected.draftId, reason, note || undefined);
    setRejecting(false);
    setNote('');
    onToast(`rejected — "${reason}" recorded for the digest`);
    await load();
    onChanged();
  }, [selected, reason, note, load, onChanged, onToast]);

  if (items == null) {
    return (
      <div className="page">
        <h1 className="page-title">Review queue</h1>
        <p className="page-lede">Loading…</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="empty" style={{ height: '100%' }}>
        <div>
          <i className="ph ph-tray" style={{ fontSize: 28, color: 'var(--color-neutral-700)' }} aria-hidden="true" />
          <p>
            Nothing waiting. Ingestion keeps running; anything that clears the threshold and has a
            rules record will appear here.
          </p>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            Drafting needs a model. <span className="mono">pnpm signal llm check</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="queue-split">
      <section className="queue-list">
        <header className="queue-list-header">
          <h1 className="page-title" style={{ fontSize: 20, lineHeight: '28px', margin: '0 0 4px' }}>
            Review queue
          </h1>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {items.length} waiting on you. Nothing publishes until you approve it.
          </p>
        </header>
        <div className="queue-list-scroll">
          {items.map((item) => (
            <button
              key={item.draftId}
              type="button"
              className={`queue-row${item.draftId === selectedId ? ' is-selected' : ''}`}
              onClick={() => setSelectedId(item.draftId)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                <span style={{ fontSize: 12, color: 'var(--color-accent-300)' }}>{item.community}</span>
                <span className="row-spacer tnum muted" style={{ fontSize: 12 }}>
                  {item.total?.toFixed(2) ?? '—'}
                </span>
              </div>
              <p style={{ margin: '0 0 7px', fontSize: 14, lineHeight: '21px' }}>{item.title}</p>
              <div className="muted" style={{ display: 'flex', gap: 7, fontSize: 12 }}>
                <span>{relativeTime(item.postedAt)}</span>
                <span>·</span>
                <span>{item.product ?? 'no product'}</span>
                {item.blockedBy && <span className="row-spacer block">blocked</span>}
                {!item.blockedBy && item.publishMethod === 'manual' && (
                  <span className="row-spacer warn">paste</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="queue-detail">
        {selected && (
          <>
            <header className="queue-detail-header">
              <span className="tag tag-outline">{selected.community}</span>
              <span className="tag tag-accent">score {selected.total?.toFixed(2) ?? '—'}</span>
              <span className="muted" style={{ fontSize: 13 }}>
                {selected.publishMethod === 'manual'
                  ? 'copy and paste — no API publish path'
                  : 'publishes via the API on approval'}
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setRejecting(true)}>
                  Reject
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void doApprove()}
                  disabled={busy || selected.blockedBy != null}
                  title={selected.blockedBy ?? 'All checks pass'}
                >
                  {selected.publishMethod === 'manual' ? 'Approve & copy' : 'Approve & publish'}
                </button>
              </div>
            </header>

            <div className="queue-detail-scroll">
              <div className="queue-thread">
                <p className="card-kicker">Original thread</p>
                <h2 className="section-title" style={{ fontSize: 19, lineHeight: '27px' }}>
                  {selected.title}
                </h2>
                <p className="muted" style={{ margin: '0 0 14px', fontSize: 12.5 }}>
                  {selected.author ? `u/${selected.author} · ` : ''}
                  {relativeTime(selected.postedAt)} ago ·{' '}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      void window.signal.openExternal(selected.url);
                    }}
                  >
                    open the thread
                  </a>
                </p>
                <p className="selectable thread-body">{selected.threadBody || '(link post — no body)'}</p>

                <hr className="hr" />

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                  <p className="card-kicker" style={{ margin: 0 }}>
                    Draft
                  </p>
                  <span className="mono muted">{selected.promptVersion}</span>
                  {selected.edited && <span className="ok" style={{ fontSize: 12 }}>edited by you</span>}
                  <span className="row-spacer tnum muted" style={{ fontSize: 12 }}>
                    {body.length} chars
                  </span>
                </div>

                <textarea
                  className="input selectable"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onBlur={() => void saveEdit()}
                  spellCheck={false}
                  style={{
                    width: '100%',
                    minHeight: 300,
                    resize: 'vertical',
                    fontFamily: 'var(--font-body)',
                    fontSize: 14.5,
                    lineHeight: '25px',
                    padding: '16px 18px',
                  }}
                />
                <p className="muted" style={{ marginTop: 12, fontSize: 12.5 }}>
                  Edits are saved separately; the generated body is kept for the learning loop.
                </p>
              </div>

              <aside className="queue-aside">
                <div className="card">
                  <p className="card-kicker">Score breakdown</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 12 }}>
                    {selected.axes.map((axis) => (
                      <div key={axis.key}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                          <span>{axis.label}</span>
                          <span className="tnum muted">
                            {axis.value.toFixed(2)} <span className="muted">×{axis.weight.toFixed(2)}</span>
                          </span>
                        </div>
                        <div style={{ height: 3, borderRadius: 2, background: 'var(--color-neutral-800)' }}>
                          <div
                            style={{
                              height: 3,
                              borderRadius: 2,
                              width: `${Math.round(axis.value * 100)}%`,
                              background:
                                axis.key === 'contribution'
                                  ? 'var(--color-accent)'
                                  : axis.key === 'risk'
                                    ? 'var(--color-neutral-500)'
                                    : 'var(--color-accent-400)',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <p className="card-kicker">Validators</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                    {selected.validators.map((v) => (
                      <div key={v.rule} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                        <i
                          className={`ph ${v.state === 'pass' ? 'ph-check-circle' : v.state === 'warn' ? 'ph-warning-circle' : 'ph-prohibit'}`}
                          style={{
                            fontSize: 15,
                            lineHeight: '21px',
                            flex: 'none',
                            color:
                              v.state === 'pass'
                                ? 'var(--color-accent-400)'
                                : v.state === 'warn'
                                  ? 'var(--color-warn)'
                                  : 'var(--color-block)',
                          }}
                          aria-hidden="true"
                        />
                        <span style={{ fontSize: 13, lineHeight: '21px' }}>{v.message}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <p className="card-kicker">Publish limits</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                    {selected.limits.map((l) => (
                      <div key={l.rule} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                        <i
                          className={`ph ${l.passed ? 'ph-check-circle' : 'ph-prohibit'}`}
                          style={{
                            fontSize: 15,
                            lineHeight: '21px',
                            flex: 'none',
                            color: l.passed ? 'var(--color-accent-400)' : 'var(--color-block)',
                          }}
                          aria-hidden="true"
                        />
                        <span style={{ fontSize: 13, lineHeight: '21px' }}>{l.message}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <p className="card-kicker">Community rules</p>
                  <p className="card-title" style={{ fontSize: 15 }}>
                    {selected.community}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                    <Row label="Self-promo" value={selected.rules.selfPromo ?? 'unknown'} />
                    <Row
                      label="Ratio cap"
                      value={selected.rules.ratioCapPct != null ? `${selected.rules.ratioCapPct}%` : 'not stated'}
                    />
                    <Row label="Flair" value={selected.rules.flairRequired ? 'required' : 'not required'} />
                    <Row
                      label="Reviewed"
                      value={selected.rules.verified ? relativeTime(selected.rules.reviewedAt) : 'never'}
                      warn={!selected.rules.verified}
                    />
                  </div>
                </div>
              </aside>
            </div>
          </>
        )}
      </section>

      {rejecting && selected && (
        <div className="dialog-backdrop" onClick={() => setRejecting(false)}>
          <div className="dialog" style={{ width: 'min(520px, calc(100vw - 48px))' }} onClick={(e) => e.stopPropagation()}>
            <p className="dialog-title">Reject with reason</p>
            <div className="dialog-body">
              <p style={{ margin: '0 0 14px', fontSize: 13.5, lineHeight: '23px' }}>
                Reasons are stored on the draft and surfaced in the weekly digest, so the prompts
                can be fixed rather than the same mistake made again.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                {REJECTION_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className="tag"
                    onClick={() => setReason(r)}
                    style={{
                      cursor: 'pointer',
                      border: `1px solid ${reason === r ? 'var(--color-accent-600)' : 'var(--color-neutral-800)'}`,
                      color: reason === r ? 'var(--color-accent-200)' : 'var(--color-neutral-400)',
                      background: reason === r ? 'var(--color-accent-900)' : 'transparent',
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <textarea
                className="input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything else worth recording"
                style={{ width: '100%', minHeight: 92, resize: 'vertical', fontSize: 14 }}
              />
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setRejecting(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void doReject()}>
                Reject draft
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
      <span className="muted">{label}</span>
      <span className={warn ? 'warn' : undefined} style={{ textAlign: 'right' }}>
        {value}
      </span>
    </div>
  );
}
