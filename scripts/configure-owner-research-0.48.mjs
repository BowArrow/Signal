// Run only after the verified 0.48 package is installed and Signal is closed.
// Enables research and imports real reviewed draft artifacts. No send service runs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { URL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const parse = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const receipt = parse('data/operations-validation/release-0.48.json');
const digest = text => createHash('sha256').update(text).digest('hex');
assert.equal(digest(readFileSync(join(process.env.LOCALAPPDATA, 'Programs/signal/resources/app.asar'))), receipt.appAsarSha256, 'Install the tested 0.48 package first.');
const processes = spawnSync('powershell.exe', ['-NoProfile', '-Command', '(Get-Process Signal -ErrorAction SilentlyContinue | Measure-Object).Count'], { windowsHide: true, encoding: 'utf8' });
assert.equal(processes.status, 0); assert.equal(processes.stdout.trim(), '0', 'Quit Signal before configuring research.');
const db = new DatabaseSync(join(process.env.APPDATA, 'signal/signal.db'));
const now = Date.now();
try {
  db.exec('BEGIN IMMEDIATE');
  const product = db.prepare("SELECT id FROM products WHERE key='lemonade'").get(); assert.ok(product);
  const get = key => { const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? JSON.parse(row.value) : undefined; };
  const put = (key, value) => db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(key, JSON.stringify(value), now);
  const key = 'sales.prospect-research.' + product.id;
  const before = get(key);
  const defaults = { productId: product.id, audience: 'Small US consultancies and independent professionals preparing proposals, comparing reports and drafting from source documents. A plausible workflow fit is not evidence of buying intent.', queries: ['independent grant writing consultant United States contact reports', 'small research consulting firm United States proposals contact', 'small business document productivity blog contribute', 'site:reddit.com/r/ document software recommendations'], dailyDraftLimit: 3, lastAttemptAt: null, nextAt: 0, pending: [], queryIndex: 2 };
  const imported = [];
  for (const artifactPath of ['data/prospect-live-validation/reviewed-business-draft.json', 'data/prospect-live-validation/results.json'].filter(existsSync)) {
    const artifact = parse(artifactPath);
    assert.equal(artifact.mode, 'real public pages and configured CPU model; isolated database; no sending services');
    for (const original of artifact.drafts) {
      if (!['draft', 'suggestion', 'no-contact'].includes(original.status) || now - original.observedAt > 86400000 || !original.body || !original.prospectQuote || !original.productQuote) continue;
      const url = new URL(original.url); assert.equal(url.protocol, 'https:'); assert.ok(!url.hostname.endsWith('example.org'));
      const id = digest(product.id + ':' + (original.kind === 'community' ? url.href : url.hostname.replace(/^www\./, '')));
      if (get('sales.prospect-draft.' + id)) continue;
      const leads = db.prepare('SELECT value FROM studio_leads WHERE product_id=?').all(product.id).map(r => JSON.parse(r.value));
      if (original.contact && leads.some(l => l.contact?.toLowerCase() === original.contact.toLowerCase())) continue;
      const draft = { ...original, id, productId: product.id, leadId: original.kind === 'community' ? null : id };
      if (draft.leadId) db.prepare('INSERT INTO studio_leads(id,product_id,value,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING').run(id, product.id, JSON.stringify({ name: draft.name, contact: draft.contact, permission: 'unknown', stage: 'discovered', source: draft.url, notes: draft.fit + '\nEvidence: ' + draft.prospectQuote + '\nCold research; no opt-in or buying intent established.', followUpAt: null, campaignId: '' }), draft.createdAt);
      put('sales.prospect-draft.' + id, draft); imported.push({ name: draft.name, kind: draft.kind, status: draft.status });
    }
  }
  put(key, { ...defaults, ...before, enabled: true, requested: false, status: 'ready', nextAt: 0, detail: imported.length ? 'Live-researched proposals are ready in Drafts & suggestions. Automatic research continues while Lemonade runs.' : 'Automatic business, blog and community research is enabled while Lemonade runs. Proposals will appear in Drafts & suggestions.' });
  db.exec('COMMIT');
  const result = { version: '0.48.0', productId: product.id, researchEnabled: true, imported, changedSendingLimits: false, queuedEmails: 0, externalActions: 0 };
  writeFileSync('data/operations-validation/owner-research-0.48.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
finally { db.close(); }
