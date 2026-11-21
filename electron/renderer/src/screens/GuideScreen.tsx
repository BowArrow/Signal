import { useCallback, useEffect, useRef, useState } from 'react';
import type { OperationsView } from '../../../../src/shared/operations.js';
import type { MarketingView } from '../../../../src/shared/marketing.js';
import { analyticsTotals, type AnalyticsView } from '../../../../src/shared/analytics.js';
import type { RevenueView } from '../../../../src/shared/revenue.js';
import { GUIDE_GOALS, marketingGuide, type GuideDestination, type GuidePlan, type GuideStep } from '../../../../src/shared/marketing-guide.js';
import { operationProgress } from '../../../../src/shared/operation-progress.js';
import { RevenueMission } from '../components/RevenueMission.js';
import '../styles/guide.css';

type Props = {
  productId: string;
  onProduct: (id: string) => void;
  onNavigate: (destination: GuideDestination, productId: string) => void;
  onToast: (message: string, kind?: 'ok' | 'warn') => void;
};
type GuideData = { operations: OperationsView; marketing: MarketingView; analytics: AnalyticsView | null; revenue: RevenueView | null };
const channelCopy: Record<string, { name: string; purpose: string; limitation: string }> = {
  'signal-blog': { name: 'Your website', purpose: 'Give visitors a useful demonstration and a clear way to try the product.', limitation: 'Publishing an article does not bring an audience by itself. Pair it with a relevant introduction or placement.' },
  bluesky: { name: 'Bluesky', purpose: 'Find relevant public questions and show how your product could help.', limitation: 'Check the full request before replying. A keyword match is not buying intent.' },
  linkedin: { name: 'LinkedIn', purpose: 'Explain a concrete work problem to a professional audience.', limitation: 'A connected account is not proof that the right people will see the post. Learn from actual responses.' },
  x: { name: 'X', purpose: 'Share a short demonstration with a relevant audience.', limitation: 'A publication receipt proves the post exists, not that it reached a buyer.' },
  facebook: { name: 'Facebook Page', purpose: 'Share useful examples with people following your business.', limitation: 'Page access does not allow posting in groups. Community placements may need a person to arrange them.' },
};
function observed(at: number | null | undefined, now: number) {
  if (!at) return 'Not measured yet';
  return `${now - at > 48 * 3600000 ? 'Needs a refresh. ' : ''}Last checked ${new Date(at).toLocaleDateString()}`;
}

