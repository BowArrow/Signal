import { useEffect, useState, type ReactNode } from 'react';
import type { SalesView } from '../../../../src/shared/sales.js';
import type { ProspectDraft, ProspectResearchAction, ProspectResearchState, ProspectResearchView } from '../../../../src/shared/prospect-research.js';
import type { OutreachView } from '../../../../src/shared/outreach.js';

export function ProspectWorkspace({ productId, sales, section, onToast }: { productId: string; sales: SalesView; section: string; onToast: (message: string, kind?: 'ok' | 'warn') => void }) {
  const [view, setView] = useState<ProspectResearchView | null>(null), [outreach, setOutreach] = useState<OutreachView | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [history, setHistory] = useState(false);
  useEffect(() => { let live = true; const refresh = () => { void Promise.all([window.signal.prospectResearch(), window.signal.outreach()]).then(([research, emails]) => { if (live) { setView(research); setOutreach(emails); setError(''); } }).catch(() => { if (live) setError('Could not load prospect research.'); }); }; refresh(); const timer = setInterval(refresh, 4000); return () => { live = false; clearInterval(timer); }; }, []);
  const act = async (action: ProspectResearchAction) => { setBusy(true); try { setView(await window.signal.prospectResearchAction(action)); onToast(action.type === 'approve' ? 'Email approved and queued. Check delivery status below.' : action.type === 'research' || action.type === 'inspect' || action.type === 'draft-lead' ? 'Research queued. Signal will check the source and prepare suitable copy.' : 'Research workspace updated.'); } catch (e) { onToast(String(e), 'warn'); } finally { setBusy(false); } };
  const state = view?.states.find(s => s.productId === productId), records = view?.drafts.filter(d => d.productId === productId) ?? [];
  const leads = sales.leads.filter(l => l.productId === productId), policy = outreach?.policies.find(p => p.productId === productId);
  const sender = sales.sources.find(s => s.productId === productId && s.accountId === policy?.accountId);
  return <div className="prospect-workspace">
    {error && <p role="alert">{error}</p>}
    <section role="tabpanel" id="sales-panel-prospects" aria-labelledby="sales-tab-prospects" hidden={section !== 'prospects'}>
      <section className="card operation-explanation"><h2>Find customers and places to contribute</h2><p>Signal researches businesses, blogs and community discussions, checks product fit, and writes a proposed introduction or contribution. Research does not send emails or publish posts.</p>
        <p role="status">{state?.detail ?? 'Loading research settings…'}</p>
        {state?.lastSource && <button className="btn" onClick={() => void window.signal.openExternal(state.lastSource!)}>Open last researched page</button>}
        {state?.lastAttemptAt && <p className="muted">Last research attempt: {new Date(state.lastAttemptAt).toLocaleString()}. {records.filter(d => ['draft', 'no-contact', 'suggestion'].includes(d.status)).length} proposals await review in Drafts & suggestions.</p>}
        <button className="btn btn-primary" disabled={busy || view?.offline || state?.status === 'researching' || state?.status === 'queued'} onClick={() => void act({ type: 'research', productId })}>Research prospects and placements</button>
        {state && <ResearchSettings key={productId} state={state} busy={busy} act={act} />}
      </section>
      <h2>Saved leads ({leads.length})</h2><p>These are the same records counted in Operations and Growth workspace. A contact can be a potential customer, partner submission or subscriber; its stage and permission are shown separately.</p>
      {!leads.length && <p>No saved leads yet. Run research to find possible matches, or import your existing subscribers in Setup.</p>}
      {leads.map(lead => <article className="card operation-explanation" key={lead.id}><h3>{lead.value.name}</h3><p>{lead.value.contact || 'No email recorded'} · {lead.value.stage} · {lead.value.permission}</p><p>{lead.value.notes}</p><p>Source: {lead.value.source}</p>{lead.value.followUpAt !== null && <p>Follow up: {new Date(lead.value.followUpAt).toLocaleString()}</p>}
        <p>{lead.value.permission === 'do-not-contact' ? 'Sending blocked: do not contact.' : lead.value.stage === 'contacted' ? 'Already contacted. This record will not receive another automatic first email.' : lead.value.permission === 'unknown' ? 'Cold prospect: not subscribed. A researched email needs individual review before delivery.' : 'Check its outreach and conversation status in Drafts & suggestions or Conversations.'}</p>
        {/^(https:)/.test(lead.value.source) && <button className="btn" onClick={() => void window.signal.openExternal(lead.value.source)}>Open lead source</button>}
        <LeadPitch lead={lead} state={state} draft={records.find(d => d.leadId === lead.id)} busy={busy} offline={view?.offline ?? true} act={act} renderDraft={draft => <DraftCard key={`${draft.id}:${draft.updatedAt}`} draft={draft} business={sales.products.find(p => p.id === productId)?.name ?? 'Business'} sender={sender?.senderEmail ?? sender?.mailbox ?? ''} policyRevision={policy?.revision ?? -1} address={policy?.mailingAddress ?? ''} busy={busy} offline={view?.offline ?? true} act={act} />} />
      </article>)}
    </section>
    <section role="tabpanel" id="sales-panel-drafts" aria-labelledby="sales-tab-drafts" hidden={section !== 'drafts'}>
      <div className="sales-section-title"><h2>Drafts & placement suggestions</h2><label><input type="checkbox" checked={history} onChange={e => setHistory(e.target.checked)} /> Show dismissed and completed research</label></div>
      <p>Review the evidence and proposed message. Email approvals queue one exact introduction through your connected inbox. Community suggestions remain unpublished until you submit them.</p>
      {!records.some(d => history || !['rejected', 'submitted'].includes(d.status)) && <p>No research drafts yet. In Prospects, choose Research prospects and placements. Signal reports search or model blockers there instead of pretending a draft exists.</p>}
      {records.filter(d => history || !['rejected', 'submitted'].includes(d.status)).map(draft => <DraftCard key={`${draft.id}:${draft.updatedAt}`} draft={draft} business={sales.products.find(p => p.id === productId)?.name ?? 'Business'} sender={sender?.senderEmail ?? sender?.mailbox ?? ''} policyRevision={policy?.revision ?? -1} address={policy?.mailingAddress ?? ''} busy={busy} offline={view?.offline ?? true} act={act} />)}
    </section>
  </div>;
}

