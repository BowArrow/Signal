import { useEffect, useState } from 'react';
import type { PipelineAction, PipelineLead, PipelineView } from '../../../../src/shared/sales-pipeline.js';
import type { SalesView } from '../../../../src/shared/sales.js';
import type { OutreachView } from '../../../../src/shared/outreach.js';
import { ownerReplyText } from '../../../../src/shared/sales-replies.js';
import '../styles/sales-pipeline.css';

const currencyAmount = (amount: number, currency: string) => { const format = new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }); return format.format(amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2)); };

type Act = (action: PipelineAction) => Promise<boolean>;
export function SalesPipeline({ productId, business, sales, onToast }: { productId: string; business: string; sales: SalesView; onToast: (text: string, kind?: 'ok' | 'warn') => void }) {
  const [view, setView] = useState<PipelineView | null>(null), [outreach, setOutreach] = useState<OutreachView | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [sourceUrl, setSourceUrl] = useState(''), [sourceSignal, setSourceSignal] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () => { void Promise.all([window.signal.salesPipeline(), window.signal.outreach()]).then(([v, o]) => { if (active) { setView(v); setOutreach(o); setError(''); } }).catch(() => { if (active) setError('Could not load the sales pipeline. Reopen Sales to retry.'); }); };
    refresh(); const timer = setInterval(refresh, 4000); return () => { active = false; clearInterval(timer); };
  }, []);
  const act: Act = async action => { setBusy(true); try { setView(await window.signal.salesPipelineAction(action)); onToast(action.type === 'approve' || action.type === 'approve-reply' ? 'Exact email approved and queued. Run Operations when ready to send.' : 'Pipeline updated'); return true; } catch (e) { onToast(String(e), 'warn'); return false; } finally { setBusy(false); } };
  if (!view) return <p role="status">{error || 'Loading the intent pipeline…'}</p>;
  const leads = view.leads.filter(l => l.productId === productId), metrics = view.metrics.find(m => m.productId === productId);
  const policy = outreach?.policies.find(p => p.productId === productId);
  const sender = sales.sources.find(s => s.productId === productId && s.accountId === policy?.accountId);
  const from = sender?.senderEmail ?? sender?.mailbox ?? '';
  return <div className="intent-pipeline">
    <section className="intent-intro"><div><h2>Start with a reason to reach out.</h2><p>A public request or specific problem starts the pipeline. Signal checks the source, qualifies the fit, and prepares a short email for your approval.</p></div><div className="intent-mode"><strong>Review every email</strong><span>Closing replies always need you.</span></div></section>
    {error && <p role="alert">{error}</p>}
    <dl className="intent-results"><div><dt>Intent leads</dt><dd>{metrics?.leads ?? 0}</dd></div><div><dt>Confirmed sent</dt><dd>{metrics?.sent ?? 0}</dd></div><div><dt>Positive replies</dt><dd>{metrics?.positiveReplies ?? 0}</dd></div><div><dt>Schema pass rate</dt><dd>{metrics?.schemaPassRate == null ? 'Not measured' : `${Math.round(metrics.schemaPassRate * 100)}%`}</dd></div><div><dt>Attributed revenue</dt><dd>{metrics?.revenue != null && metrics.currency ? currencyAmount(metrics.revenue, metrics.currency) : 'Not measured'}</dd></div></dl>
    <details className="card intent-intake" open={!leads.length}><summary>Add an intent lead</summary>
      <form onSubmit={e => { e.preventDefault(); void act({ type: 'ingest', productId, value: { name, email, sourceUrl, sourceSignal } }); }}>
        <div className="intent-fields"><label>Name<input required maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label><label>Public email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label></div>
        <label>Source page<input type="url" required placeholder="https://…" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} /></label>
        <label>Exact request or problem<textarea required minLength={20} maxLength={1000} rows={3} value={sourceSignal} onChange={e => setSourceSignal(e.target.value)} /></label>
        <p className="growth-muted">The source must contain this quote and the public email. Signal does not guess addresses or treat a company description as buying intent.</p>
        <button className="btn" disabled={busy} type="submit">Add lead for qualification</button>
      </form>
    </details>
    <div className="sales-section-title"><h3>Evidence and next actions</h3><span>{leads.filter(l => l.requested).length} preparing · {leads.filter(l => l.stage === 'DRAFT_READY' && !l.deliveryId).length} awaiting review</span></div>
    {!leads.length && <p className="intent-empty">No intent leads yet. Add one specific, verifiable request above. Your existing prospects and conversations remain in their Sales tabs.</p>}
    {leads.map(lead => <IntentLeadCard key={lead.id} lead={lead} messages={sales.messages.filter(m => m.productId === productId && (m.from === lead.email || m.leadId === lead.id))} jobs={outreach?.jobs.filter(j => j.productId === productId && j.leadId === lead.id) ?? []} business={business} from={from} policy={policy} busy={busy} offline={view.offline} verifierConfigured={view.verifierConfigured} act={act} />)}
    <InboxReadiness productId={productId} view={view} sales={sales} busy={busy} act={act} />
    <details className="card intent-intake"><summary>Learning and agent reliability</summary><p>Confirmed human edits become wording feedback. After 20 edited sends, Signal can distill style rules weekly. Current product facts and approval requirements always take precedence.</p><button className="btn" disabled={busy || view.offline} onClick={() => void act({ type: 'distill', productId })}>Distill confirmed edits</button><p>{metrics?.retries ?? 0} schema retries recorded. Results below describe agent output, not marketing reach.</p>{metrics?.angles.map(a => <p key={a.angle}>{a.angle.replaceAll('_', ' ')}: {a.leads} leads, {a.sent} sent, {a.positiveReplies} positive replies{a.revenue != null ? `, ${currencyAmount(a.revenue, a.currency!)} attributed` : ' ? revenue not measured'}</p>)}{view.runs.filter(r => r.productId === productId).slice(0, 12).map(run => <p key={run.id}>{run.stage} · {run.model} · {run.schemaValid ? 'Schema passed' : run.error} · {(run.latencyMs / 1000).toFixed(1)}s</p>)}</details>
  </div>;
}
function IntentLeadCard({ lead, messages, jobs, business, from, policy, busy, offline, verifierConfigured, act }: { lead: PipelineLead; messages: SalesView['messages']; jobs: OutreachView['jobs']; business: string; from: string; policy: OutreachView['policies'][number] | undefined; busy: boolean; offline: boolean; verifierConfigured: boolean; act: Act }) {
  const [editing, setEditing] = useState(false), [subject, setSubject] = useState(lead.draft?.subject ?? ''), [body, setBody] = useState(lead.draft?.body ?? '');
  const [reply, setReply] = useState(''), [reviewed, setReviewed] = useState(false);
  // Polling updates receipts without replacing text currently being edited.
  useEffect(() => { if (!editing) { setSubject(lead.draft?.subject ?? ''); setBody(lead.draft?.body ?? ''); } }, [lead.draft?.subject, lead.draft?.body, editing]);
  useEffect(() => { setReply(lead.triage?.suggested_reply ?? ''); setReviewed(false); }, [lead.lastMessageId, lead.triage?.suggested_reply]);
  useEffect(() => { setReviewed(false); }, [lead.revision, from, policy?.revision]);
  const target = { productId: lead.productId, id: lead.id, revision: lead.revision };
  const draftReady = lead.stage === 'DRAFT_READY' && !lead.deliveryId;
  const preview = `${lead.draft?.body ?? ''}\n\n${business} team — AI assistant\nPromotional message\n${policy?.mailingAddress ?? '(Add mailing address in Sales setup)'}\nReply "stop" to stop further contact.`;
  return <article className="card intent-lead"><div className="sales-section-title"><h3>{lead.name}</h3><span className="growth-pill">{lead.stage.toLowerCase().replaceAll('_', ' ')}</span></div><p>{lead.email}</p><blockquote>{lead.sourceSignal}</blockquote><a href={lead.sourceUrl} target="_blank" rel="noreferrer">Inspect the source</a><p role="status">{lead.detail}</p>
    {lead.qualification && <p>Fit {lead.qualification.icp_score}/100 · {lead.qualification.angle_tag.replaceAll('_', ' ')}<br />{lead.qualification.reasoning}</p>}
    <details><summary>Stage history</summary>{lead.history.map((h, i) => <p key={i}>{new Date(h.at).toLocaleString()} · {h.stage}<br />{h.reason}</p>)}</details>
    {(messages.length > 0 || jobs.length > 0) && <details open={lead.stage === 'REPLIED'}><summary>Conversation and delivery history</summary>{jobs.map(j => <section key={j.id}><strong>Outbound · {j.status}</strong><p>{j.detail}</p><pre className="sales-body">{j.body || 'Open the original mailbox for expired content.'}</pre></section>)}{messages.map(m => <section key={m.id}><strong>Received · {new Date(m.receivedAt).toLocaleString()}</strong><p>{m.subject}</p><pre className="sales-body">{m.body || 'Open the original mailbox for expired content.'}</pre></section>)}</details>}
    {lead.draft && <details open={draftReady}><summary>Review the email and evidence</summary><p>From: {from || 'Choose an inbox in Sales setup'}<br />To: {lead.email}</p><strong>{lead.draft.subject}</strong><pre className="sales-body">{preview}</pre><blockquote>{lead.draft.product_quote}</blockquote><p>Critic: {lead.draft.criticPassed ? 'Passed' : 'Needs changes'}. {lead.draft.critic.violations.join(' ')}</p>
      {draftReady && <><button className="btn" disabled={busy || lead.requested} onClick={() => { setEditing(!editing); setReviewed(false); }}>{editing ? 'Close editor' : 'Edit draft'}</button>{editing && <form className="intent-edit" onSubmit={e => { e.preventDefault(); void act({ type: 'edit', ...target, subject, body }).then(ok => { if (ok) setEditing(false); }); }}><label>Subject<input required value={subject} onChange={e => setSubject(e.target.value)} /></label><label>Body<textarea required rows={5} value={body} onChange={e => setBody(e.target.value)} /></label><button className="btn" disabled={busy}>Save and recheck</button></form>}
        <div className="operation-actions"><button className="btn" disabled={busy || offline || !verifierConfigured} onClick={() => void act({ type: 'verify-email', ...target })}>Verify recipient</button></div>
        {!verifierConfigured && <p>Recipient verification is not configured. Add ZEROBOUNCE_API_KEY to Signal's environment, then restart Signal. No email can be sent without a current valid result.</p>}
        <label className="sales-check"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I reviewed the source, recipient, sender and exact email.</label>
        <button className="btn" disabled={busy || offline || editing || !reviewed || !lead.draft.criticPassed || lead.requested || !policy?.enabled || !from} onClick={() => void act({ type: 'approve', ...target, policyRevision: policy!.revision, sender: from, reviewed: true })}>Approve one email</button></>}
    </details>}
    {lead.stage === 'REPLIED' && lead.triage && <section className="intent-reply"><h4>{lead.triage.intent.toLowerCase().replaceAll('_', ' ')}</h4><p>Suggested routing does not mark a meeting or checkout as completed.</p>{lead.triage.suggested_reply && <><label>Response to approve<textarea rows={5} value={reply} onChange={e => { setReply(e.target.value); setReviewed(false); }} /></label><pre className="sales-body">{reply.length >= 20 ? ownerReplyText(reply, business) : reply}</pre><label className="sales-check"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I reviewed the incoming conversation and this exact response.</label><button className="btn" disabled={busy || offline || !reviewed || reply.trim().length < 20} onClick={() => void act({ type: 'approve-reply', ...target, body: reply, reviewed: true })}>Approve response</button></>}</section>}
    {!lead.deliveryId && ['DISCOVERED', 'ENRICHED', 'QUALIFIED', 'DRAFT_READY', 'REPLIED'].includes(lead.stage) && <div className="operation-actions"><button className="btn" disabled={busy || (!lead.requested && offline)} onClick={() => void act({ type: lead.requested ? 'pause' : 'retry', ...target })}>{lead.requested ? 'Pause preparation' : 'Retry preparation'}</button></div>}
  </article>;
}
function InboxReadiness({ productId, view, sales, busy, act }: { productId: string; view: PipelineView; sales: SalesView; busy: boolean; act: Act }) {
  const sources = sales.sources.filter(s => s.productId === productId);
  const [accountId, setAccountId] = useState(sources[0]?.accountId ?? ''), [selector, setSelector] = useState(''), [warmup, setWarmup] = useState('');
  const [domain, setDomain] = useState(''), [reason, setReason] = useState('');
  const source = sources.find(s => s.accountId === accountId);
  return <details className="card intent-intake"><summary>Sending readiness and do-not-contact</summary><p>Cold introductions use a dedicated domain, current SPF/DKIM/DMARC checks, at least 14 days of warmup, verified recipients, and a shared inbox limit. Every introduction still needs individual approval.</p>
    {view.inboxes.filter(i => i.productId === productId).map(i => <section key={i.accountId}><strong>{i.sender}</strong><p>SPF: {i.spf ? 'record found' : 'not verified'} · DKIM: {i.dkim ? 'record found' : 'not verified'} · DMARC: {i.dmarc ? 'record found' : 'not verified'}</p><p>{i.detail}</p><button className="btn" disabled={busy || view.offline} onClick={() => void act({ type: 'check-dns', productId, accountId: i.accountId })}>Check DNS records</button></section>)}
    <form onSubmit={e => { e.preventDefault(); if (source) void act({ type: 'configure-inbox', productId, accountId, sender: source.senderEmail ?? source.mailbox, dkimSelector: selector, warmupStartedAt: new Date(warmup + 'T00:00:00').getTime() }); }}>
      <label>Monitored sender<select required value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">Select an inbox</option>{sources.map(s => <option key={s.accountId} value={s.accountId}>{s.senderEmail ?? s.mailbox}</option>)}</select></label>
      <div className="intent-fields"><label>DKIM selector<input required value={selector} onChange={e => setSelector(e.target.value)} placeholder="From your mailbox provider" /></label><label>Actual warmup start date<input type="date" required value={warmup} onChange={e => setWarmup(e.target.value)} /></label></div><button className="btn" disabled={busy || !source}>Save inbox readiness</button>
    </form>
    <form onSubmit={e => { e.preventDefault(); void act({ type: 'suppress-domain', productId, domain, reason }); }}><h4>Block a domain across Signal</h4><label>Domain<input required value={domain} onChange={e => setDomain(e.target.value)} placeholder="example.com" /></label><label>Reason<input required minLength={5} value={reason} onChange={e => setReason(e.target.value)} /></label><button className="btn" disabled={busy}>Add to do-not-contact</button></form>
  </details>;
}
