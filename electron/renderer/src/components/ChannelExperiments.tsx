import type { OperationsView } from '../../../../src/shared/operations.js';
import { deliveryCapacity } from '../../../../src/shared/delivery-capacity.js';
import { channelCoverage } from '../../../../src/shared/channel-coverage.js';

export function ChannelExperiments({ view, productId, open }: { view: OperationsView; productId: string; open: (destination: 'settings' | 'sales' | 'studio' | 'research' | 'deliveries') => void }) {
  const state = view.states.find(s => s.productId === productId);
  if (!state || state.mode !== 'acquisition') return null;
  const now = Date.now(), capacity = deliveryCapacity(state, view.deliveries, now), used = capacity.publicationUsed;
  const accounts = view.accounts.filter(a => a.productId === productId && state.accountIds.includes(a.id));
  const channels = channelCoverage(view, productId, now);
  const outreach = view.outreachActivity?.find(a => a.productId === productId);
  const recent = view.deliveries.filter(d => d.productId === productId && d.status === 'published' && d.receipt && d.receipt.confirmedAt > now - 2 * 86400000);
  const archived = view.conversations?.filter(c => c.productId === productId && c.archivedAt != null).length ?? 0;
  return <section className="card operation-explanation operation-channel-tests" aria-label="Channel experiments">
    <h2>Your marketing plan</h2>
    <div className="marketing-summary"><div><span>Publications in 48 hours</span><strong>{recent.length}</strong></div><div><span>Public replies in 48 hours</span><strong>{recent.filter(d => d.reply).length}</strong></div><div><span>Outreach emails in 48 hours</span><strong>{outreach?.sent48h ?? 'Unknown'}</strong></div><div><span>Eligible subscriber leads</span><strong>{outreach?.eligible ?? 'Unknown'}</strong></div></div>
    <p>Publication counts include retained receipts, including replies later removed. {archived} conversation{archived === 1 ? '' : 's'} archived. Confirmed email sends do not prove recipient delivery.</p>
    {!capacity.separate && state.replyToRequests && <div className="operation-start-blockers"><strong>Articles and replies share the same daily allowance</strong><p>One article uses one reply opportunity too. Set a separate qualified reply limit to keep conversations moving while articles are capped independently.</p><button className="btn" onClick={() => open('settings')}>Set separate reply limit</button></div>}
    {outreach && <div className="conversation-message"><strong>{outreach.draftsForReview ? 'Cold introductions await your review' : outreach.eligible ? 'Email leads ready for final sending checks' : 'Email outreach is waiting'}</strong><p>{outreach.leads} saved leads; {outreach.candidates} new contacts have a valid email, recorded opt-in, source and eligible stage; {outreach.eligible} pass current mailbox and contact checks. {outreach.pending} emails pending; {outreach.attention} need delivery review.</p><p>{outreach.draftsForReview ?? 0} cold email drafts and {outreach.placementsForReview ?? 0} blog or community suggestions await review in Sales ? Drafts & suggestions.</p>{outreach.candidates === 0 && <p>Automatic subscriber outreach needs recorded opt-in. To find new business contacts, open Sales ? Prospects: Signal can research and draft cold introductions for individual review. Already-contacted partners and public post authors are not automatically enrolled as subscribers.</p>}{outreach.blockers.map(reason => <p key={reason}>{reason}</p>)}<button className="btn" onClick={() => open('sales')}>Open Sales and lead sources</button></div>}
    <div className="operation-actions"><button className="btn" onClick={() => open('research')}>See research and rejected matches</button><button className="btn" onClick={() => open('deliveries')}>See publication receipts</button></div>
    <p>{Math.max(0, state.dailyLimit - used)} of {state.dailyLimit} {capacity.separate ? 'article / feed-post slots' : 'public delivery slots'} remain in the rolling day. Pending or uncertain deliveries reserve a slot. Email has its own limits in Sales.</p>
    {capacity.separate && <p>{Math.max(0, capacity.replyLimit - capacity.replyUsed)} of {capacity.replyLimit} qualified public replies remain for this business. This is separate from articles and feed posts, with a shared ceiling of 10 initial replies across businesses.</p>}
    <p>Signal keeps searching while capacity remains. It skips unsuitable requests, continues with fresh candidates after successful cycles, and slows down on provider or generation failures. A daily limit is a ceiling, not a reason to send a weak pitch.</p>
    <p>{state.testChannels ? 'Channel testing is on: rotate the selected feasible destinations first, then use measured visitor interest or repeated attributed payments to allocate more tests. Every fourth cycle keeps exploring.' : 'Enable channel testing in Operating settings to rotate acquisition work across selected destinations.'} These are small tests, not an assumption that every account has an audience.</p>
    <div className="conversation-message"><strong>Selected distribution tests</strong>{accounts.length ? accounts.map(account => {
      const sent = view.deliveries.filter(d => d.productId === productId && d.accountId === account.id && d.status === 'published' && d.receipt).length;
      return <p key={account.id}>{account.label} · {account.provider === 'signal-blog' ? 'Website articles / search discovery' : account.provider} · {sent} retained publication receipts · {account.status}</p>;
    }) : <p>Select permitted destinations below. Research and separately configured Sales activities can still run.</p>}</div>
    <h3>Start with reach you can access</h3>
    <p>Run qualified public replies and useful website content first. Build the email audience through those visits. Test partner demonstrations and relevant listings alongside them to reach people beyond your own followers. Fund ads only after choosing a budget and a measurable offer.</p>
    {(['automatic', 'setup', 'guided'] as const).map(lane => <div key={lane} className="channel-guidance">
      <h3>{lane === 'automatic' ? 'Signal can run these' : lane === 'setup' ? 'Finish setup' : 'Experiments that need you'}</h3>
      {channels.filter(c => c.lane === lane).map(channel => <details key={channel.key} className="conversation-message"><summary>{channel.label} ? {channel.status}</summary>
        <p>{channel.detail}</p><p><strong>Next step:</strong> {channel.nextStep}</p>
        {lane === 'guided' && <>{channel.key !== 'blogs' && <p>Signal prepares campaign materials in Growth workspace. You arrange access, submit or host the activity, and record the result in its lead pipeline or distribution calendar.</p>}<ol>{channel.steps.map(step => <li key={step}>{step}</li>)}</ol></>}
        <p><strong>Measure:</strong> {channel.measure}</p><p>{channel.stopRule}</p>
        <button className="btn" onClick={() => open(channel.destination)}>{channel.destination === 'settings' ? 'Review operating settings' : channel.destination === 'sales' ? 'Open Sales' : 'Open Growth workspace'}</button>
      </details>)}
    </div>)}

  </section>;
}
