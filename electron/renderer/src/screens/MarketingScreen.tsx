import { useCallback, useEffect, useState } from 'react';
import type { MarketingAction, MarketingSettings, MarketingView } from '../../../../src/shared/marketing.js';
import '../styles/growth.css';
import '../styles/marketing.css';

type Tab = 'chat' | 'engineering' | 'memory' | 'content' | 'budget' | 'media';
type Props = { onToast: (message: string, kind?: 'ok' | 'warn') => void; initialTab?: Tab };
const labels: Record<Tab, string> = { chat: 'Talk to Signal', engineering: 'Engineering requests', memory: 'Memory graph', content: 'Content & responses', budget: 'Cash & tiers', media: 'Media & product access' };

export function MarketingScreen({ onToast, initialTab = 'chat' }: Props): React.JSX.Element {
  const [data, setData] = useState<MarketingView | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [productId, setProductId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedMemory, setSelectedMemory] = useState('');
  const [memoryText, setMemoryText] = useState('');
  const [memoryQuery, setMemoryQuery] = useState('');
  const [comfy, setComfy] = useState<{ ok: boolean; detail: string; checkpoints: string[] } | null>(null);
  const [checkpoint, setCheckpoint] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [mediaPrompt, setMediaPrompt] = useState('');
  const [workflowJson, setWorkflowJson] = useState('');
  const [publishedUrl, setPublishedUrl] = useState('');
  const refresh = useCallback(async () => { try { setData(await window.signal.marketing()); } catch (e) { setError(String(e)); } }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 3000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => setTab(initialTab), [initialTab]);
  const act = async (action: MarketingAction): Promise<boolean> => {
    setBusy(true); setError('');
    try { setData(await window.signal.marketingAction(action)); return true; }
    catch (e) { setError(String(e).replace(/^Error: Error invoking remote method '[^']+': Error: /, '')); return false; }
    finally { setBusy(false); }
  };
  const invoke = async (operation: () => Promise<unknown>) => { setBusy(true); setError(''); try { await operation(); await refresh(); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
  if (!data) return <div className="page"><h1 className="page-title">Marketing agent</h1><p role="status">{error || 'Opening your local marketing workspace…'}</p></div>;
  const product = data.products.find((p) => p.id === productId) ?? data.products[0];
  if (!product) return <div className="page">Add a product to start.</div>;
  const scoped = <T extends { productId: string }>(rows: T[]): T[] => rows.filter((r) => r.productId === product.id);
  const tasks = scoped(data.tasks);
  const active = tasks.filter((t) => ['queued', 'running'].includes(t.status));
  const latestTask = tasks[0];
  const messages = scoped(data.messages);
  const requests = scoped(data.requests);
  const memories = scoped(data.memories).filter((m) => m.status === 'active');
  const visibleMemories = memories.filter((m) => `${m.title} ${m.body}`.toLowerCase().includes(memoryQuery.toLowerCase()));
  const selected = memories.find((m) => m.id === selectedMemory);
  const graphNodes = visibleMemories.slice(0, 16);
  const graphPosition = new Map(graphNodes.map((m, i) => [m.id, { x: 310 + Math.cos(i * Math.PI * 2 / graphNodes.length) * 235, y: 175 + Math.sin(i * Math.PI * 2 / graphNodes.length) * 125 }]));
  const money = (n: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: product.currency }).format(n / 100);
  const files = scoped(data.workflows);
  const selectedWorkflow = files.find((w) => w.id === workflowId) ?? files[0];
  return <div className="page marketing-page">
    <div className="growth-heading"><div><p className="growth-eyebrow">YOUR LOCAL MARKETING COLLEAGUE</p><h1 className="page-title">Build demand. Earn the next step.</h1><p className="page-lede">A plan, a useful conversation, a small test. Keep what works.</p></div>
      <label className="growth-product">Product<select aria-label="Marketing product" value={product.id} onChange={(e) => { setProductId(e.target.value); setSelectedMemory(''); }}>{data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    </div>
    <div className="marketing-summary">
      <div><span>Current tier</span><strong>{product.budget.tier.replaceAll('-', ' ')}</strong></div>
      <div><span>Available cash envelope</span><strong>{money(product.budget.availableCents)}</strong></div>
      <div><span>Engineering proposals</span><strong>{requests.filter((r) => !['shipped', 'dismissed'].includes(r.status)).length}</strong></div>
      <div><span>Local memory</span><strong>{memories.length} entries</strong></div>
    </div>
    <div className="growth-tabs" role="tablist" aria-label="Marketing views">{(Object.keys(labels) as Tab[]).map((key) => <button role="tab" aria-selected={tab === key} key={key} onClick={() => setTab(key)}>{labels[key]}</button>)}</div>
    {error && <p className="growth-error selectable" role="alert">{error}</p>}
    <button className="btn marketing-research-link" onClick={() => void invoke(() => window.signal.marketingReport())}>Read the marketing research</button>
    {active.length > 0 && <div className="marketing-running" role="status"><strong>{active.some((t) => t.status === 'running') ? 'Signal is working locally' : 'Your request is queued'}</strong><span>{active.length} active request{active.length === 1 ? '' : 's'} · Local tasks share one worker with Growth lab and ComfyUI.</span><button className="btn" onClick={() => void invoke(() => window.signal.growthAction({ type: 'cancel', taskId: active.find((t) => t.status === 'running')?.id ?? active[0]!.id }))}>Cancel current request</button></div>}
    {latestTask?.status === 'failed' && <div className="growth-error" role="alert">{latestTask.error}<button className="btn" onClick={() => void invoke(() => window.signal.growthAction({ type: 'retry', taskId: latestTask.id }))}>Retry request</button></div>}
    {tab === 'chat' && <>
      <div className="marketing-chat" aria-label="Conversation with Signal">
        {!messages.length && <div className="marketing-message assistant"><strong>Signal</strong><p>I’ll help turn what people need into useful marketing and small tests. We’ll start with zero cash. Tell me what you want to work on, or let me review the next opportunity.</p></div>}
        {messages.map((m) => <article className={`marketing-message ${m.role}`} key={m.id}><strong>{m.role === 'user' ? 'You' : 'Signal'}</strong><p className="selectable">{m.body}</p><time>{new Date(m.createdAt).toLocaleString()}</time></article>)}
      </div>
      <form className="marketing-composer" onSubmit={(e) => { e.preventDefault(); void act({ type: 'chat', productId: product.id, message }).then((ok) => { if (ok) setMessage(''); }); }}>
        <label htmlFor="marketing-message">What should we work on?</label><textarea id="marketing-message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Find one useful way to reach our first customers. Draft the response and tell engineering what’s missing." maxLength={4000} required rows={3} />
        <div className="growth-actions"><button className="btn btn-primary" disabled={busy || !message.trim()}>Send to Signal</button><button type="button" className="btn" disabled={busy || active.length > 0} onClick={() => void act({ type: 'cycle', productId: product.id })}>Run next marketing cycle</button></div>
      </form>
      <details className="card marketing-tools"><summary>Tool activity</summary>{scoped(data.tools).slice(0, 20).map((t) => <div key={t.id}><strong>{t.name} · {t.status}</strong><pre className="growth-output">{t.result}</pre></div>)}</details>
      <OperatorSettings settings={data.settings} busy={busy} save={(value) => act({ type: 'settings', value })} />
    </>}
    {tab === 'engineering' && <>
      <h2>What the products need next</h2><p className="growth-muted">Proposals link a customer problem to a measurable test. “Shipped” is an owner update, not an agent claim that code changed.</p>
      {requests.map((r) => <article className="card marketing-request" key={r.id}><div className="growth-section-title"><h3>{r.value.title}</h3><span className="growth-pill">{r.value.priority}</span></div><p>{r.value.problem}</p><p><strong>Why:</strong> {r.value.rationale}</p><p><strong>Try first:</strong> {r.value.workaround}</p><p><strong>Measure:</strong> {r.value.metric}</p><strong>Acceptance criteria</strong><ul>{r.value.acceptance.map((a, i) => <li key={i}>{a}</li>)}</ul><details><summary>Evidence</summary>{r.value.evidence.map((a, i) => <p className="selectable" key={i}>{a}</p>)}</details><label>Status<select aria-label={`Status: ${r.value.title}`} value={r.status} disabled={busy} onChange={(e) => void act({ type: 'requestStatus', productId: product.id, id: r.id, status: e.target.value as 'proposed' | 'accepted' | 'building' | 'shipped' | 'dismissed' })}>{['proposed', 'accepted', 'building', 'shipped', 'dismissed'].map((s) => <option key={s}>{s}</option>)}</select></label><button className="btn" onClick={() => void window.signal.copyToClipboard(`# ${r.value.title}\n\n${r.value.problem}\n\n${r.value.acceptance.map((a) => `- [ ] ${a}`).join('\n')}\n\nEvidence: ${r.value.evidence.join('\n')}`).then(() => onToast('Engineering brief copied'))}>Copy engineering brief</button></article>)}
    </>}
    {tab === 'memory' && <>
      <h2>Memory with a source behind it</h2><p className="growth-muted">Local, product-scoped entries and relationships. Observations, preferences and hypotheses stay distinct. Corrections preserve the superseded history; forgetting excludes an entry from retrieval.</p>
      <input aria-label="Search memory" value={memoryQuery} onChange={(e) => setMemoryQuery(e.target.value)} placeholder="Search facts, customer problems or lessons" />
      <svg className="marketing-graph" viewBox="0 0 620 350" role="img" aria-label="Product memory graph"><title>Inspectable product memory relationships</title>{scoped(data.edges).filter((e) => graphPosition.has(e.fromId) && graphPosition.has(e.toId)).map((e) => <line key={e.id} x1={graphPosition.get(e.fromId)!.x} y1={graphPosition.get(e.fromId)!.y} x2={graphPosition.get(e.toId)!.x} y2={graphPosition.get(e.toId)!.y} />)}{graphNodes.map((m) => <g key={m.id} transform={`translate(${graphPosition.get(m.id)!.x},${graphPosition.get(m.id)!.y})`} role="button" tabIndex={0} aria-label={m.title} onClick={() => setSelectedMemory(m.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedMemory(m.id); }}><circle r={m.kind === 'product' ? 17 : 10} /><text y={28} textAnchor="middle">{m.title.slice(0, 22)}</text></g>)}</svg>
      <div className="marketing-memory-list">{visibleMemories.map((m) => <button className="btn" key={m.id} onClick={() => setSelectedMemory(m.id)}>{m.title} <small>· {m.kind}</small></button>)}</div>
      {selected && <article className="card marketing-request"><h3>{selected.title}</h3><p className="selectable">{selected.body}</p><p className="selectable">Source: {selected.source}</p><small>{selected.kind} · confidence {Math.round(selected.confidence * 100)}% · {new Date(selected.createdAt).toLocaleString()}</small><div className="growth-actions"><button className="btn" onClick={() => setMemoryText(selected.body)}>Correct this memory</button><button className="btn" disabled={busy} onClick={() => void act({ type: 'forget', productId: product.id, id: selected.id }).then(() => setSelectedMemory(''))}>Forget this memory</button></div></article>}
      <form className="marketing-composer" onSubmit={(e) => { e.preventDefault(); void act({ type: 'memory', productId: product.id, value: { title: selected ? selected.title : memoryText.slice(0, 90), body: memoryText, kind: 'preference', source: 'Owner-provided memory', confidence: 1, ...(selected ? { supersedesId: selected.id } : {}) } }).then((ok) => { if (ok) { setMemoryText(''); setSelectedMemory(''); } }); }}><label htmlFor="memory-note">{selected ? 'Correct selected memory' : 'Remember a preference or confirmed fact'}</label><textarea id="memory-note" value={memoryText} onChange={(e) => setMemoryText(e.target.value)} required maxLength={4000} /><button className="btn" disabled={busy || !memoryText.trim()}>Save memory</button></form>
    </>}
    {tab === 'content' && <>
      <h2>Useful work, ready for your review</h2><p className="growth-muted">Approval marks copy ready. It does not send or publish it. Community replies in the existing Review queue retain their platform checks.</p>
      {!scoped(data.drafts).length && <p>Ask Signal to prepare a reply, article, email or demo outline.</p>}
      {scoped(data.drafts).map((draft) => <article className="card marketing-request" key={draft.id}><div className="growth-section-title"><h3>{draft.value.title}</h3><span>{draft.value.kind} · {draft.status}</span></div><p className="marketing-copy selectable">{draft.value.body}</p>{['draft', 'approved'].includes(draft.status) && <DraftEditor key={draft.id + draft.value.body} body={draft.value.body} busy={busy} save={(body) => act({ type: 'draftEdit', productId: product.id, id: draft.id, body })} />}<details><summary>Evidence & destination</summary><p>{draft.value.targetUrl || 'No destination selected'}</p>{draft.value.evidence.map((e, i) => <p key={i}>{e}</p>)}</details><div className="growth-actions"><button className="btn" onClick={() => void window.signal.copyToClipboard(draft.value.body).then(() => onToast('Draft copied'))}>Copy draft</button>{draft.status === 'draft' && <button className="btn" disabled={busy} onClick={() => void act({ type: 'draftStatus', productId: product.id, id: draft.id, status: 'approved' })}>Approve copy</button>}<button className="btn" disabled={busy} onClick={() => void act({ type: 'draftStatus', productId: product.id, id: draft.id, status: 'rejected' })}>Reject</button></div>{draft.status === 'approved' && <form onSubmit={(e) => { e.preventDefault(); void act({ type: 'draftStatus', productId: product.id, id: draft.id, status: 'published', publishedUrl }); }}><input type="url" aria-label="Actual published URL" placeholder="Actual published URL" required value={publishedUrl} onChange={(e) => setPublishedUrl(e.target.value)} /><button className="btn" disabled={busy}>Record publication</button></form>}</article>)}
    </>}
    {tab === 'budget' && <>
      <h2>Earn the next tier</h2><p>{product.budget.explanation}</p><ol className="marketing-tiers"><li>Bootstrap: zero-cash discovery and useful responses.</li><li>Organic: a completed test meets its customer and acquisition-cost goals.</li><li>Funded tests: a promising test plus recorded settled surplus funds a bounded experiment.</li><li>Repeatable: at least two promising tests in the same channel, with funds still available.</li></ol>
      <p className="growth-muted">The cash envelope is the smaller of your owner cap and reinvestment share of settled surplus above your reserve, minus actual marketing spend and commitments. It does not refill with the calendar. These are operating rules, not thresholds prescribed by Traction.</p>
      <div className="marketing-summary"><div><span>Recorded settled surplus</span><strong>{money(product.budget.surplusCents)}</strong></div><div><span>Allocated envelope</span><strong>{money(product.budget.allocationCents)}</strong></div><div><span>Committed</span><strong>{money(product.budget.committedCents)}</strong></div><div><span>Spent</span><strong>{money(product.budget.spentCents)}</strong></div></div>
      <CashForm productId={product.id} busy={busy} act={act} />
      {scoped(data.cash).map((c) => <p className="marketing-ledger" key={c.id}>{c.kind.replaceAll('_', ' ')} · {money(c.amountCents)} · {c.reference}<small>{c.note}</small></p>)}
      {scoped(data.commitments).filter((c) => c.status === 'reserved').map((c) => <div className="marketing-ledger" key={c.id}>{c.reference} · {money(c.amountCents)} reserved<button className="btn" onClick={() => void act({ type: 'release', productId: product.id, id: c.id })}>Release commitment</button></div>)}
      <OperatorSettings settings={data.settings} busy={busy} save={(value) => act({ type: 'settings', value })} />
    </>}
    {tab === 'media' && <>
      <h2>Real product evidence and local creative</h2><div className="growth-actions"><button className="btn" onClick={() => void invoke(() => window.signal.marketingProduct(product.id, false))}>Open product session</button><button className="btn" onClick={() => void invoke(() => window.signal.marketingProduct(product.id, true))}>Capture product screenshot</button><button className="btn" disabled={busy} onClick={() => void invoke(async () => setComfy(await window.signal.marketingComfy(product.id)))}>Check ComfyUI</button></div>
      <p className="growth-muted">Real screenshots document the product. ComfyUI generates creative assets; they are not proof of product behavior. Product sessions are isolated from Signal’s database.</p>
      {comfy && <p role="status">{comfy.detail}</p>}
      {Boolean(comfy?.checkpoints.length) && <div className="card marketing-request"><label>Installed checkpoint<select value={checkpoint || comfy!.checkpoints[0]} onChange={(e) => setCheckpoint(e.target.value)}>{comfy!.checkpoints.map((c) => <option key={c}>{c}</option>)}</select></label><p className="growth-muted">The starter workflow is a 512px image template for compatible SD-style checkpoints. Use an API workflow for other architectures, video or audio.</p><button className="btn" onClick={() => void invoke(() => window.signal.marketingComfy(product.id, checkpoint || comfy!.checkpoints[0]))}>Add local image workflow</button></div>}
      <details className="card marketing-request"><summary>Import a local ComfyUI API workflow</summary><p>Export API format from ComfyUI. Put {'{{prompt}}'} in the text field Signal should fill. Built-in local nodes only; paid API and custom execution nodes are not accepted.</p><textarea aria-label="ComfyUI API workflow JSON" value={workflowJson} onChange={(e) => setWorkflowJson(e.target.value)} rows={5} /><button className="btn" disabled={busy} onClick={() => void invoke(async () => { await act({ type: 'workflow', productId: product.id, name: 'Imported local workflow', workflow: JSON.parse(workflowJson) as Record<string, unknown> }); })}>Save workflow</button></details>
      <form className="marketing-composer" onSubmit={(e) => { e.preventDefault(); if (selectedWorkflow) void act({ type: 'media', productId: product.id, workflowId: selectedWorkflow.id, prompt: mediaPrompt }); }}><label>Workflow<select aria-label="Media workflow" value={selectedWorkflow?.id ?? ''} onChange={(e) => setWorkflowId(e.target.value)}><option value="">Choose a saved workflow</option>{files.map((w) => <option value={w.id} key={w.id}>{w.name}</option>)}</select></label><label>Creative brief<textarea aria-label="Creative brief" required value={mediaPrompt} onChange={(e) => setMediaPrompt(e.target.value)} maxLength={4000} /></label><button className="btn btn-primary" disabled={busy || !selectedWorkflow}>Generate locally with ComfyUI</button></form>
      {scoped(data.media).map((m) => <article className="card marketing-request" key={m.id}><h3>{m.status} · ComfyUI</h3><p>{m.prompt}</p>{m.error && <p role="status">{m.error}</p>}{m.outputs.map((o, i) => <button key={i} className="btn" onClick={() => void invoke(() => window.signal.marketingAsset(m.id, i))}>Save & open {o.filename}</button>)}{['queued', 'running'].includes(m.status) && <button className="btn" onClick={() => void invoke(() => window.signal.marketingCancelMedia(m.id))}>Cancel queued media</button>}</article>)}
    </>}
  </div>;
}

function OperatorSettings({ settings, busy, save }: { settings: MarketingSettings; busy: boolean; save: (v: MarketingSettings) => Promise<boolean> }): React.JSX.Element {
  const [value, setValue] = useState(settings);
  return <details className="card marketing-request"><summary>Operator settings, voice and cash policy</summary><form onSubmit={(e) => { e.preventDefault(); void save(value); }}><label>Local operator model<input value={value.model} onChange={(e) => setValue({ ...value, model: e.target.value })} /></label><label className="marketing-check"><input type="checkbox" checked={value.enabled} onChange={(e) => setValue({ ...value, enabled: e.target.checked })} />Run scheduled marketing cycles while Signal is open</label><div className="marketing-form-grid"><label>Hours between cycles<input type="number" min={1} max={168} value={value.intervalHours} onChange={(e) => setValue({ ...value, intervalHours: Number(e.target.value) })} /></label><label>Reinvest settled surplus (%)<input type="number" min={0} max={100} value={value.reinvestPct} onChange={(e) => setValue({ ...value, reinvestPct: Number(e.target.value) })} /></label><label>Additional reserve ($)<input type="number" min={0} step="0.01" value={value.reserveCents / 100} onChange={(e) => setValue({ ...value, reserveCents: Math.round(Number(e.target.value) * 100) })} /></label><label>Total allocation cap ($)<input type="number" min={0} step="0.01" value={value.capCents / 100} onChange={(e) => setValue({ ...value, capCents: Math.round(Number(e.target.value) * 100) })} /></label></div><label>Voice and response preferences<textarea value={value.voice} onChange={(e) => setValue({ ...value, voice: e.target.value })} maxLength={4000} rows={4} /></label><label>Local ComfyUI URL<input value={value.comfyUrl} onChange={(e) => setValue({ ...value, comfyUrl: e.target.value })} /></label><label>Optional local SearXNG URL<input value={value.searxUrl} onChange={(e) => setValue({ ...value, searxUrl: e.target.value })} placeholder="No paid search account required; leave empty to use discovered signals and URLs" /></label><button className="btn" disabled={busy}>Save operator settings</button></form></details>;
}
function CashForm({ productId, busy, act }: { productId: string; busy: boolean; act: (a: MarketingAction) => Promise<boolean> }): React.JSX.Element {
  const [kind, setKind] = useState<'settled_surplus' | 'adjustment' | 'spend' | 'reserve'>('settled_surplus');
  const [amount, setAmount] = useState(''); const [reference, setReference] = useState(''); const [note, setNote] = useState('');
  return <form className="card marketing-request" onSubmit={(e) => { e.preventDefault(); const amountCents = Math.round(Number(amount) * 100); void act(kind === 'reserve' ? { type: 'reserve', productId, amountCents, reference, note } : { type: 'cash', productId, value: { kind, amountCents, reference, note } }).then((ok) => { if (ok) { setAmount(''); setReference(''); setNote(''); } }); }}><h3>Record real cash or reserve a funded test</h3><p>Surplus means settled funds left after fees, refunds, delivery costs and business obligations. Enter only what is actually available. Unknown costs mean no surplus yet. Use a new reference for each entry; a spend with a reservation’s reference settles that commitment.</p><div className="marketing-form-grid"><label>Entry type<select aria-label="Cash entry type" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="settled_surplus">Settled surplus</option><option value="adjustment">Reduce surplus / refund / correction</option><option value="spend">Actual marketing spend</option><option value="reserve">Reserve a funded experiment</option></select></label><label>Amount ($)<input aria-label="Cash amount" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label></div><label>Unique record reference<input aria-label="Cash reference" value={reference} onChange={(e) => setReference(e.target.value)} required maxLength={160} /></label><label>Evidence and deductions already accounted for<textarea aria-label="Cash evidence" value={note} onChange={(e) => setNote(e.target.value)} required maxLength={4000} /></label><button className="btn" disabled={busy}>Record cash entry</button></form>;
}

function DraftEditor({ body, busy, save }: { body: string; busy: boolean; save: (body: string) => Promise<boolean> }): React.JSX.Element {
  const [text, setText] = useState(body);
  return <details><summary>Edit this draft</summary><form onSubmit={(e) => { e.preventDefault(); void save(text); }}><textarea aria-label="Edit draft body" value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} required rows={6} /><button className="btn" disabled={busy}>Save edited draft</button><p className="growth-muted">Editing returns the copy to draft status for review.</p></form></details>;
}
