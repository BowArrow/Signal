import { CampaignControlRoom } from '../components/CampaignControlRoom.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OperationsView } from '../../../../src/shared/operations.js';
import type { MarketingView } from '../../../../src/shared/marketing.js';
import { TEAM_ROLES, type TeamAction, type TeamBrief, type TeamRole } from '../../../../src/shared/marketing-team.js';
import type { GuideDestination } from '../../../../src/shared/marketing-guide.js';
import '../styles/marketing-team.css';

type Props = { productId: string; onProduct: (id: string) => void; onNavigate: (destination: GuideDestination, productId: string) => void; onToast: (message: string, kind?: 'ok' | 'warn') => void };
function initialBrief(name: string): TeamBrief {
  const lemonade = name.toLowerCase().includes('lemonade');
  return { objective: `Prepare one practical campaign to win the first attributable ${name} sales.`,
    audience: lemonade ? 'People who want help working with private local documents and are actively comparing desktop AI assistants.' : 'Independent creators who need a repeatable workflow for producing short videos.',
    offer: 'Verify the current product and trial offer, then demonstrate one useful workflow and invite the reader to try it.',
    constraints: 'Zero cash budget. Verify current claims and pricing. Use a real product demonstration. Preserve privacy. No invented testimonials or prospects.', references: [] };
}
export function MarketingTeamScreen({ productId, onProduct, onNavigate, onToast }: Props) {
  const [data, setData] = useState<MarketingView | null>(null);
  const [operations, setOperations] = useState<OperationsView | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [offline, setOffline] = useState(true);
  const [selected, setSelected] = useState<TeamRole>('research'); const [brief, setBrief] = useState<TeamBrief | null>(null);
  const [references, setReferences] = useState(''); const [feedback, setFeedback] = useState(''); const [newCampaign, setNewCampaign] = useState(false);
  const [receipts, setReceipts] = useState<{ id: string; productId: string; title: string; createdAt: number }[]>([]);
  const [receiptId, setReceiptId] = useState('');
  const [editing, setEditing] = useState(false);
  const epoch = useRef(0);
  const [selectedRunId, setSelectedRunId] = useState('');
  const lock = useRef(false); const alive = useRef(false); const loading = useRef(false);
  const refresh = useCallback(async () => {
    if (loading.current || lock.current) return; loading.current = true; const version = epoch.current;
    try { const [next, operations] = await Promise.all([window.signal.marketing(), window.signal.operations()]); if (alive.current && !lock.current && version === epoch.current) { setData(next); setOperations(operations); setOffline(operations.offline); setReceipts(operations.deliveries.filter(d => d.status === 'published' && d.receipt).map(d => ({ id: d.id, title: d.title, productId: d.productId, createdAt: d.createdAt }))); setError(''); } }
    catch (e) { if (alive.current) setError(String(e)); } finally { loading.current = false; }
  }, []);
  useEffect(() => { alive.current = true; void refresh(); const timer = setInterval(() => void refresh(), 3000); return () => { alive.current = false; clearInterval(timer); }; }, [refresh]);
  const product = data?.products.find(p => p.id === productId) ?? data?.products.find(p => p.name.toLowerCase().includes('lemonade')) ?? data?.products[0];
  useEffect(() => { if (product) { setBrief(initialBrief(product.name)); setReferences(''); setFeedback(''); setSelected('research'); setNewCampaign(false); setSelectedRunId(''); setReceiptId(''); } }, [product?.id]); // Business changes reset only unsaved inputs.
  const act = async (action: TeamAction): Promise<boolean> => {
    if (!product || lock.current) return false; lock.current = true; epoch.current++; setBusy(true);
    try {
      const next = await window.signal.marketingAction({ type: 'team', productId: product.id, action });
      const updatedOperations = await window.signal.operations();
      if (alive.current) { setOperations(updatedOperations); setData(next); setFeedback(''); setNewCampaign(false); if (action.command === 'start') setSelectedRunId(''); }
      onToast(action.command === 'update-brief' ? 'Campaign brief saved. The team will prepare an updated plan.' : action.command === 'update-settings' ? 'Campaign settings saved. Approve the updated scope to start.' : action.command === 'approve' ? 'Campaign approved. Autonomous execution has started.' : action.command === 'start' ? 'Campaign saved. The team will work while Signal is open.' : 'Team campaign updated.');
      return true;
    } catch (e) { onToast(String(e), 'warn'); return false; } finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  const connect = async () => {
    if (!product || lock.current) return; lock.current = true; setBusy(true);
    try { const next = await window.signal.marketingAction({ type: 'connect-codex', productId: product.id }); if (alive.current) setData(next); onToast('Codex connected and verified.'); }
    catch (e) { onToast(String(e), 'warn'); } finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  if (!data || !product || !brief) return <div className="page team-page"><h1>Marketing team</h1><p role={error ? 'alert' : 'status'}>{error || 'Loading your businesses and team campaigns…'}</p>{error && <button className="btn" onClick={() => void refresh()}>Try again</button>}</div>;
  const campaigns = data.teamRuns?.filter(r => r.productId === product.id).sort((a, b) => b.createdAt - a.createdAt) ?? [];
  const run = campaigns.find(r => r.id === selectedRunId) ?? campaigns[0];
  const step = run?.steps.find(s => s.role === selected); const role = TEAM_ROLES.find(r => r.id === selected)!;
  const policy = operations?.states.find(s => s.productId === product.id);
  const durationDays = run?.launchDurationDays ?? run?.steps.find(s => s.role === 'strategy')?.artifact?.experiment?.durationDays ?? 7;
  const canActivate = run?.status === 'review' || (run?.status === 'approved' && !run.execution);
  const executing = run?.status === 'approved' && Boolean(run.execution && run.execution.status !== 'complete');
  const completed = run?.steps.filter(s => s.status === 'done').length ?? 0;
  const connection = data.codexConnections?.find(c => c.productId === product.id);
  const navigate = (destination: GuideDestination) => onNavigate(destination, product.id);
  const disabled = busy || Boolean(error) || editing;
  const field = (key: keyof Omit<TeamBrief, 'references'>, label: string) => <label>{label}<textarea value={brief[key]} maxLength={4000} required disabled={busy} onChange={e => setBrief({ ...brief, [key]: e.target.value })} /></label>;
  const packet = run ? [`# ${product.name} campaign`, run.brief.objective, `Campaign: ${run.id}`, ...run.steps.flatMap(s => s.artifact ? [`## ${TEAM_ROLES.find(r => r.id === s.role)!.name}`, s.artifact.body, s.artifact.draft?.body ?? '', `Next: ${s.artifact.nextAction}`] : [])].join('\n\n') : '';
  const tracking = new URL(product.url); tracking.searchParams.set('utm_source', 'signal'); tracking.searchParams.set('utm_medium', 'campaign'); if (run) tracking.searchParams.set('utm_campaign', run.id);
  return <div className="page team-page">
    <header className="page-head"><div><h1 className="page-title">Marketing team</h1><p className="page-lede">See the work, steer the campaign, and follow the results.</p></div><label>Working on<select aria-label="Team business" disabled={busy || editing} value={product.id} onChange={e => onProduct(e.target.value)}>{data.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></header>
    {error && <p role="alert">Could not refresh the team. {error} <button className="btn" onClick={() => void refresh()}>Refresh</button></p>}
    <div className="team-connection"><span><i className="ph ph-cpu" aria-hidden="true" /> {connection ? `Codex connected · ${connection.model}` : 'Uses your configured marketing model'}</span>{!connection && <button className="btn" disabled={disabled || offline} onClick={() => void connect()}>Connect Codex</button>}<button className="team-link" onClick={() => navigate({ screen: 'settings' })}>Agent settings</button></div>
    {offline && <p className="team-notice" role="status">Offline preview. Research and model execution are unavailable.</p>}
    {editing && <p className="team-fine">Save or discard your edits before switching campaigns. Activity continues to refresh.</p>}
    {campaigns.length > 1 && <label className="team-history">Campaign history<select aria-label="Team campaign history" disabled={editing || busy} value={run?.id ?? ''} onChange={e => { setSelectedRunId(e.target.value); setNewCampaign(false); setFeedback(''); setReceiptId(''); }}>{campaigns.map(c => <option key={c.id} value={c.id}>{new Date(c.createdAt).toLocaleDateString()} — {c.brief.objective}</option>)}</select></label>}
    {(!run || newCampaign) ? <section className="team-start">
      <div className="team-intro"><i className="ph ph-users-three" aria-hidden="true" /><h2>Give your team a brief.</h2><p>Signal will investigate the buyer problem, choose an experiment and prepare the copy, creative and sales follow-up for your review.</p><p>The team uses shared sources and saved handoffs. You can inspect its work, ask for changes or pause at any point.</p><ol>{TEAM_ROLES.map(r => <li key={r.id}><strong>{r.name}</strong><span>{r.output}</span></li>)}</ol></div>
      <form className="team-brief" onSubmit={e => { e.preventDefault(); void act({ command: 'start', brief: { ...brief, references: references.split('\n').map(s => s.trim()).filter(Boolean) } }); }}>
        {field('objective', 'What should this campaign accomplish?')}{field('audience', 'Who should we investigate?')}{field('offer', 'What should we demonstrate or offer?')}{field('constraints', 'Constraints and preferences')}
        <label>Reference links (one per line, optional)<textarea value={references} onChange={e => setReferences(e.target.value)} maxLength={16000} placeholder="Product examples, buyer discussions or creative references" /></label>
        <div className="team-actions"><button className="btn btn-primary" disabled={disabled || offline}>Start campaign team</button>{run && <button type="button" className="btn" onClick={() => setNewCampaign(false)}>Back to campaign</button>}</div><p className="team-fine">Zero cash campaign. Your model provider’s usage limits apply. Keep Signal open for the team to work. Approve the completed campaign once to start autonomous work within the displayed operating scope.</p>
      </form>
    </section> : <>
      <CampaignControlRoom key={run.id} run={run} operations={operations} busy={busy} stale={Boolean(error)} onAction={act} onDirty={setEditing} controls={<>
          {(run.status === 'running' || (executing && run.execution?.status === 'active')) && <button className="btn" disabled={disabled} onClick={() => void act({ command: 'pause', runId: run.id })}>Pause team</button>}
          {(['paused', 'attention'].includes(run.status) || (executing && run.execution?.status === 'paused')) && <button className="btn btn-primary" disabled={disabled || offline} onClick={() => void act({ command: 'resume', runId: run.id })}>{run.status === 'attention' ? 'Retry unfinished role' : 'Resume team'}</button>}
          {canActivate && <button className="btn btn-primary" disabled={disabled || offline || !policy?.accountIds.length} onClick={() => policy && void act({ command: 'approve', runId: run.id, operationRevision: policy.revision, durationDays })}>{run.status === 'approved' ? 'Start approved campaign' : 'Approve & start campaign'}</button>}
          {(!['cancelled', 'approved'].includes(run.status) || executing) && <button className="team-link" disabled={disabled} onClick={() => void act({ command: 'cancel', runId: run.id })}>Cancel campaign</button>}
          {(['approved', 'cancelled'].includes(run.status) && !executing) && <button className="btn" disabled={disabled} onClick={() => setNewCampaign(true)}>New campaign</button>}
          <button className="team-link" onClick={() => void navigator.clipboard.writeText(packet).then(() => onToast('Campaign packet copied.')).catch(e => onToast(String(e), 'warn'))}>Copy packet</button>
</>} />
      <details className="campaign-artifacts"><summary>Specialist work <small>{completed} of 7 deliverables complete. Inspect the plan, copy, sources and revisions.</small></summary>
      <div className="team-workspace">
        <nav className="team-roster" aria-label="Marketing specialists">{TEAM_ROLES.map((r, i) => { const s = run.steps.find(s => s.role === r.id)!; return <button key={r.id} aria-current={selected === r.id ? 'step' : undefined} onClick={() => setSelected(r.id)}><span className={`team-number is-${s.status}`}>{s.status === 'done' ? <i className="ph ph-check" aria-label="Complete" /> : i + 1}</span><span><strong>{r.name}</strong><small>{s.status === 'done' ? r.output : s.status === 'waiting' ? 'Waiting for handoff' : s.status}</small></span></button>; })}</nav>
        <section className="team-deliverable" aria-label="Specialist deliverable"><header><div><h2>{role.name}</h2><p>{role.job}</p></div><span>{step?.status}</span></header>
          {step?.artifact ? <><h3>{step.artifact.title}</h3><p className="team-summary">{step.artifact.summary}</p><div className="team-document">{step.artifact.body}</div>
            {step.artifact.experiment && <div className="team-experiment"><h3>The experiment</h3><dl>{Object.entries(step.artifact.experiment).map(([key, value]) => <div key={key}><dt>{({ audience: 'Audience', channel: 'Placement', hypothesis: 'Hypothesis', action: 'Action', successMetric: 'Success metric', stopRule: 'Stop rule', durationDays: 'Duration (days)', cashBudgetCents: 'Cash budget (cents)' } as Record<string, string>)[key]}</dt><dd>{String(value)}</dd></div>)}</dl></div>}
            {step.artifact.draft && <div className="team-copy"><h3>Customer-facing draft</h3><p>{step.artifact.draft.body}</p><button className="btn" onClick={() => navigate({ screen: 'marketing', section: 'content' })}>Edit and review copy</button></div>}
            <aside className="team-next"><strong>Next action</strong><p>{step.artifact.nextAction}</p></aside></> : <div className="team-empty"><i className={`ph ${step?.status === 'failed' ? 'ph-warning-circle' : 'ph-files'}`} aria-hidden="true" /><h3>{step?.status === 'failed' ? 'This role needs another attempt' : step?.status === 'running' ? 'Working on the deliverable' : 'The deliverable will appear here'}</h3><p>{step?.error || 'The specialist will use your brief, source evidence and the previous roles’ work. Keep Signal open while the team runs.'}</p></div>}
          {step?.error && step.artifact && <p role="alert">{step.error}</p>}
          <details className="team-evidence"><summary>Sources and tool receipts ({run.evidence.filter(e => e.role === selected).length})</summary>{run.evidence.filter(e => e.role === selected).map(e => <details key={e.id}><summary>{e.tool} — {e.status} — {new Date(e.at).toLocaleString()}</summary><small>Receipt {e.id}</small><pre>{e.result}</pre></details>)}</details>
          {run.status !== 'cancelled' && <form className="team-revision" onSubmit={e => { e.preventDefault(); void act({ command: 'revise', runId: run.id, role: selected, feedback }); }}><label htmlFor="team-feedback">Request changes from {role.name.toLowerCase()}</label><textarea id="team-feedback" value={feedback} maxLength={4000} onChange={e => setFeedback(e.target.value)} placeholder="Be specific about the buyer, claim, angle or missing evidence…" /><p>Pauses execution and reruns this role and the roles after it. Earlier work stays saved. Changes require a new campaign approval.</p><button className="btn" disabled={disabled || offline || !feedback.trim()}>Revise from this role</button></form>}
        </section>
      </div>
      </details>
      {run.outcomes && <details className="team-results"><summary>Measurement and tracking details</summary><p>{run.outcomes.detail}</p><p className="team-fine">Analytics checked: {run.outcomes.analyticsAt ? new Date(run.outcomes.analyticsAt).toLocaleString() : 'not available'}. Revenue checked: {run.outcomes.revenueAt ? new Date(run.outcomes.revenueAt).toLocaleString() : 'not available'}.</p><label>Campaign link<input readOnly value={tracking.toString()} onFocus={e => e.target.select()} /></label><p className="team-fine">Keep this link in the reviewed placement. Checkout must preserve campaign metadata for payment attribution.</p><form className="team-actions" onSubmit={e => { e.preventDefault(); void act({ command: 'link-delivery', runId: run.id, deliveryId: receiptId }); setReceiptId(''); }}><label>Link an existing publication receipt<select aria-label="Campaign delivery receipt" value={receiptId} onChange={e => setReceiptId(e.target.value)}><option value="">Choose a published delivery</option>{receipts.filter(d => d.productId === product.id && d.createdAt >= run.createdAt && !run.deliveryIds?.includes(d.id)).map(d => <option value={d.id} key={d.id}>{d.title}</option>)}</select></label><button className="btn" disabled={disabled || !receiptId}>Link receipt</button></form></details>}
      <section className="team-handoffs"><h2>Supporting workspaces</h2><p>Use the team’s placement plan to choose the next step. Check delivery receipts and payment evidence after launch.</p><div className="team-actions"><button className="btn" onClick={() => navigate({ screen: 'marketing', section: 'content' })}>Review copy</button><button className="btn" onClick={() => navigate({ screen: 'operations', section: 'overview' })}>Review distribution</button><button className="btn" onClick={() => navigate({ screen: 'sales', section: 'drafts' })}>Sales follow-up</button><button className="btn" onClick={() => navigate({ screen: 'analytics' })}>Campaign analytics</button><button className="btn" onClick={() => navigate({ screen: 'revenue' })}>Verify payments</button></div><p className="team-fine">Completed deliverables are preparation. Delivery receipts establish publication; payment records establish sales. Refresh the analyst with “Revise from this role” when new results arrive.</p></section>
      <details className="team-saved-brief"><summary>Saved campaign brief</summary><p>{run.brief.audience}</p><p>{run.brief.offer}</p><p>{run.brief.constraints}</p>{run.brief.references.map(url => <p key={url}>{url}</p>)}<small>Campaign {run.id}</small></details>
    </>}
  </div>;
}
