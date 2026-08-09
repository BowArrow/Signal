import type { SystemStatus } from '../../../../src/shared/ipc.js';
import { interval, money, relativeTime } from '../lib/format.js';

interface Props {
  readonly status: SystemStatus | null;
  readonly onToggleSource: (sourceId: string, enabled: boolean, name: string) => void;
}

const TABLES: readonly { name: string; note: string }[] = [
  { name: 'products', note: 'positioning, target buyer, price, proof points, UTM base' },
  { name: 'sources', note: 'subreddit / HN / RSS / Discord, poll interval, enabled' },
  { name: 'community_rules', note: 'self-promo policy, ratio, notes, last reviewed' },
  { name: 'opportunities', note: 'discovered item, raw score components, total, status' },
  { name: 'drafts', note: 'prompt version, body, disclosure flag, validator results' },
  { name: 'publications', note: 'platform, external post id, published_at, tracked link' },
  { name: 'links / clicks', note: 'tracked redirect records and their click log' },
  { name: 'metrics', note: 'time-series rows per publication, never overwritten' },
  { name: 'conversions', note: 'order id, amount, attributed_publication_id (nullable)' },
  { name: 'content_calendar', note: 'owned-channel items: posts, devlogs, launches' },
  { name: 'jobs', note: 'the durable queue, in the same file' },
  { name: 'settings', note: 'runtime overrides for weights, threshold, limits' },
];

export function SystemScreen({ status, onToggleSource }: Props): React.JSX.Element {
  if (!status) {
    return (
      <div className="page">
        <h1 className="page-title">System</h1>
        <p className="page-lede">Reading state…</p>
      </div>
    );
  }

  const missingRules = status.sources.filter((s) => !s.hasRulesRecord).length;

  return (
    <div className="page">
      <h1 className="page-title">System</h1>
      <p className="page-lede">
        Single repo, TypeScript, SQLite in one file. Config is validated with Zod at boot and fails
        loudly. The engine runs in the Electron main process; this window only reads.
      </p>

      <div className="grid-cards" style={{ marginBottom: 30 }}>
        <div className="card">
          <p className="card-kicker">Opportunities</p>
          <p className="stat">
            {Object.values(status.opportunityCounts).reduce((a, b) => a + b, 0)}
          </p>
          <p className="card-meta">
            {Object.entries(status.opportunityCounts)
              .map(([k, v]) => `${k} ${v}`)
              .join(' · ') || 'none yet'}
          </p>
        </div>
        <div className="card">
          <p className="card-kicker">Sources polling</p>
          <p className="stat">
            {status.sources.filter((s) => s.enabled).length}
            <span className="muted" style={{ fontSize: 18 }}>
              /{status.sources.length}
            </span>
          </p>
          <p className="card-meta">
            {missingRules > 0 ? (
              <span className="block">{missingRules} without a rules record</span>
            ) : (
              'all have rules records'
            )}
          </p>
        </div>
        <div className="card">
          <p className="card-kicker">Job queue</p>
          <p className="stat">{status.queueStats['pending'] ?? 0}</p>
          <p className="card-meta">
            {Object.entries(status.queueStats)
              .map(([k, v]) => `${k} ${v}`)
              .join(' · ') || 'empty'}
          </p>
        </div>
        <div className="card">
          <p className="card-kicker">Publish limits</p>
          <p className="stat">{status.limits.maxRepliesPerPlatformPerDay}</p>
          <p className="card-meta">
            per platform / day · {status.limits.communityCooldownDays}d cooldown ·{' '}
            {status.limits.selfPromoRatioMaxPct}% ratio cap
          </p>
        </div>
      </div>

      <div className="two-col">
        <div>
          <h2 className="section-title">Capabilities</h2>
          {status.capabilities.map((cap) => (
            <div className="row" key={cap.name}>
              <span className={`dot ${cap.available ? 'dot-live' : ''}`} />
              <span className="mono">{cap.name}</span>
              <span className="row-spacer muted" style={{ fontSize: 12 }}>
                {cap.available ? 'ready' : `needs ${cap.missing.join(', ')}`}
              </span>
            </div>
          ))}

          <h2 className="section-title" style={{ marginTop: 26 }}>
            Products
          </h2>
          {status.products.map((p) => (
            <div className="row" key={p.id}>
              <span style={{ color: 'var(--color-accent-300)' }}>{p.name}</span>
              <span className="muted tnum">{money(p.priceCents)}</span>
              <span
                className={`row-spacer mono ${p.utmBaseIsPlaceholder ? 'warn' : 'muted'}`}
                title={p.utmBase}
              >
                {p.utmBaseIsPlaceholder ? 'utm base is a placeholder' : new URL(p.utmBase).host}
              </span>
            </div>
          ))}

          <h2 className="section-title" style={{ marginTop: 26 }}>
            Data model
          </h2>
          {TABLES.map((t) => (
            <div
              key={t.name}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 150px) minmax(0, 1fr)',
                gap: 14,
                padding: '9px 0',
                borderBottom: '1px solid var(--color-neutral-900)',
                fontSize: 13,
                lineHeight: '21px',
              }}
            >
              <span className="mono" style={{ color: 'var(--color-accent-300)' }}>
                {t.name}
              </span>
              <span style={{ color: 'color-mix(in srgb, var(--color-text) 74%, transparent)' }}>
                {t.note}
              </span>
            </div>
          ))}
        </div>

        <div>
          <h2 className="section-title">Sources</h2>
          {status.sources.map((s) => (
            <div className="row" key={s.id}>
              <span className={`dot ${s.enabled ? 'dot-live' : ''}`} />
              <span style={{ color: s.enabled ? 'var(--color-text)' : 'var(--color-neutral-600)' }}>
                {s.displayName}
              </span>
              {!s.hasRulesRecord && (
                <span className="tag block" style={{ fontSize: 10, border: '1px solid var(--color-block)' }}>
                  rules_unknown
                </span>
              )}
              <span className="row-spacer muted tnum" title={s.lastPollError ?? undefined}>
                {s.enabled ? interval(s.pollIntervalSeconds) : 'paused'} · {relativeTime(s.lastPolledAt)}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '2px 9px' }}
                onClick={() => onToggleSource(s.id, !s.enabled, s.displayName)}
              >
                {s.enabled ? 'Pause' : 'Enable'}
              </button>
            </div>
          ))}
          {status.sources.some((s) => s.lastPollError) && (
            <p className="card-meta block" style={{ marginTop: 10 }}>
              {status.sources.filter((s) => s.lastPollError).length} source(s) failed their last poll.
              Hover the timestamp for the error.
            </p>
          )}

          <h2 className="section-title" style={{ marginTop: 26 }}>
            Runtime
          </h2>
          <div className="snippet selectable">
            {[
              `electron   ${status.runtime.electron}`,
              `node       ${status.runtime.node}`,
              `database   ${status.databasePath}`,
              `binding    ${status.runtime.nativeBinding ?? 'default resolution'}`,
            ].join('\n')}
          </div>

          <h2 className="section-title" style={{ marginTop: 26 }}>
            Run it headless
          </h2>
          <div className="snippet selectable">
            {[
              'pnpm install',
              'pnpm db:migrate && pnpm db:seed',
              'pnpm signal ingest run --force',
              'pnpm signal opportunities -n 20',
              '',
              '# the same engine, without a window',
              'pnpm signal worker',
            ].join('\n')}
          </div>
        </div>
      </div>
    </div>
  );
}
