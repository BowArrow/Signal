import { useEffect, useState } from 'react';
import type { SeoAction, SeoView } from '../../../../src/shared/seo.js';

export function SearchResearch({ productId, onToast }: { productId: string; onToast: (message: string, kind?: 'ok' | 'warn') => void }) {
  const [view, setView] = useState<SeoView | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [accountId, setAccountId] = useState(''), [siteUrl, setSiteUrl] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = () => { void window.signal.seo().then(next => { if (alive) { setView(next); setError(''); } }).catch(() => { if (alive) setError('Search research could not be loaded.'); }); };
    refresh(); const timer = setInterval(refresh, 10000); return () => { alive = false; clearInterval(timer); };
  }, []);
  const state = view?.states.find(s => s.productId === productId), snapshot = view?.snapshots.find(s => s.productId === productId);
  useEffect(() => { setAccountId(state?.accountId ?? ''); setSiteUrl(state?.siteUrl ?? ''); }, [productId, state?.accountId, state?.siteUrl]);
  const act = async (action: SeoAction) => { setBusy(true); try { const next = await window.signal.seoAction(action); setView(next); const detail = next.states.find(s => s.productId === productId); onToast(detail?.detail ?? 'Search source removed.', detail?.status === 'attention' ? 'warn' : 'ok'); } catch (e) { onToast(String(e), 'warn'); } finally { setBusy(false); } };
  const accounts = view?.accounts.filter(a => a.productId === productId) ?? [];
  const stale = snapshot && (state?.status !== 'current' || Date.now() - snapshot.observedAt > 48 * 3600000 || !accounts.some(a => a.id === snapshot.accountId && a.status === 'verified'));
  return <section className="card operation-explanation" aria-label="Search research"><h2>Search visibility &amp; content research</h2>
    <p>{state?.detail ?? 'Connect Google Search Console in Connections to see which queries bring your website into search results. GA4 measures visits after arrival; Search Console measures visibility before the click.'}</p>
    {error && <p role="alert">{error}</p>}
    <form className="operation-policy" onSubmit={e => { e.preventDefault(); void act({ type: 'configure', productId, value: { accountId, siteUrl } }); }}>
      <label>Search Console account<select required value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">Choose a connected account</option>{accounts.map(a => <option key={a.id} value={a.id} disabled={a.status !== 'verified'}>{a.label} · {a.status}</option>)}</select></label>
      <label>Verified website property<input required value={siteUrl} onChange={e => setSiteUrl(e.target.value)} placeholder="sc-domain:siplemona.de or https://siplemona.de/" /></label>
      <p>Copy the property from the Search Console account preview in Connections. Use the property covering this business website.</p>
      <div className="growth-actions"><button className="btn" disabled={busy || !accountId || !siteUrl}>Save search source</button><button className="btn" type="button" disabled={busy || !state || view?.offline} onClick={() => void act({ type: 'sync', productId })}>Sync search queries</button>{state && <button className="btn" type="button" disabled={busy} onClick={() => void act({ type: 'remove', productId })}>Remove search source</button>}</div>
    </form>
    {snapshot && <><p>{snapshot.startDate} through {snapshot.endDate} (Pacific time). Last read {new Date(snapshot.observedAt).toLocaleString()}.</p>{stale && <p role="status">This report is unavailable for current topic selection. Sync successfully before using it.</p>}
      <div className="revenue-table-wrap"><table className="revenue-table"><thead><tr><th>Search query</th><th>Page</th><th>Impressions</th><th>Clicks</th><th>Click rate</th><th>Average position</th></tr></thead><tbody>{[...snapshot.rows].sort((a, b) => b.impressions - a.impressions).slice(0, 100).map(row => <tr key={`${row.query}:${row.page}`}><td>{row.query}</td><td>{new URL(row.page).pathname}</td><td>{row.impressions}</td><td>{row.clicks}</td><td>{(row.ctr * 100).toFixed(1)}%</td><td>{row.position.toFixed(1)}</td></tr>)}</tbody></table></div>
      {!snapshot.rows.length && <p>No query rows returned. This does not establish whether the site is indexed.</p>}{snapshot.limitations.map(note => <p key={note}>{note}</p>)}<p>Showing up to 100 query/page rows.</p></>}
    <p>When marketing is running with buyer research and a website destination enabled, Signal checks search data daily and assesses relevant task queries for practical website guides. Queries are never treated as people to contact. Publication, indexing, traffic and paid conversions are separate outcomes.</p>
  </section>;
}
