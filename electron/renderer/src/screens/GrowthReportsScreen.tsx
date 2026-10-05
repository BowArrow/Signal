import { useEffect, useState } from 'react';
import type { GrowthDashboard } from '../../../../src/shared/growth.js';
import '../styles/growth.css';

export function GrowthReportsScreen({
  mode,
}: {
  mode: 'attribution' | 'digest';
}): React.JSX.Element {
  const [data, setData] = useState<GrowthDashboard | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const refresh = () =>
      void window.signal
        .growth()
        .then(setData)
        .catch((e) => setError(String(e)));
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="page growth-page">
      <p className="growth-eyebrow">MEASURE / LEARN / REPEAT</p>
      <h1 className="page-title">
        {mode === 'digest' ? 'Your growth digest' : 'Experiment results'}
      </h1>
      <p className="page-lede">
        {mode === 'digest'
          ? 'The latest local analyst memos, with their date and measured context.'
          : 'Revenue, acquisition cost, and audience fit from the results you recorded. Each product stays in its own currency.'}
      </p>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p>Reading results…</p>}
      {data?.products.map((product) => {
        const measured = product.experiments.filter((e) => e.result !== null);
        const money = (cents: number) =>
          new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: product.currency,
          }).format(cents / 100);
        const revenue = measured.reduce(
          (sum, e) => sum + (e.result?.revenueCents ?? 0),
          0,
        );
        const spend = measured.reduce(
          (sum, e) => sum + (e.result?.spendCents ?? 0),
          0,
        );
        const customers = measured.reduce(
          (sum, e) => sum + (e.result?.customers ?? 0),
          0,
        );
        const memo = product.tasks.find(
          (t) => t.kind === 'analysis' && t.status === 'done',
        );
        return (
          <section key={product.id} className="card growth-experiment">
            <h2>{product.name}</h2>
            {mode === 'digest' ? (
              <>
                {memo?.output ? (
                  <>
                    <p className="growth-muted">
                      Generated {new Date(memo.updatedAt).toLocaleString()} ·{' '}
                      {memo.model}
                    </p>
                    <p>{String(memo.output['summary'] ?? '')}</p>
                    <h3>Next actions</h3>
                    <ul>
                      {Array.isArray(memo.output['nextActions']) &&
                        memo.output['nextActions'].map((action, i) => (
                          <li key={i}>{String(action)}</li>
                        ))}
                    </ul>
                    <h3>What remains uncertain</h3>
                    <ul>
                      {Array.isArray(memo.output['caveats']) &&
                        memo.output['caveats'].map((caveat, i) => (
                          <li key={i}>{String(caveat)}</li>
                        ))}
                    </ul>
                  </>
                ) : (
                  <p>
                    No analyst memo yet. Open Growth lab → Local agents → Write
                    growth memo, or enable scheduled cycles.
                  </p>
                )}
              </>
            ) : (
              <>
                {measured.length ? (
                  <>
                    <div className="growth-agent-grid">
                      <div>
                        <p>Recorded revenue</p>
                        <h2>{money(revenue)}</h2>
                      </div>
                      <div>
                        <p>Recorded spend</p>
                        <h2>{money(spend)}</h2>
                      </div>
                      <div>
                        <p>Paying customers across tests</p>
                        <h2>{customers}</h2>
                      </div>
                      <div>
                        <p>Blended acquisition cost</p>
                        <h2>
                          {customers ? money(spend / customers) : 'Unknown'}
                        </h2>
                      </div>
                    </div>
                    {measured.map((exp) => (
                      <div className="growth-verdict" key={exp.id}>
                        <h3>
                          {exp.channelName}: {exp.evaluation.verdict}
                        </h3>
                        <p>
                          {exp.result?.visitors} visitors ·{' '}
                          {exp.result?.customers} paying customers ·{' '}
                          {money(exp.result?.revenueCents ?? 0)} revenue
                        </p>
                        <p className="selectable">
                          Measurement source: {exp.result?.source}
                        </p>
                        <p>{exp.evaluation.reason}</p>
                      </div>
                    ))}
                  </>
                ) : (
                  <p>
                    No measured results yet. Start a Bullseye experiment and
                    record its actual outcome to see revenue and acquisition
                    cost here.
                  </p>
                )}
                <p className="growth-muted">
                  {product.experiments.length - measured.length} unmeasured
                  tests. UTM campaign links identify each experiment in your
                  analytics. These totals are recorded test outcomes; automatic
                  Stripe and click ingestion is not connected. A customer
                  appearing in multiple tests is counted in each test.
                </p>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
