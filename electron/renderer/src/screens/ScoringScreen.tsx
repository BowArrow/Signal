import { useCallback, useEffect, useState } from 'react';
import type { ScoringView } from '../../../../src/shared/ipc.js';

const AXES = [
  {
    key: 'contribution' as const,
    label: 'Contribution',
    note: 'Can you add benchmarks, architecture detail or a hard-won gotcha here, independent of the product?',
  },
  {
    key: 'intent' as const,
    label: 'Intent',
    note: 'Is the author actively trying to solve a problem a product solves? A question beats a discussion.',
  },
  {
    key: 'fit' as const,
    label: 'Fit',
    note: "Semantic match against one product's positioning. Records which product matched.",
  },
  {
    key: 'risk' as const,
    label: 'Risk',
    note: 'Community rules, thread age, cooldown, ratio. Computed, not classified — and it subtracts.',
  },
];

interface Props {
  readonly onToast: (message: string, kind?: 'ok' | 'warn') => void;
}

export function ScoringScreen({ onToast }: Props): React.JSX.Element {
  const [scoring, setScoring] = useState<ScoringView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    void window.signal.scoring().then(setScoring).catch((e: unknown) => setError(String(e)));
  }, []);

  const push = useCallback(
    async (next: { weights?: ScoringView['weights']; threshold?: number }) => {
      try {
        const updated = await window.signal.setScoring(next);
        setScoring(updated);
        setDirty(true);
        setError(null);
      } catch (err) {
        // The contribution-carries-most-weight rule lives in the schema, so
        // the refusal comes back from the main process rather than being
        // re-implemented here where it could drift.
        setError(err instanceof Error ? err.message : String(err));
        onToast('rejected — see the note under the sliders', 'warn');
      }
    },
    [onToast],
  );

  if (!scoring) {
    return (
      <div className="page">
        <h1 className="page-title">Scoring</h1>
        <p className="page-lede">{error ?? 'Reading weights…'}</p>
      </div>
    );
  }

  const setWeight = (key: keyof ScoringView['weights'], value: number): void => {
    void push({ weights: { ...scoring.weights, [key]: value } });
  };

  return (
    <div className="page">
      <h1 className="page-title">Scoring</h1>
      <p className="page-lede">
        Four axes, stored separately so the weights stay tunable. Contribution carries the most
        weight: a post with real benchmark data has outperformed a launch post by an order of
        magnitude. Risk is computed rather than classified, so it never depends on a model&rsquo;s mood.
      </p>

      <div className="grid-cards" style={{ marginBottom: 30 }}>
        {AXES.map((axis) => (
          <div className="card" key={axis.key}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <h3 className="card-title" style={{ margin: 0 }}>
                {axis.label}
              </h3>
              <span
                className="mono tnum"
                style={{ marginLeft: 'auto', color: 'var(--color-accent-300)' }}
              >
                {scoring.weights[axis.key].toFixed(2)}
              </span>
            </div>
            <p className="card-body" style={{ marginTop: 6 }}>
              {axis.note}
            </p>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={scoring.weights[axis.key]}
              onChange={(e) => setWeight(axis.key, Number.parseFloat(e.target.value))}
              style={{ width: '100%', marginTop: 14 }}
              aria-label={`${axis.label} weight`}
            />
          </div>
        ))}
      </div>

      {error && (
        <p className="block" style={{ marginBottom: 22, fontSize: 13.5, maxWidth: '70ch' }}>
          {error}
        </p>
      )}

      <h2 className="section-title">Threshold</h2>
      <div
        style={{
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-surface)',
          boxShadow: 'var(--shadow-sm)',
          padding: '20px 22px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 26,
          alignItems: 'center',
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 13,
              color: 'var(--color-neutral-500)',
              marginBottom: 6,
            }}
          >
            <span>expire</span>
            <span>draft</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={scoring.threshold}
            onChange={(e) => void push({ threshold: Number.parseFloat(e.target.value) })}
            style={{ width: '100%' }}
            aria-label="Score threshold"
          />
          <p className="mono muted" style={{ margin: '8px 0 0' }}>
            scoring.threshold = {scoring.threshold.toFixed(2)}
          </p>
        </div>

        <div
          style={{
            fontSize: 13.5,
            lineHeight: '24px',
            color: 'color-mix(in srgb, var(--color-text) 78%, transparent)',
          }}
        >
          <p style={{ margin: '0 0 8px' }}>
            <span className="ok tnum">{scoring.counts.scored} cleared</span>,{' '}
            <span className="tnum">{scoring.counts.expired} expired</span>,{' '}
            <span className="tnum">{scoring.counts.rulesUnknown} held as rules_unknown</span>.
          </p>
          <p style={{ margin: 0 }}>
            Below threshold there is no draft and no second model call. A missing rules record
            forces <span className="mono ok">rules_unknown</span> regardless of score.
          </p>
        </div>
      </div>

      {scoring.counts.unscored > 0 && (
        <p className="muted" style={{ marginTop: 18, fontSize: 13.5 }}>
          {scoring.counts.unscored} opportunities have not been scored yet.{' '}
          <span className="mono">pnpm signal score</span>
        </p>
      )}

      {dirty && (
        <p className="warn" style={{ marginTop: 14, fontSize: 13.5, maxWidth: '70ch' }}>
          Weights changed, so every existing total is now stale — the weight set is fingerprinted
          onto each score precisely so this is visible rather than silently wrong. Re-run{' '}
          <span className="mono">pnpm signal score --all</span> to bring them back in line.
        </p>
      )}

      <p className="muted" style={{ marginTop: 26, fontSize: 12.5 }}>
        weight set {scoring.hash}
      </p>
    </div>
  );
}
