import { useState } from 'react';
import type { VideoAction, VideoView } from '../../../../src/shared/video.js';

export function AdDirector({ productId, view, busy, action }: { productId: string; view: VideoView; busy: boolean; action: (value: VideoAction) => Promise<void> }) {
  const [objective, setObjective] = useState('Show one frustrating customer task, demonstrate how our app helps, and invite viewers to try it.');
  const [audience, setAudience] = useState('');
  const [ratio, setRatio] = useState<'9:16' | '16:9' | '1:1'>('9:16');
  const [characterId, setCharacter] = useState('');
  const [demoId, setDemo] = useState('');
  const plans = (view.adDirector ?? []).filter(p => p.productId === productId).slice(0, 5);
  const pending = plans.some(p => ['queued', 'researching'].includes(p.status));
  const characters = view.characters.filter(c => c.productId === productId && c.reference && c.approvedAt);
  const demos = view.jobs.filter(j => j.productId === productId && j.kind === 'shot' && !j.renderer && j.approvedAt && j.output && j.duration >= 8);
  return <section className="ad-director" aria-labelledby="ad-director-title">
    <h3 id="ad-director-title">Creative ad director</h3>
    <p>Start with your customer’s problem. Signal researches it, proposes three creative approaches, and prepares a scene plus a real product demonstration.</p>
    <form onSubmit={event => { event.preventDefault(); void action({ type: 'ad-research', productId, value: { objective, audience, ratio } }); }}>
      <label>What should this ad accomplish?<textarea rows={2} minLength={15} maxLength={800} required value={objective} onChange={event => setObjective(event.target.value)} /></label>
      <div className="ad-director-controls"><label>Audience <span className="growth-muted">(optional; uses Brand &amp; offer)</span><input maxLength={400} value={audience} onChange={event => setAudience(event.target.value)} placeholder="Independent consultants preparing client reports" /></label>
      <label>Format<select value={ratio} onChange={event => setRatio(event.target.value as typeof ratio)}><option value="9:16">Portrait</option><option value="16:9">Landscape</option><option value="1:1">Square</option></select></label></div>
      <button className="btn btn-primary" disabled={busy || pending || view.offline}>{pending ? 'Research in progress' : 'Research ad concepts'}</button>
    </form>
    {plans.map(plan => <section className="ad-concept-set" key={plan.id}>
      <p role="status">{plan.detail}</p>
      {plan.result && <><p><strong>Suggested first test:</strong> {plan.result.concepts[plan.result.recommendedIndex]?.title}. {plan.result.reason}</p>
      <div className="ad-director-controls"><label>Approved starting reference<select value={characterId} onChange={event => setCharacter(event.target.value)}><option value="">Choose a reference</option>{characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Real product recording<select value={demoId} onChange={event => setDemo(event.target.value)}><option value="">Choose approved footage</option>{demos.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</select></label></div>
      {!characters.length && <p>Add and approve a starting image in Characters below. The image sets the person, wardrobe and scene for image-to-video.</p>}
      {!demos.length && <p>Follow the capture directions in your chosen concept, then import and approve an eight-second or longer screen recording below.</p>}
      <div className="ad-concepts">{plan.result.concepts.map((concept, index) => {
        const production = plan.productions.find(p => p.conceptIndex === index);
        const shot = production && view.jobs.find(j => j.id === production.shotId);
        return <article className="ad-concept" key={index}><h4>{concept.title}</h4><p className="ad-hook">{concept.hook}</p><p>{concept.buyerProblem}</p><p>{concept.insight}</p>
          <details><summary>Scene and product capture directions</summary><p><strong>Opening scene:</strong> {concept.scene}</p><p><strong>Record the actual product:</strong> {concept.productDemo}</p><p><strong>Narration:</strong> {concept.narration}</p><p><strong>End card:</strong> {concept.headline} · {concept.callToAction}</p></details>
          <details><summary>Research and test hypothesis</summary>{concept.evidence.map((e, i) => { const source = plan.sources.find(s => s.id === e.sourceId); return <div key={i}><blockquote>{e.quote}</blockquote><p>{source?.title} · {source ? new Date(source.observedAt).toLocaleDateString() : ''}</p>{source && <button className="btn" onClick={() => void window.signal.openExternal(source.url)}>Open research source</button>}</div>; })}<p>{concept.hypothesis}</p><p>{concept.measure}</p></details>
          <div className="growth-actions">{!production ? <button className="btn" disabled={busy || !characterId || view.offline || (view.config.renderer === 'local' && Boolean(view.localRenderHold))} onClick={() => void action({ type: 'ad-produce', productId, id: plan.id, index, characterId })}>{view.config.renderer === 'cloud' ? 'Render opening scene · paid' : 'Render opening scene'}</button> : <p>{shot?.detail ?? 'Opening scene is saved in the production queue.'}</p>}
          {production && !production.adId && <button className="btn" disabled={busy || !demoId || !shot?.approvedAt || !view.narrationReady} onClick={() => void action({ type: 'ad-assemble', productId, id: plan.id, index, productClipId: demoId })}>Assemble narrated ad</button>}
          {production?.adId && <p>Finished edit queued. Review it in Production queue below.</p>}</div>
        </article>;
      })}</div></>}
    </section>)}
  </section>;
}
