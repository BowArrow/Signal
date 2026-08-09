import { useMemo, useState } from 'react';
import type { OpportunityView } from '../../../../src/shared/ipc.js';
import { relativeTime, statusClass } from '../lib/format.js';

interface Props {
  readonly opportunities: readonly OpportunityView[];
  readonly ingesting: boolean;
  readonly onIngest: () => void;
  readonly onOpen: (url: string) => void;
}

export function OpportunitiesScreen({
  opportunities,
  ingesting,
  onIngest,
  onOpen,
}: Props): React.JSX.Element {
  const [filter, setFilter] = useState<string>('all');

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: opportunities.length };
    for (const o of opportunities) out[o.status] = (out[o.status] ?? 0) + 1;
    return out;
  }, [opportunities]);

  const filters = useMemo(
    () => ['all', ...Object.keys(counts).filter((k) => k !== 'all').sort()],
    [counts],
  );

  const rows = useMemo(
    () => (filter === 'all' ? opportunities : opportunities.filter((o) => o.status === filter)),
    [opportunities, filter],
  );

  return (
    <div className="page">
      <h1 className="page-title">Opportunities</h1>
      <p className="page-lede">
        Everything ingestion has found. Scoring lands in Phase 2, so nothing here has a total yet
        and nothing has been drafted. No message has left this machine.
      </p>

      <div className="toolbar">
        {filters.map((key) => (
          <button
            key={key}
            type="button"
            className="tag"
            onClick={() => setFilter(key)}
            style={{
              cursor: 'pointer',
              border: `1px solid ${filter === key ? 'var(--color-accent-600)' : 'var(--color-neutral-800)'}`,
              color: filter === key ? 'var(--color-accent-200)' : 'var(--color-neutral-400)',
              background: filter === key ? 'var(--color-accent-900)' : 'transparent',
            }}
          >
            {key} {counts[key] ?? 0}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-primary"
          onClick={onIngest}
          disabled={ingesting}
          style={{ marginLeft: 'auto' }}
        >
          <i className={`ph ph-arrows-clockwise ${ingesting ? 'spin' : ''}`} aria-hidden="true" />
          {ingesting ? 'Polling…' : 'Poll now'}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <div>
            <i className="ph ph-radar" style={{ fontSize: 28, color: 'var(--color-neutral-700)' }} aria-hidden="true" />
            <p>
              Nothing ingested yet. Hit <strong>Poll now</strong> — Hacker News and RSS work without
              credentials; the six subreddits stay dark until Reddit keys are in <code>.env</code>.
            </p>
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ width: '100%', minWidth: 900 }}>
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Source</th>
                <th style={{ textAlign: 'right' }}>Age</th>
                <th style={{ textAlign: 'right' }}>Pts</th>
                <th style={{ textAlign: 'right' }}>Cmts</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(o.url)}>
                  <td style={{ maxWidth: 420 }}>
                    <span
                      style={{
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={o.title}
                    >
                      {o.title}
                    </span>
                  </td>
                  <td style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{o.source}</td>
                  <td className="tnum muted" style={{ textAlign: 'right' }}>
                    {relativeTime(o.postedAt ?? o.discoveredAt)}
                  </td>
                  <td className="tnum muted" style={{ textAlign: 'right' }}>{o.platformScore ?? '—'}</td>
                  <td className="tnum muted" style={{ textAlign: 'right' }}>{o.commentCount ?? '—'}</td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    {o.scoreTotal == null ? <span className="muted">—</span> : o.scoreTotal.toFixed(2)}
                  </td>
                  <td>
                    <span
                      className={statusClass(o.status)}
                      style={{ fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase' }}
                    >
                      {o.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
