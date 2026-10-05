// Read-only owner-profile check. Prints sender addresses/status only; never credentials.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const folder = mkdtempSync(join(tmpdir(), 'signal-gmail-senders-'));
const helper = join(folder, 'check.cjs');
writeFileSync(helper, `
const { app, safeStorage } = require('electron');
const { readFileSync, copyFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const Database = require(${JSON.stringify(require.resolve('better-sqlite3'))});
app.disableHardwareAcceleration();
app.setPath('userData', ${JSON.stringify(join(folder, 'profile'))});
mkdirSync(app.getPath('userData'), { recursive: true });
copyFileSync(join(process.env.APPDATA, 'signal', 'Local State'), join(app.getPath('userData'), 'Local State'));
app.whenReady().then(async () => {
  const profile = join(process.env.APPDATA, 'signal');
  const db = new Database(join(profile, 'signal.db'), { readonly: true, fileMustExist: true, nativeBinding: ${JSON.stringify(resolve('native/better_sqlite3-electron.node'))} });
  try {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Encrypted storage unavailable');
    const accounts = db.prepare("SELECT value FROM settings WHERE key LIKE 'connections.account.%'").all().map(row => JSON.parse(row.value)).filter(a => a.provider === 'gmail');
    const seen = new Set(); const results = [];
    for (const account of accounts) {
      if (seen.has(account.identity)) continue; seen.add(account.identity);
      const key = createHash('sha256').update('account.' + account.id).digest('hex') + '.enc';
      const saved = JSON.parse(safeStorage.decryptString(readFileSync(join(profile, 'account-credentials', key))));
      let token = saved.accessToken;
      if (account.expiresAt && account.expiresAt <= Date.now() + 60000) {
        if (!saved.refreshToken || !saved.clientId) throw new Error('Reconnect Gmail to refresh access');
        const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: saved.refreshToken, client_id: saved.clientId, ...(saved.clientSecret ? { client_secret: saved.clientSecret } : {}) }) });
        if (!response.ok) throw new Error('Google refresh HTTP ' + response.status);
        const next = await response.json(); if (typeof next.access_token !== 'string') throw new Error('No renewed token'); token = next.access_token;
      }
      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs', { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { authorization: 'Bearer ' + token } });
      if (!response.ok) throw new Error('Gmail sender list HTTP ' + response.status);
      const data = await response.json();
      if (!Array.isArray(data.sendAs)) throw new Error('Invalid sender list');
      results.push({ account: account.identity, senders: data.sendAs.map(row => ({ email: row.sendAsEmail, primary: row.isPrimary === true, verified: row.verificationStatus === 'accepted' })), sendingPermission: account.grantedScopes.includes('https://www.googleapis.com/auth/gmail.send') });
    }
    console.log(JSON.stringify({ readOnly: true, profileUnchanged: true, results }));
  } finally { db.close(); }
}).then(() => app.exit(0)).catch(error => { console.error(error.message); app.exit(1); });
`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [helper, '--disable-gpu'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
child.on('exit', code => { process.exitCode = code ?? 1; });
