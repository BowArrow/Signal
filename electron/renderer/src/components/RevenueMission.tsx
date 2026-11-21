import type { MarketingView } from '../../../../src/shared/marketing.js';
import type { MissionView, RevenueMission as Mission } from '../../../../src/shared/revenue-mission.js';

export function RevenueMission({ mission, connection, pending, disabled, act, revenue, productName }: {
  productName: string;
  mission: MissionView | undefined; connection: NonNullable<MarketingView['codexConnections']>[number] | undefined;
  pending: boolean; disabled: boolean; act: (action: { type: 'mission'; value: Mission } | { type: 'mission-review' | 'connect-codex' }) => void; revenue: () => void;
}) {
  const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
  if (!mission) return <section className="guide-codex"><h2>Your marketing agent</h2><p>{connection ? `Connected to Codex (${connection.model}). Your questions use the saved business context.` : 'Connect your signed-in Codex to research, explain decisions and prepare sales work in Signal.'}</p><button className="btn" disabled={disabled} onClick={() => act({ type: 'connect-codex' })}>{connection ? 'Check Codex connection' : 'Connect Codex'}</button></section>;
  const { value, score } = mission;
  const deadline = new Date(value.endsAt - 1).toLocaleDateString('en-US', { timeZone: value.timezone, month: 'long', day: 'numeric', year: 'numeric' });
  const ended = Date.now() >= value.endsAt;
  return <section className="guide-mission" aria-labelledby="mission-title">
    <div className="guide-mission-heading"><div><h2 id="mission-title">Our mission: {money(value.targetCents)} for {productName}</h2><p>New collected revenue by {deadline}.</p></div><span>{score.reached ? 'Target recorded' : ended ? 'Mission period ended' : value.active ? 'Daily review enabled' : 'Daily review paused'}</span></div>
    <div className="guide-mission-track"><strong>{score.verified ? money(score.observedCents) : 'Score unverified'}</strong><span>{score.verified ? `of ${money(value.targetCents)} collected` : `${money(score.observedCents)} in saved qualifying payments`}</span><progress aria-label="Verified revenue toward mission" max={value.targetCents} value={score.verified ? score.observedCents : 0} /></div>
    <p>{score.detail}{score.checkedAt ? ` Last complete sync: ${new Date(score.checkedAt).toLocaleString()}.` : ''}</p>
    <div className="guide-mission-notes"><p><strong>{score.daysLeft} days remaining</strong>{score.daysLeft > 0 && <span>{money(score.requiredDailyCents)} per day needed from the saved balance. A pace calculation, not a forecast.</span>}</p><p><strong>{connection ? `Codex connected · ${connection.model}` : 'Connect Codex to begin'}</strong><span>{pending ? 'Working on your saved request.' : mission.waitingForReview ? 'A prepared draft needs your decision. Open it in Where I need you below.' : mission.nextReviewAt ? `Next review due ${new Date(mission.nextReviewAt).toLocaleString()}. Keep Signal open.` : 'You can still discuss the results below.'}</span></p></div>
    <div className="guide-actions">
      {!connection && <button className="btn btn-primary" disabled={disabled} onClick={() => act({ type: 'connect-codex' })}>Connect Codex</button>}
      {connection && <button className="btn btn-primary" disabled={disabled || pending} onClick={() => act({ type: 'mission-review' })}>Review our next move</button>}
      <button className="btn" onClick={revenue}>Verify revenue</button>
      {!ended && <button className="guide-link" disabled={disabled} onClick={() => act({ type: 'mission', value: { ...value, active: !value.active } })}>{value.active ? 'Pause daily review' : 'Resume daily review'}</button>}
    </div>
    <p className="guide-mission-boundary">Codex reviews evidence and prepares work. Your approvals, customer conversations and confirmed payments stay visible in Signal.</p>
  </section>;
}