export function GuideScreen({ productId, onProduct, onNavigate, onToast }: Props) {
  const [data, setData] = useState<GuideData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState(false);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const goalRef = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const loading = useRef(false);
  const actionLock = useRef(false);
  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const [operations, marketing, analytics, revenue] = await Promise.allSettled([
        window.signal.operations(), window.signal.marketing(), window.signal.analytics(), window.signal.revenue(),
      ]);
      if (!active.current) return;
      if (operations.status === 'rejected' || marketing.status === 'rejected') throw new Error('Could not refresh your guide. Previous information may be out of date.');
      setData({ operations: operations.value, marketing: marketing.value, analytics: analytics.status === 'fulfilled' ? analytics.value : null, revenue: revenue.status === 'fulfilled' ? revenue.value : null });
      setError('');
    } catch (err) { if (active.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { loading.current = false; }
  }, []);
  useEffect(() => { active.current = true; void refresh(); const timer = setInterval(() => void refresh(), 5000); return () => { active.current = false; clearInterval(timer); }; }, [refresh]);
  useEffect(() => { setMessage(''); setEditing(false); }, [productId]);
  useEffect(() => { if (editing) goalRef.current?.querySelector('select')?.focus(); }, [editing]);
  const product = data?.operations.products.find(p => p.id === productId) ?? data?.operations.products[0];
  const ask = async () => {
    if (!product || !message.trim() || actionLock.current) return;
    actionLock.current = true; setBusy(true);
    const id = product.id;
    try {
      const next = await window.signal.marketingAction({ type: 'guide-chat', productId: id, message: message.trim() });
      if (active.current) { setData(old => old ? { ...old, marketing: next } : old); setMessage(''); }
      onToast('Question saved. Signal’s reply will appear here.');
    } catch (err) { onToast(String(err), 'warn'); }
    finally { actionLock.current = false; if (active.current) setBusy(false); }
  };
  if (!data) return <div className="page guide-page"><h1>My marketer</h1><p role={error ? 'alert' : 'status'}>{error || 'Bringing your goals, activity and next steps together…'}</p>{error && <button className="btn" onClick={() => void refresh()}>Try again</button>}</div>;
  if (!product) return <div className="page guide-page"><h1>Let’s give your business a starting point</h1><p>Add a business before choosing its marketing goal.</p><button className="btn" onClick={() => onNavigate({ screen: 'settings' }, '')}>Open settings</button></div>;
  const now = Date.now();
  const { operations, marketing, analytics, revenue } = data;
  const summary = marketingGuide(operations, marketing, product.id, now);
  const plan = marketing.guidePlans?.find(p => p.productId === product.id)?.value;
  const state = operations.states.find(s => s.productId === product.id);
  const progress = operationProgress(operations, product.id, now);
  const navigate = (destination: GuideDestination) => onNavigate(destination, product.id);
  const go = (step: GuideStep) => {
    if (step.destination) navigate(step.destination);
    else { setEditing(true); goalRef.current?.scrollIntoView({ block: 'center' }); }
  };
  const suggest = (text: string) => { setMessage(text); messageRef.current?.focus(); messageRef.current?.scrollIntoView({ block: 'center' }); };
  const taskIds = new Set(marketing.guideTaskIds ?? []);
  const messages = marketing.messages.filter(m => m.productId === product.id && m.taskId && taskIds.has(m.taskId)).slice(-12);
  const tasks = marketing.tasks.filter(t => t.productId === product.id && taskIds.has(t.id));
  const pending = tasks.find(t => ['queued', 'running'].includes(t.status));
  const latestTask = tasks[0];
  const snapshot = analytics?.snapshots.find(s => s.productId === product.id);
  const revenueState = revenue?.states.find(s => s.productId === product.id && s.live);
  const paymentCount = revenueState?.status === 'current' && revenueState.lastCompleteAt ? revenue?.totals.find(t => t.productId === product.id)?.rows.filter(r => r.live).reduce((sum, r) => sum + r.payments, 0) : undefined;
  const published = operations.deliveries.filter(d => d.productId === product.id && d.status === 'published' && d.receipt);
  const channels = [...new Set(operations.accounts.filter(a => a.productId === product.id && state?.accountIds.includes(a.id)).map(a => a.provider))];
  const connection = marketing.codexConnections?.find(c => c.productId === product.id);
  const mission = marketing.missions?.find(m => m.productId === product.id);
  const agentUnavailable = operations.offline || (!connection && ['attention', 'stopped', 'recovering', 'checking'].includes(operations.runtimeHealth?.status ?? ''));
  return <div className="page guide-page">
    <header className="page-head"><div><h1 className="page-title">My marketer</h1><p className="page-lede">We’ll work out the next step together.</p></div><label>Working on<select aria-label="Guide business" value={product.id} disabled={busy} onChange={e => onProduct(e.target.value)}>{operations.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></header>
    {error && <p role="alert">{error} <button className="btn" onClick={() => void refresh()}>Refresh guide</button></p>}
    <RevenueMission productName={product.name} mission={mission} connection={connection} pending={Boolean(pending)} disabled={busy || operations.offline || Boolean(error)} revenue={() => navigate({ screen: 'revenue' })} act={action => {
      if (actionLock.current) return; actionLock.current = true; setBusy(true);
      void window.signal.marketingAction({ ...action, productId: product.id }).then(next => { if (active.current) setData(old => old ? { ...old, marketing: next } : old); onToast(action.type === 'connect-codex' ? 'Codex connected and a live reply verified.' : action.type === 'mission-review' ? 'Mission review saved for Codex.' : 'Daily review updated.'); }).catch(err => onToast(String(err), 'warn')).finally(() => { actionLock.current = false; setBusy(false); });
    }} />
    <div className="guide-status"><span className={`guide-status-dot ${summary.working ? 'is-ready' : ''}`} /><strong>{summary.status}</strong><span>{summary.statusDetail}</span></div>
    <div className="guide-layout">
      <div className="guide-main">
        <section className="guide-next" aria-labelledby="guide-next-title">
          <div className="guide-voice"><img src="./signal.svg" width="24" height="24" alt="" /><span>Your next step</span></div>
          <h2 id="guide-next-title">{summary.next.title}</h2><p>{summary.next.detail}</p>
          <div className="guide-why"><strong>Why this comes next</strong><p>{summary.next.why}</p></div>
          <div className="guide-actions"><button className="btn btn-primary" onClick={() => go(summary.next)}>{summary.next.button}</button><button className="btn" onClick={() => suggest(`Help me understand this next step: ${summary.next.title}. Explain how it helps our goal and what you can do for me.`)}>Talk it through</button></div>
        </section>
        <section className="guide-activity" aria-label="Current agent activity"><h2>What Signal is doing</h2><p><strong>{summary.working ? progress.title : summary.status}</strong></p><p>{summary.working ? progress.detail : summary.statusDetail}</p>{state?.lastCycleAt && <p>Last marketing cycle started {new Date(state.lastCycleAt).toLocaleString()}. Starting a cycle does not mean it completed.</p>}<button className="guide-link" onClick={() => navigate({ screen: 'operations', section: 'overview' })}>See activity and controls</button></section>
        <section className="guide-conversation" aria-labelledby="guide-chat-title">
          <h2 id="guide-chat-title">Talk to your marketer</h2><p>Ask a question, change direction, or tell me where you’re stuck.</p>
          {messages.length > 0 && <div className="guide-messages" aria-label="Your marketing conversation">{messages.map(m => <article key={m.id} className={`guide-message ${m.role === 'user' ? 'from-user' : ''}`}><strong>{m.role === 'user' ? 'You' : 'Signal'}</strong><p>{m.body}</p></article>)}</div>}
          {pending && <p className="guide-chat-status" role="status">{pending.status === 'running' ? 'Signal is working on your question.' : 'Your question is saved and waiting for the agent.'} Keep Signal open; replies appear here.</p>}
          {!pending && latestTask?.status === 'failed' && <div role="alert"><p>Your last question is saved, but the agent could not finish its reply.</p><details><summary>What happened</summary><p>{latestTask.error || 'Check the agent connection and try again.'}</p></details><button className="btn" onClick={() => navigate({ screen: 'settings' })}>Check agent settings</button></div>}
          {!messages.length && <div className="guide-prompts">{['Who should we focus on first?', 'Why are we using these channels?', 'What can you prepare for me?'].map(prompt => <button className="btn" key={prompt} onClick={() => suggest(prompt)}>{prompt}</button>)}</div>}
          <form onSubmit={e => { e.preventDefault(); void ask(); }}><label htmlFor="guide-question">What would you like help with?</label><textarea id="guide-question" ref={messageRef} value={message} maxLength={4000} onChange={e => setMessage(e.target.value)} placeholder="I don’t know how to find people who would buy this…" disabled={busy} /><div className="guide-composer-footer"><span>Signal can research and prepare drafts here. Sending and publishing stay in their review workflows.</span><button className="btn btn-primary" disabled={busy || Boolean(pending) || agentUnavailable || Boolean(error) || !message.trim()}>{busy ? 'Saving question…' : 'Ask Signal'}</button></div></form>
          {agentUnavailable && <p role="status">{operations.offline ? 'Chat is unavailable in this offline preview.' : 'The agent connection needs attention before it can answer.'} {!operations.offline && <button className="btn" onClick={() => navigate({ screen: 'settings' })}>Open agent settings</button>}</p>}
        </section>
        <section className="guide-path" aria-labelledby="guide-path-title"><h2 id="guide-path-title">The path to a sale</h2><p>Each step answers a different question. We’ll use evidence to decide where to focus.</p><ol>
          <li><div><h3>Reach the right people</h3><p>Who has a problem your product can solve? Research and introductions help us find out.</p><button className="guide-link" onClick={() => navigate({ screen: 'operations', section: 'research' })}>See buyer research</button></div></li>
          <li><div><h3>Help them get a useful result</h3><p>Give interested people one task to try, then find out what helped or got in their way.</p><button className="guide-link" onClick={() => navigate({ screen: 'sales', section: 'conversations' })}>See conversations</button></div></li>
          <li><div><h3>Learn what leads to a purchase</h3><p>Check actual payments and the reasons people decline before repeating a campaign.</p><button className="guide-link" onClick={() => navigate({ screen: 'revenue' })}>See purchase records</button></div></li>
        </ol></section>
      </div>
      <aside className="guide-aside" aria-label="Your goal and decisions">
        <section className="guide-goal" ref={goalRef} aria-labelledby="guide-goal-title"><h2 id="guide-goal-title">Our focus for {product.name}</h2>{plan && !editing ? <><h3>{GUIDE_GOALS[plan.goal].label}</h3><p>{GUIDE_GOALS[plan.goal].why}</p><p><strong>Audience:</strong> {plan.audience || 'Still to decide together'}</p><button className="guide-link" onClick={() => setEditing(true)}>Change our focus</button></> : <GoalForm key={product.id} value={plan} disabled={busy || Boolean(error)} save={async value => { if (actionLock.current) return; actionLock.current = true; setBusy(true); try { const next = await window.signal.marketingAction({ type: 'guide-plan', productId: product.id, value }); setData(old => old ? { ...old, marketing: next } : old); setEditing(false); onToast('Your focus is saved for this business.'); } catch (err) { onToast(String(err), 'warn'); } finally { actionLock.current = false; setBusy(false); } }} />}</section>
        <section className="guide-help" aria-labelledby="guide-help-title"><h2 id="guide-help-title">Where I need you <span>{summary.needsYou.length}</span></h2>{summary.needsYou.length ? summary.needsYou.map(step => <article key={step.id}><h3>{step.title}</h3><p>{step.detail}</p><button className="guide-link" onClick={() => go(step)}>{step.button}</button></article>) : <p>No review requests are recorded right now. New customer decisions and prepared drafts will appear here.</p>}</section>
        <section className="guide-evidence" aria-labelledby="guide-evidence-title"><h2 id="guide-evidence-title">What we actually know</h2><dl><div><dt>Confirmed publications</dt><dd>{published.length}<small>In saved Operations history</small></dd></div><div><dt>Recorded website visits</dt><dd>{snapshot ? analyticsTotals(snapshot.rows).sessions : 'Unknown'}<small>{snapshot ? `${snapshot.startDate} to ${snapshot.endDate}. ${observed(snapshot.observedAt, now)}` : 'Connect and refresh website analytics.'}</small></dd></div><div><dt>Recorded live payments</dt><dd>{paymentCount ?? 'Unknown'}<small>{observed(revenueState?.lastCompleteAt, now)}{revenueState ? `. From ${new Date(revenueState.since).toLocaleDateString()}; selected products only.` : ''}</small></dd></div></dl><p>Visits are sessions, not unique buyers. Payment counts are not profit. Missing or stale reports cannot tell us whether a campaign failed.</p><button className="guide-link" onClick={() => navigate({ screen: 'analytics' })}>Review measurement</button></section>
      </aside>
    </div>
    <section className="guide-channels" aria-labelledby="guide-channels-title"><div className="guide-section-heading"><div><h2 id="guide-channels-title">How our channels help</h2><p>A channel is a place to reach people. These are your saved destinations, not proven winners.</p></div><button className="btn" onClick={() => navigate({ screen: 'operations', section: 'settings' })}>Manage channels</button></div>{state?.learning && <div className="guide-channel-decision"><h3>Why Signal chose its last channel</h3><p>{state.learning.reason}</p><p>Decision recorded {new Date(state.learning.decidedAt).toLocaleString()}. {plan ? 'We can discuss how this fits your current focus in the conversation above.' : 'Choose your focus to discuss whether this approach still fits.'}</p></div>}{channels.length ? <div className="guide-channel-list">{channels.map(channel => { const copy = channelCopy[channel]; return <article key={channel}><h3>{copy?.name ?? channel}</h3><p>{copy?.purpose ?? 'Review how this destination can reach your intended audience.'}</p><details><summary>What to learn from this channel</summary><p>{copy?.limitation ?? 'Check actual responses before deciding to expand.'}</p></details></article>; })}</div> : <p>No destinations selected yet. We can choose a channel after we define your audience.</p>}</section>
  </div>;
}

function GoalForm({ value, disabled, save }: { value: GuidePlan | undefined; disabled: boolean; save: (value: GuidePlan) => Promise<void> }) {
  const [goal, setGoal] = useState<GuidePlan['goal']>(value?.goal ?? 'first-sales');
  const [audience, setAudience] = useState(value?.audience ?? '');
  return <form onSubmit={e => { e.preventDefault(); void save({ goal, audience }); }}><label>What matters most?<select aria-label="Marketing goal" value={goal} onChange={e => setGoal(e.target.value as GuidePlan['goal'])}>{Object.entries(GUIDE_GOALS).map(([key, choice]) => <option value={key} key={key}>{choice.label}</option>)}</select></label><label>Who do you want to help? <span>(optional)</span><textarea aria-label="Intended audience" value={audience} maxLength={500} onChange={e => setAudience(e.target.value)} placeholder="For example, consultants comparing client reports. It’s okay if you don’t know yet." /></label><button className="btn btn-primary" disabled={disabled}>Save our focus</button><p className="guide-form-note">This guides our conversations. It does not change sending permissions or start automation.</p></form>;
}
