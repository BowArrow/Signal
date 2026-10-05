import { useState } from 'react';
import { LEAD_IMPORT_MAX_CHARS, type LeadImportPreview } from '../../../../src/shared/lead-import.js';

const template = 'name,email,source,permission,consent,notes\n';
export function LeadImport({ productId, business, onImported }: { productId: string; business: string; onImported: () => Promise<void> }) {
  const [csv, setCsv] = useState(''); const [preview, setPreview] = useState<LeadImportPreview | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const change = (text: string) => { setCsv(text); setPreview(null); setError(''); };
  async function inspect(commit = false) {
    setBusy(true); setError('');
    try { const result = await window.signal.leadImport({ productId, csv, ...(commit && preview ? { previewId: preview.previewId } : {}) }); setPreview(result); if (result.committed) await onImported(); }
    catch (e) { setError(String(e)); setPreview(null); }
    finally { setBusy(false); }
  }
  async function load(file: File | undefined) {
    if (!file) return;
    setBusy(true); setPreview(null); setError(''); setCsv('');
    try { if (file.size > LEAD_IMPORT_MAX_CHARS) throw new Error('Choose a UTF-8 CSV no larger than 1 MB.'); const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); change(text); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  return <details className="card operation-explanation lead-import"><summary>Import prospects for {business}</summary>
    <p>Bring in contacts from signup forms or CRM exports. Preview up to 500 contacts before saving them to this business’s pipeline. Existing leads keep their current information.</p>
    <p>Required columns: <code>email,source</code>. Optional: <code>name,permission,consent,notes</code>. Permission defaults to <code>unknown</code>. Use <code>opted-in</code> only with a consent record describing where and when the person agreed to marketing from {business}. Use <code>do-not-contact</code> to record an opt-out.</p>
    <label>Choose a UTF-8 CSV<input aria-label="Prospect CSV file" type="file" accept=".csv,text/csv" disabled={busy} onChange={e => void load(e.target.files?.[0])} /></label>
    <label>Or paste CSV<textarea aria-label="Prospect CSV" rows={6} maxLength={LEAD_IMPORT_MAX_CHARS} value={csv} disabled={busy} placeholder={template} onChange={e => change(e.target.value)} /></label>
    <p className="growth-muted">Imports stay in this local profile. If you later run outreach with GPT, relevant lead details go to your configured OpenAI account. Importing pauses this business’s operation; review the results, then use Run to resume.</p>
    <button className="btn" disabled={busy || !csv.trim()} onClick={() => void inspect()}>Preview prospects</button>
    {error && <p role="alert">{error}</p>}
    {preview && <div className="lead-import-preview"><h3>{preview.committed ? 'Import complete — operation paused' : 'Import preview'}</h3>
      <p role="status">{preview.counts.added} new prospects · {preview.counts.customers} matched customers · {preview.counts.existing} existing contacts unchanged · {preview.counts.suppressed} suppressed contacts skipped · {preview.counts.optOuts} opt-outs</p>
      <p>Unknown permission prevents automatic initial outreach. An imported opt-in record is your supplied evidence; Signal does not verify it with the person.</p>
      <details><summary>Review all {preview.rows.length} contacts</summary>{preview.rows.map(row => <article className="lead-import-row" key={row.row}><strong>{row.contact.name}</strong><p>{row.contact.email} · {row.contact.permission} · {row.status}</p><p>{row.detail}</p><p>Source: {row.contact.source}</p>{row.contact.consent && <p>Consent: {row.contact.consent}</p>}{row.contact.notes && <p>{row.contact.notes}</p>}</article>)}</details>
      {!preview.committed && <button className="btn" disabled={busy} onClick={() => void inspect(true)}>Import into {business}</button>}
    </div>}
  </details>;
}
