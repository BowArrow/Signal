import { useEffect, useState } from 'react';
import type { OutreachPolicyState, OutreachView } from '../../../../src/shared/outreach.js';
import type { SalesView } from '../../../../src/shared/sales.js';
import { replyAccountCanSend } from '../../../../src/shared/sales-replies.js';

/** Uses the same durable consent, review and delivery path as Sales. */
export function AcquisitionIntake({ productId, onToast }: { productId: string; onToast: (message: string, kind?: 'ok' | 'warn') => void }) {
  const [data, setData] = useState<{ sales: SalesView; outreach: OutreachView }>();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = async () => { try { const [sales, outreach] = await Promise.all([window.signal.sales(), window.signal.outreach()]); if (active) { setData({ sales, outreach }); setError(''); } } catch { if (active) setError('Could not check initial email responses.'); } };
    void refresh(); const timer = setInterval(() => void refresh(), 4000);
    return () => { active = false; clearInterval(timer); };
  }, [productId]);
  const policy = data?.outreach.policies.find(p => p.productId === productId);
  const save = async (value: OutreachPolicyState) => {
    const { productId: id, revision: _revision, configuredAt: _configuredAt, ...input } = value;
    setBusy(true);
    try {
      const outreach = await window.signal.outreachAction({ type: 'configure', productId: id, value: input });
      setData(old => old && { ...old, outreach }); onToast('Initial email responses saved. Run marketing starts the enabled activities.');
    } catch (e) { onToast(String(e), 'warn'); } finally { setBusy(false); }
  };
  return <section className="card operation-explanation acquisition-intake" aria-label="Respond to interested buyers"><h2>Respond to interested buyers</h2>
    {error && <p role="alert">{error}</p>}
    {!policy && !error && <p>Checking the email response setup...</p>}
    {policy && data && <IntakeForm key={`${productId}:${policy.revision}`} policy={policy} sales={data.sales} busy={busy} save={value => void save(value)} />}
  </section>;
}

function IntakeForm({ policy, sales, busy, save }: { policy: OutreachPolicyState; sales: SalesView; busy: boolean; save: (value: OutreachPolicyState) => void }) {
  const eligible = sales.accounts.filter(a => a.productId === policy.productId && a.status === 'verified' && replyAccountCanSend(a) && sales.sources.some(s => s.productId === policy.productId && s.accountId === a.id && s.autoSync && s.aiTriage));
  const [address, setAddress] = useState(policy.mailingAddress);
  const [accountId, setAccountId] = useState(policy.accountId || (eligible.length === 1 ? eligible[0]!.id : ''));
  const sender = (id: string) => sales.sources.find(s => s.productId === policy.productId && s.accountId === id)?.senderEmail ?? sales.accounts.find(a => a.id === id)?.identity ?? '';
  return <><p>{policy.enabled ? `Initial responses are enabled from ${sender(policy.accountId)}, up to ${policy.dailyLimit} emails per rolling day with ${policy.followUpDays.length} follow-ups per unanswered conversation.` : 'Website requests can enter the pipeline, but the first email response is not enabled. A monitored inbox alone does not start that conversation.'}</p>
    <p>Signal researches the current product and prepares a useful first step for eligible opted-in leads. It checks the copy before sending and stops follow-ups after a reply, opt-out or matched purchase. Public discussion authors are not added to this email flow.</p>
    <details open={!policy.enabled}><summary>{policy.enabled ? 'Change initial response settings' : 'Set up initial responses'}</summary>
      <form className="operation-policy acquisition-intake-form" onSubmit={e => { e.preventDefault(); save({ ...policy, enabled: true, accountId, mailingAddress: address }); }}>
        <label>Send from<select aria-label="Initial response inbox" required value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">Choose a monitored sending inbox</option>{eligible.map(a => <option key={a.id} value={a.id}>{sender(a.id)} · {a.label}</option>)}</select></label>
        {!eligible.length && <p>Connect a sending inbox and enable its monitoring and AI triage in Sales.</p>}
        <label>Physical business mailing address<textarea placeholder="Street or PO box, city, state, postal code" aria-label="Initial response mailing address" required minLength={10} maxLength={500} value={address} onChange={e => setAddress(e.target.value)} /></label>
        <p>This address appears in the email footer. Messages identify the product and AI assistant and include a reply-to-stop option. Current limit: {policy.dailyLimit} emails per rolling day, with a {policy.delayMinutes}-minute delay before sending. Detailed objectives and follow-up timing are available in Sales.</p>
        <p>Saving pauses this business. Run marketing then authorizes these responses along with the other enabled activities.</p>
        <button className="btn" disabled={busy || !eligible.length} type="submit">{policy.enabled ? 'Save initial response settings' : 'Enable initial responses'}</button>
        {policy.enabled && <button className="btn" disabled={busy} type="button" onClick={() => save({ ...policy, enabled: false })}>Disable initial responses</button>}
      </form>
    </details>
  </>;
}
