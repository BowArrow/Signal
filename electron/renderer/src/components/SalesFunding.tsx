import { useState } from 'react';
import type { FundingPolicy, FundingView } from '../../../../src/shared/funding.js';

export function SalesFunding({ view, busy, save }: { view: FundingView; busy: boolean; save: (policy: FundingPolicy) => void }) {
  const format = new Intl.NumberFormat(undefined, { style: 'currency', currency: view.currency.toUpperCase() });
  const scale = 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2);
  const [value, setValue] = useState<FundingPolicy>(view.policy ?? { enabled: false, reinvestPct: 20, operatingReservePct: 40, reserveCents: 0, capCents: 0, holdDays: 30 });
  return <section className="card operation-explanation sales-funding"><h2>Fund marketing from sales</h2>
    <p>Start at zero cash. Once eligible sales arrive, Signal can reserve a share for paid tests under this rule. Ad-account billing remains separate; this does not withdraw money from Stripe or launch a campaign.</p>
    <div className="marketing-summary"><div><span>Eligible proceeds</span><strong>{format.format(view.eligibleCents / scale)}</strong></div><div><span>Total marketing allowance</span><strong>{format.format(view.allocationCents / scale)}</strong></div>
      {view.remaining && <><div><span>Already spent</span><strong>{format.format(view.remaining.spentCents / scale)}</strong></div><div><span>Reserved</span><strong>{format.format(view.remaining.committedCents / scale)}</strong></div><div><span>Available for new tests</span><strong>{format.format(view.remaining.availableCents / scale)}</strong></div></>}
    </div>
    <p>{view.eligiblePayments} eligible payments · {view.heldPayments} still held · {view.unknownPayments} missing cash evidence · {view.excludedPayments} excluded. Prior marketing spend and reservations reduce what remains.</p>
    {view.blockers.length > 0 && <ul>{view.blockers.map(b => <li key={b}>{b}</li>)}</ul>}
    <form className="operation-policy funding-policy" onSubmit={e => { e.preventDefault(); save(value); }}>
      <label className="operation-account"><input type="checkbox" checked={value.enabled} onChange={e => setValue({ ...value, enabled: e.target.checked })} />Use Stripe sales to fund marketing</label>
      <div className="operation-limits">
        <label>Reinvest after reserves (%)<input aria-label="Reinvestment percentage" type="number" required min={0} max={100} value={value.reinvestPct} onChange={e => setValue({ ...value, reinvestPct: Number(e.target.value) })} /></label>
        <label>Keep for costs and obligations (%)<input type="number" required min={0} max={100} value={value.operatingReservePct} onChange={e => setValue({ ...value, operatingReservePct: Number(e.target.value) })} /></label>
        <label>Additional cash reserve ({view.currency.toUpperCase()})<input type="number" required min={0} step={1 / scale} value={value.reserveCents / scale} onChange={e => setValue({ ...value, reserveCents: Math.round(Number(e.target.value) * scale) })} /></label>
        <label>Total allocation cap ({view.currency.toUpperCase()})<input aria-label="Marketing allocation cap" type="number" required min={0} step={1 / scale} value={value.capCents / scale} onChange={e => setValue({ ...value, capCents: Math.round(Number(e.target.value) * scale) })} /></label>
        <label>Hold each sale for (days)<input type="number" required min={7} max={90} value={value.holdDays} onChange={e => setValue({ ...value, holdDays: Number(e.target.value) })} /></label>
      </div>
      <p>Only live sales for this business and currency count. Stripe must report funds available, fees and collected tax. Refunded or disputed payments are excluded entirely. The hold is a buffer; later refunds can still reduce the allowance.</p>
      <p>Your cost reserve must cover affiliate commissions, delivery costs and other obligations Stripe does not report here. This calculation is an allocation rule, not profit or your bank balance. Recorded cash adjustments reduce it. Manual surplus credits are not added on top.</p>
      <p>The total cap is cumulative, not a daily budget. New reservations stop when the source is stale or the allowance is exhausted. Saving pauses Operations; campaign activation requires its own funded plan.</p>
      <button type="submit" className="btn" disabled={busy}>Save reinvestment rule</button>
    </form>
  </section>;
}
