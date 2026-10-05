import { useState } from 'react';
import type { ProspectView } from '../../../../src/shared/prospects.js';

export function WebsiteProspectSource({ productId, business, view, changed }: { productId: string; business: string; view: ProspectView; changed: (view: ProspectView) => void }) {
  const source = view.sources.find(s => s.productId === productId && s.provider === 'signal-blog');
  const [accountId, setAccountId] = useState(source?.accountId ?? '');
  const [enabled, setEnabled] = useState(source?.enabled ?? false), [confirmed, setConfirmed] = useState(source?.businessConfirmed ?? false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const accounts = view.accounts.filter(a => a.productId === productId && a.provider === 'signal-blog');
  const site = accounts.find(a => a.id === accountId)?.site;
  async function save(enable: boolean) {
    setBusy(true); setError('');
    try { changed(await window.signal.prospectAction({ type: 'configure', productId, value: { provider: 'signal-blog', accountId, listId: 'website', marketingPermissionId: '', enabled: enable, businessConfirmed: confirmed } })); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <form className="card operation-policy website-prospect-policy" onSubmit={e => { e.preventDefault(); void save(enabled); }}>
    <h3>Website requests</h3><p>Import verified email requests from {business} alongside Mailchimp. Your website needs Signal's signup page and prospect API deployed. Connecting the website alone does not create the signup flow.</p>
    {error && <p role="alert">{error}</p>}
    <label>Website connection<select aria-label="Website prospect connection" required disabled={busy} value={accountId} onChange={e => { setAccountId(e.target.value); setConfirmed(false); }}><option value="">Choose this business's website</option>{accounts.map(a => <option key={a.id} value={a.id} disabled={a.status !== 'verified'}>{a.label} · {a.status}</option>)}</select></label>
    {site && <button className="btn" type="button" onClick={() => void window.signal.openExternal(site + '/get-started')}>Open website signup page</button>}
    <label className="sales-check"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />This website collects email requests for {business}, and Signal may read those contact and consent records.</label>
    <label className="sales-check"><input type="checkbox" disabled={busy} checked={enabled} onChange={e => setEnabled(e.target.checked)} />Import website requests while Operations runs</label>
    <p>Saving pauses Operations. Signal checks for new requests every five minutes, preserves opt-outs and rechecks the website before emailing a linked contact. Existing lead records keep their stage and permission.</p>
    {source && <div><p>{source.audienceName} · {source.status}</p><p>{source.detail}</p><p>Last scan: {source.scanned} changes, {source.added} new contacts, {source.suppressed} opt-outs. Last complete: {source.lastCompleteAt ? new Date(source.lastCompleteAt).toLocaleString() : 'Not yet'}.</p></div>}
    <button className="btn" disabled={busy || !accountId || (enabled && (view.offline || !confirmed))}>Save website source</button>
    {source?.enabled && <><button className="btn" type="button" disabled={busy || view.offline} onClick={async () => { setBusy(true); setError(''); try { changed(await window.signal.prospectAction({ type: 'sync', productId, provider: 'signal-blog' })); } catch (e) { setError(String(e)); } finally { setBusy(false); } }}>Sync website requests</button><button className="btn" type="button" disabled={busy} onClick={() => void save(false)}>Disable website source</button></>}
  </form>;
}