function LeadPitch({ lead, draft, state, busy, offline, act, renderDraft }: { lead: SalesView['leads'][number]; draft: ProspectDraft | undefined; state: ProspectResearchState | undefined; busy: boolean; offline: boolean; act: (action: ProspectResearchAction) => Promise<void>; renderDraft: (draft: ProspectDraft) => ReactNode }) {
  const [open, setOpen] = useState(false), [url, setUrl] = useState('');
  const blocked = lead.value.permission === 'do-not-contact' || ['customer', 'lost'].includes(lead.value.stage);
  const followUp = ['contacted', 'replied'].includes(lead.value.stage) || lead.value.permission === 'existing-conversation';
  const pending = state?.requestedLeadId === lead.id && ['queued', 'researching'].includes(state.status);
  let hasSource = false;
  try { hasSource = new URL(lead.value.source).protocol === 'https:'; } catch { /* Offer a source field. */ }
  return <div className="lead-pitch">
    {draft?.status === 'rejected' && !draft.body && !blocked && <button className="btn" disabled={busy || offline || state?.status === 'queued' || state?.status === 'researching'} onClick={() => void act({ type: 'draft-lead', productId: lead.productId, leadId: lead.id })}>Try drafting again</button>}
    {draft ? <><p><strong>{draft.body ? 'Prepared pitch: ' + draft.subject : 'Research needs review'}</strong></p>{!open && draft.body && <p className="sales-body">{draft.body.slice(0, 260)}{draft.body.length > 260 ? '…' : ''}</p>}<button className="btn btn-primary" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Close pitch' : draft.body ? 'View and edit pitch' : 'View research notes'}</button><div hidden={!open}>{renderDraft(draft)}</div></> : <>
      <p>{blocked ? 'Outreach is unavailable for this contact’s current stage or contact preference.' : followUp ? 'Ask Signal to prepare a follow-up using this saved contact and its source. You review it against the previous conversation before sending.' : 'Signal can research this prospect and write a specific pitch for you. Drafting does not send an email.'}</p>
      {!hasSource && !blocked && <label>Prospect website or contact page<input type="url" value={url} placeholder="https://…" onChange={e => setUrl(e.target.value)} /></label>}
      <button className="btn btn-primary" disabled={busy || offline || blocked || (!hasSource && !url) || state?.status === 'queued' || state?.status === 'researching'} onClick={() => { setOpen(true); void act({ type: 'draft-lead', productId: lead.productId, leadId: lead.id, ...(!hasSource ? { url } : {}) }); }}>{pending ? 'Preparing pitch…' : followUp ? 'Draft follow-up pitch' : 'Draft outreach pitch'}</button>
      {state?.requestedLeadId === lead.id && <p role="status">{state.detail}</p>}
    </>}
  </div>;
}

