import type { OperationLearning as Learning, OperationsView } from '../../../../src/shared/operations.js';

export function OperationLearning({ learning, accounts }: { learning: Learning; accounts: OperationsView['accounts'] }) {
  const label = (id: string) => accounts.find(a => a.id === id)?.label ?? id;
  const reference = learning.mode === 'test-interest' ? learning.traffic?.reference : learning.reference;
  const traffic = learning.traffic;
  return <section className="card operation-explanation operation-learning">
    <h2>{learning.mode === 'build-on' ? 'Build on purchase evidence' : learning.mode === 'test-interest' ? 'Test visitor interest' : 'Explore a buyer problem'}</h2>
    <p>{learning.reason}</p>
    <p>Selected destination: {label(learning.accountId)}. Cycle {learning.cycle}, decided {new Date(learning.decidedAt).toLocaleString()}.</p>
    {reference && <p>Reference topic: <strong>{reference.title}</strong>. Develop a distinct next step using current product facts.</p>}
    <details><summary>View the evidence behind this choice</summary>
      <p>Payment comparisons use publications aged 7–30 days and require a current complete live Stripe scan. Qualifying counts include renewals and exclude disputed and fully refunded payments. Unavailable payment evidence contributes no qualifying matches; that does not establish zero sales.</p>
      {learning.accounts.map(a => <p key={a.accountId}>{label(a.accountId)}: {a.campaigns} mature publications, {a.paidCampaigns} associated with qualifying payments, {a.retainedPayments} qualifying payments retaining value after refunds.</p>)}
      {traffic && <div className="operation-traffic"><h3>Website visitor observations</h3><p>{traffic.detail}</p>
        {traffic.status === 'usable' && <>
          <p>{traffic.startDate} through {traffic.endDate} · {traffic.timeZone}. Read {new Date(traffic.observedAt!).toLocaleString()}.</p>
          <table className="operation-evidence-table"><thead><tr><th>Destination</th><th>Campaigns observed / eligible</th><th>Sessions</th><th>Engaged sessions</th></tr></thead><tbody>{traffic.accounts.map(a => <tr key={a.accountId}><th scope="row">{label(a.accountId)}</th><td>{a.observedCampaigns} / {a.campaigns}</td><td>{a.observedCampaigns ? a.sessions : 'Unknown'}</td><td>{a.observedCampaigns ? a.engagedSessions : 'Unknown'}</td></tr>)}</tbody></table>
          <p>Visitor interest is a hypothesis for another small test. Sessions do not establish unique buyers, consent to contact, purchases or a proven winning channel. Counts can change as analytics processes events. No spending or delivery limits increase.</p>
        </>}
      </div>}
    </details>
  </section>;
}
