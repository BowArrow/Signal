import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CommunityView, SystemStatus } from '../../../../src/shared/ipc.js';
import { relativeTime } from '../lib/format.js';

const FIXED_RULES = [
  {
    icon: 'ph-hand-palm',
    title: 'Review queue approval',
    note: 'Drafts in the review queue need your approval. Automatic marketing uses the separate permissions and limits saved in Operations and Sales.',
  },
  {
    icon: 'ph-clipboard-text',
    title: 'Hacker News research',
    note: 'Operations uses Hacker News to understand problems, not to post replies. Its community rules prohibit AI-written or AI-edited comments.',
  },
  {
    icon: 'ph-user-circle',
    title: 'Business account permissions',
    note: 'Manage accounts in Connections and select publishing destinations in Operations. Linking an account alone does not start outreach.',
  },
  {
    icon: 'ph-seal-check',
    title: 'Product disclosure',
    note: 'Review-queue drafts that name a product must include the required disclosure before approval.',
  },
  {
    icon: 'ph-book-open-text',
    title: 'Community rules',
    note: 'Review community rules and their sources below. Blocking a community prevents further drafts in the review-queue workflow.',
  },
];

function policyClass(policy: string | null, verified: boolean): string {
  if (!policy) return 'block';
  if (policy === 'forbidden') return 'block';
  return verified ? 'ok' : 'warn';
}

interface Props {
  readonly status: SystemStatus | null;
  readonly onToast: (message: string, kind?: 'ok' | 'warn') => void;
}