function ResearchSettings({ state, busy, act }: { state: ProspectResearchState; busy: boolean; act: (action: ProspectResearchAction) => Promise<void> }) {
  const [audience, setAudience] = useState(state.audience), [queries, setQueries] = useState(state.queries.join('\n')), [enabled, setEnabled] = useState(state.enabled), [limit, setLimit] = useState(state.dailyDraftLimit), [url, setUrl] = useState('');
  return <details><summary>Research audience, searches and automatic drafts</summary><form className="operation-policy" onSubmit={e => { e.preventDefault(); void act({ type: 'configure', productId: state.productId, value: { audience, queries: queries.split('\n').map(q => q.trim()).filter(Boolean), enabled, dailyDraftLimit: limit } }); }}>
    <label>Who should Signal look for?<textarea required minLength={15} maxLength={1500} value={audience} onChange={e => setAudience(e.target.value)} /></label>
    <label>Business, blog and community searches (one per line, up to five)<textarea required value={queries} onChange={e => setQueries(e.target.value)} /></label>
    <label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Research and draft automatically while this business runs</label>
    <label>New drafts per rolling day<input type="number" min={1} max={5} value={limit} onChange={e => setLimit(Number(e.target.value))} /></label>
    <p>Research pauses at ten proposals awaiting review. It uses your configured AI provider. Searches use SearXNG when configured, otherwise public web search; unavailable pages and access challenges are reported.</p><button className="btn" disabled={busy}>Save research settings</button>
  </form><form className="operation-policy" onSubmit={e => { e.preventDefault(); void act({ type: 'inspect', productId: state.productId, url }); }}><label>Optional: research a business, blog or discussion URL<input type="url" required value={url} placeholder="https://…" onChange={e => setUrl(e.target.value)} /></label><button className="btn" disabled={busy}>Research this page</button></form></details>;
}

