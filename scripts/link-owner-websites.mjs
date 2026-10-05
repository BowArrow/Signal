// Explicitly link the owner's existing website keys. No publishing or policy changes.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const checking = process.argv.includes('--check');
if (!checking && !process.argv.includes('--link')) throw new Error('Pass --check for read-only verification or --link to save the two website connections.');
const folder = mkdtempSync(join(tmpdir(), 'signal-link-websites-'));
const helper = join(folder, 'link.cjs');
writeFileSync(helper, `
const { app, safeStorage } = require('electron');
const fs = require('node:fs'); const { join } = require('node:path'); const { createHash, randomBytes } = require('node:crypto');
const Database = require(${JSON.stringify(require.resolve('better-sqlite3'))});
const profile = join(process.env.APPDATA, 'signal');
app.disableHardwareAcceleration(); app.setPath('userData', ${JSON.stringify(join(folder, 'profile'))});
fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.copyFileSync(join(profile, 'Local State'), join(app.getPath('userData'), 'Local State'));
app.whenReady().then(async () => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Encrypted storage unavailable');
  const db = new Database(join(profile, 'signal.db'), { readonly: ${checking}, fileMustExist: true, nativeBinding: ${JSON.stringify(resolve('native/better_sqlite3-electron.node'))} });
  db.pragma('busy_timeout = 5000');
  try {
    const config = JSON.parse(fs.readFileSync(join(profile, 'website-publishing.json'), 'utf8'));
    const results = [];
    for (const [key, origin, envKey] of [['lemonade', 'https://siplemona.de', 'SIGNAL_LEMONADE_PUBLISH_KEY'], ['cinegen', 'https://cinegenaimedia.com', 'SIGNAL_CINEGEN_PUBLISH_KEY']]) {
      const product = db.prepare('SELECT id, name FROM products WHERE key = ?').get(key);
      if (!product || typeof config[envKey] !== 'string' || !config[envKey]) throw new Error(key + ': existing website configuration missing');
      let token = config[envKey];
      if (${checking}) {
        const saved = db.prepare("SELECT value FROM settings WHERE key LIKE 'connections.account.%'").all().map(row => JSON.parse(row.value)).find(a => a.productId === product.id && a.provider === 'signal-blog');
        if (!saved || saved.site !== origin || saved.status !== 'verified') throw new Error(key + ': saved connection missing or unverified');
        const path = join(profile, 'account-credentials', createHash('sha256').update('account.' + saved.id).digest('hex') + '.enc');
        token = JSON.parse(safeStorage.decryptString(fs.readFileSync(path))).accessToken;
        if (typeof token !== 'string' || !token) throw new Error(key + ': saved credential unavailable');
      }
      const response = await fetch(origin + '/api/content/posts?slug=signal-connection-check', { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { authorization: 'Bearer ' + token } });
      const data = await response.json().catch(() => null);
      if (!(response.ok && data && !data.error) && !(response.status === 404 && data?.error === 'Post not found')) throw new Error(key + ': publishing credential check failed (HTTP ' + response.status + ')');
      if (${checking}) { results.push({ business: product.name, website: origin, status: 'verified' }); continue; }
      db.transaction(() => {
        const current = db.prepare("SELECT value FROM settings WHERE key LIKE 'connections.account.%'").all().map(row => JSON.parse(row.value)).find(a => a.productId === product.id && a.provider === 'signal-blog');
        const now = Date.now(); const id = current?.id || randomBytes(16).toString('base64url');
        const account = { ...(current || {}), id, productId: product.id, provider: 'signal-blog', label: current?.label || product.name + ' website', site: origin, username: '', identity: origin, status: 'verified', detail: 'Website publishing credential verified with a read-only content request.', checkedAt: now, expiresAt: null, refreshable: false, grantedScopes: current?.grantedScopes || [], createdAt: current?.createdAt || now };
        const credentialPath = join(profile, 'account-credentials', createHash('sha256').update('account.' + id).digest('hex') + '.enc');
        fs.mkdirSync(join(profile, 'account-credentials'), { recursive: true });
        const before = fs.existsSync(credentialPath) ? fs.readFileSync(credentialPath) : null;
        fs.writeFileSync(credentialPath + '.tmp', safeStorage.encryptString(JSON.stringify({ accessToken: token }))); fs.renameSync(credentialPath + '.tmp', credentialPath);
        try { db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run('connections.account.' + id, JSON.stringify(account), now); }
        catch (error) { if (before) fs.writeFileSync(credentialPath, before); else fs.unlinkSync(credentialPath); throw error; }
        results.push({ business: product.name, website: origin, status: 'verified' });
      }).immediate();
    }
    console.log(JSON.stringify({ linked: results, readOnly: ${checking}, published: false, operatingPoliciesChanged: false }));
  } finally { db.close(); }
}).then(() => app.exit(0)).catch(error => { console.error(error.message); app.exit(1); });
`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [helper, '--disable-gpu'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr); child.on('exit', code => { process.exitCode = code ?? 1; });