export function GuardrailsScreen({ status, onToast }: Props): React.JSX.Element {
  const [rows, setRows] = useState<CommunityView[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [onlyUnknown, setOnlyUnknown] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setRows(await window.signal.communities()); setError(''); }
    catch { setError('Could not load community rules. Retry to read their current status.'); }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const confirm = useCallback(
    async (row: CommunityView) => {
      await window.signal.reviewRules(row.id);
      await load();
      onToast(`${row.displayName} marked reviewed`);
    },
    [load, onToast],
  );

  const block = useCallback(
    async (row: CommunityView) => {
      await window.signal.blockCommunity(row.id, 'blocked from the guardrails screen');
      await load();
      onToast(`${row.displayName} blocked — nothing will be drafted there again`, 'warn');
    },
    [load, onToast],
  );

  const visible = useMemo(
    () => (onlyUnknown ? rows.filter((r) => r.selfPromo == null && !r.blocked) : rows),
    [rows, onlyUnknown],
  );

  const unknown = rows.filter((r) => r.selfPromo == null && !r.blocked).length;
  const unverified = rows.filter((r) => r.selfPromo != null && !r.verified).length;

  return (
    <div className="page">
      <h1 className="page-title">Guardrails</h1>
      <p className="page-lede">
        Community rules and limits for the review queue. Manage automatic marketing
        permissions separately in Operations and Sales.
      </p>
      {error && <div role="alert"><p>{error}</p><button className="btn" onClick={() => void load()}>Retry loading rules</button></div>}

      <div style={{ display: 'grid', gap: 0, marginBottom: 34 }}>
        {FIXED_RULES.map((rule) => (
          <div
            key={rule.title}
            style={{
              display: 'grid',
              gridTemplateColumns: '26px minmax(0, 250px) minmax(0, 1fr) auto',
              gap: 18,
              alignItems: 'baseline',
              padding: '18px 0',
              borderBottom: '1px solid var(--color-neutral-900)',
            }}
          >
            <i className={`ph ${rule.icon}`} style={{ fontSize: 17, color: 'var(--color-accent)' }} aria-hidden="true" />
            <h3 className="section-title" style={{ margin: 0, fontSize: 15.5 }}>
              {rule.title}
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: 13.5,
                lineHeight: '23px',
                color: 'color-mix(in srgb, var(--color-text) 76%, transparent)',
              }}
            >
              {rule.note}
            </p>
            <span
              className="muted"
              style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}
            >
              no off switch
            </span>
          </div>
        ))}
      </div>

      <h2 className="section-title">Limits</h2>
      <div className="grid-cards" style={{ marginBottom: 34 }}>
        <div className="card">
          <p className="card-kicker">replies per platform / day</p>
          <p className="stat">{status?.limits.maxRepliesPerPlatformPerDay ?? '—'}</p>
          <p className="card-meta">a calendar day in your timezone, not a rolling window</p>
        </div>
        <div className="card">
          <p className="card-kicker">cooldown in one community</p>
          <p className="stat">{status?.limits.communityCooldownDays ?? '—'}d</p>
          <p className="card-meta">measured from your most recent post there</p>
        </div>
        <div className="card">
          <p className="card-kicker">self-promo ratio cap</p>
          <p className="stat">{status?.limits.selfPromoRatioMaxPct ?? '—'}%</p>
          <p className="card-meta">
            counts the reply about to go out, so a promotional first post is always refused
          </p>
        </div>
      </div>

      <h2 className="section-title">Community rules registry</h2>
      <p className="page-lede" style={{ marginBottom: 14 }}>
        Fetched from what each community published, never guessed. Every reading is stored
        unverified next to the sentences it quoted — expand a row to check one against the other.
      </p>

      <div className="toolbar">
        <button
          type="button"
          className="tag"
          onClick={() => setOnlyUnknown((v) => !v)}
          style={{
            cursor: 'pointer',
            border: `1px solid ${onlyUnknown ? 'var(--color-accent-600)' : 'var(--color-neutral-800)'}`,
            color: onlyUnknown ? 'var(--color-accent-200)' : 'var(--color-neutral-400)',
            background: onlyUnknown ? 'var(--color-accent-900)' : 'transparent',
          }}
        >
          rules_unknown {unknown}
        </button>
        {unverified > 0 && (
          <span className="warn" style={{ fontSize: 12.5 }}>
            {unverified} read by a model and never confirmed
          </span>
        )}
        <span className="row-spacer muted" style={{ fontSize: 12.5 }}>
          {rows.length} communities
        </span>
      </div>

      <div className="table-wrap">
        <table className="table" style={{ width: '100%', minWidth: 860 }}>
          <thead>
            <tr>
              <th>Community</th>
              <th style={{ textAlign: 'right' }}>Opps</th>
              <th>Self-promo</th>
              <th style={{ textAlign: 'right' }}>Conf</th>
              <th>Reviewed</th>
              <th style={{ textAlign: 'right' }}>Fetched</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <>
                <tr
                  key={row.id}
                  onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    {row.displayName}
                    {row.monitored && (
                      <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>
                        monitored
                      </span>
                    )}
                  </td>
                  <td className="tnum muted" style={{ textAlign: 'right' }}>
                    {row.opportunities}
                  </td>
                  <td>
                    <span className={policyClass(row.selfPromo, row.verified)} style={{ fontSize: 12 }}>
                      {row.blocked ? 'BLOCKED' : (row.selfPromo ?? 'rules_unknown')}
                    </span>
                  </td>
                  <td className="tnum muted" style={{ textAlign: 'right' }}>
                    {row.confidence == null ? '—' : row.confidence.toFixed(2)}
                  </td>
                  <td className={row.verified ? 'ok' : 'muted'} style={{ fontSize: 12 }}>
                    {row.selfPromo == null ? '—' : row.verified ? 'yes' : 'no'}
                  </td>
                  <td className="tnum muted" style={{ textAlign: 'right' }}>
                    {relativeTime(row.fetchedAt)}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {row.selfPromo != null && !row.verified && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: 12.5, padding: '3px 10px' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          void confirm(row);
                        }}
                      >
                        Confirm
                      </button>
                    )}
                  </td>
                </tr>

                {expanded === row.id && (
                  <tr key={`${row.id}-detail`}>
                    <td colSpan={7} style={{ background: 'var(--color-neutral-900)' }}>
                      <div style={{ padding: '14px 4px 18px' }}>
                        {row.evidence.length > 0 ? (
                          <>
                            <p className="card-kicker">quoted as evidence</p>
                            {row.evidence.map((quote) => (
                              <p
                                key={quote}
                                className="selectable"
                                style={{ margin: '6px 0', fontSize: 13.5, lineHeight: '22px' }}
                              >
                                <span className="muted">&ldquo;</span>
                                {quote}
                                <span className="muted">&rdquo;</span>
                              </p>
                            ))}
                          </>
                        ) : (
                          <p className="warn" style={{ margin: 0, fontSize: 13.5 }}>
                            No evidence quoted — treat this reading with suspicion. A permissive
                            claim with nothing to back it is automatically demoted.
                          </p>
                        )}

                        <p className="card-meta" style={{ marginTop: 12 }}>
                          {row.rawRuleCount} rules captured verbatim
                          {row.ratioCapPct != null && ` · states a ${row.ratioCapPct}% cap`}
                          {row.flairRequired && ' · flair required'}
                        </p>

                        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                          {row.sourceUrl && (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => void window.signal.openExternal(row.sourceUrl as string)}
                            >
                              Open the rules page
                            </button>
                          )}
                          {!row.blocked && (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => void block(row)}
                            >
                              Never draft here
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {unknown > 0 && (
        <p className="muted" style={{ marginTop: 16, fontSize: 13.5 }}>
          {unknown} communities have no rules record, so nothing is drafted for them.{' '}
          <span className="mono">pnpm signal rules fetch --all</span>
        </p>
      )}
    </div>
  );
}