function DraftCard({ draft, business, sender, address, policyRevision, busy, offline, act }: { policyRevision: number; draft: ProspectDraft; business: string; sender: string; address: string; busy: boolean; offline: boolean; act: (action: ProspectResearchAction) => Promise<void> }) {
  const [subject, setSubject] = useState(draft.subject), [body, setBody] = useState(draft.body), [checked, setChecked] = useState(false), [submitted, setSubmitted] = useState('');
  const dirty = subject !== draft.subject || body !== draft.body, editable = ['draft', 'no-contact', 'suggestion'].includes(draft.status);
  const copyMessage = draft.kind === 'business' ? `${body}\n\n${business} team — AI assistant\nPromotional message\n${address || 'Add your business mailing address in Setup before submitting'}\nReply "stop" to stop further contact.` : body;
  return <article className="card operation-explanation prospect-draft"><h3>{draft.name}</h3><p>{draft.kind === 'business' ? 'Potential customer' : draft.kind === 'blog' ? 'Blog contribution' : 'Community discussion'} · {draft.status}</p><p>{draft.fit}</p><p role="status">{draft.detail}</p>
    <div className="operation-actions"><button className="btn" onClick={() => void window.signal.openExternal(draft.url)}>Open researched source</button>{draft.contactSource && <button className="btn" onClick={() => void window.signal.openExternal(draft.contactSource)}>Check public contact</button>}{draft.rulesUrl && <button className="btn" onClick={() => void window.signal.openExternal(draft.rulesUrl)}>Open posting guidance</button>}</div>
    <details><summary>Evidence and posting guidance</summary><p>Observed {new Date(draft.observedAt).toLocaleString()}</p><blockquote>{draft.prospectQuote}</blockquote><p>Product evidence:</p><blockquote>{draft.productQuote}</blockquote>{draft.kind !== 'business' && <p>{draft.rulesQuote || 'No posting rules verified. Read the destination rules or ask its owner before posting.'}</p>}</details>
    {draft.body && <><p>{draft.kind === 'business' ? `From: ${sender || 'Choose a sending inbox in Setup'} · To: ${draft.contact || 'No public business email found'}` : 'Proposed contribution'}</p><label>Subject or title<input disabled={!editable} value={subject} maxLength={140} onChange={e => { setSubject(e.target.value); setChecked(false); }} /></label><label>Message<textarea disabled={!editable} rows={8} value={body} maxLength={2200} onChange={e => { setBody(e.target.value); setChecked(false); }} /></label>
      {draft.kind === 'business' && <pre className="sales-body">{`${business} team — AI assistant\nPromotional message\n${address || 'Business mailing address required in Setup'}\nReply "stop" to stop further contact.`}</pre>}
      <div className="operation-actions">{editable && <button className="btn" disabled={busy || !dirty} onClick={() => void act({ type: 'edit', productId: draft.productId, id: draft.id, updatedAt: draft.updatedAt, subject, body })}>Save draft</button>}{(draft.kind !== 'business' || ['no-contact', 'suggestion'].includes(draft.status)) && <button className="btn" onClick={() => void window.signal.copyToClipboard(copyMessage)}>{draft.kind === 'business' ? draft.status === 'suggestion' ? 'Copy follow-up message' : 'Copy message for contact form' : 'Copy proposed contribution'}</button>}</div>
    </>}
    {draft.status === 'draft' && <><label><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /> I reviewed the business contact, source evidence and exact email, and approve one cold introduction.</label><button className="btn btn-primary" disabled={busy || offline || !checked || dirty || !sender || !address} onClick={() => void act({ type: 'approve', productId: draft.productId, id: draft.id, updatedAt: draft.updatedAt, policyRevision, sender, reviewed: true })}>Approve and queue this email</button><p>This uses the saved outreach limit and delay. Operations must be running to send. No automatic cold follow-ups.</p></>}
    {draft.nextStep && <p><strong>Your next step:</strong> {draft.nextStep}</p>}
    {['suggestion', 'no-contact'].includes(draft.status) && <form onSubmit={e => { e.preventDefault(); void act({ type: 'submitted', productId: draft.productId, id: draft.id, url: submitted }); }}><label>After submitting, save the resulting link<input type="url" required value={submitted} onChange={e => setSubmitted(e.target.value)} /></label><button className="btn" disabled={busy}>Record my submission</button></form>}
    {editable && <button className="btn" disabled={busy} onClick={() => void act({ type: 'reject', productId: draft.productId, id: draft.id })}>Dismiss this suggestion</button>}
  </article>;
}
