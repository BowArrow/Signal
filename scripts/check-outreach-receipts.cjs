// Read-only Gmail inspection for attempted Signal mail. Never sends or changes a message.
const { app, safeStorage } = require('electron');
const { readFileSync, copyFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
app.disableHardwareAcceleration();
app.setPath('userData', process.env.SIGNAL_RECEIPT_PROFILE);
mkdirSync(app.getPath('userData'), { recursive: true });
copyFileSync(join(process.env.APPDATA, 'signal', 'Local State'), join(app.getPath('userData'), 'Local State'));
app.whenReady().then(async () => {
  const profile = join(process.env.APPDATA, 'signal');
  const db = new Database(join(profile, 'signal.db'), { readonly: true, nativeBinding: resolve('native/better_sqlite3-electron.node') });
  try {
    const rows = db.prepare('SELECT key,value FROM settings').all().map(r => ({ key: r.key, value: JSON.parse(r.value) }));
    const results = [];
    for (const { value: job } of rows.filter(r => r.key.startsWith('sales.outreach.') && r.value.attemptedAt && r.value.status !== 'sent')) {
      const account = rows.find(r => r.key === 'connections.account.' + job.accountId)?.value;
      if (account?.provider !== 'gmail') continue;
      const key = createHash('sha256').update('account.' + account.id).digest('hex') + '.enc';
      const saved = JSON.parse(safeStorage.decryptString(readFileSync(join(profile, 'account-credentials', key))));
      let token = saved.accessToken;
      if (account.expiresAt && account.expiresAt <= Date.now() + 60000) {
        const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: saved.refreshToken, client_id: saved.clientId, ...(saved.clientSecret ? { client_secret: saved.clientSecret } : {}) }) });
        if (!response.ok) throw Error('Google token refresh HTTP ' + response.status);
        token = (await response.json()).access_token;
      }
      const get = async path => {
        const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me' + path, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { authorization: 'Bearer ' + token } });
        if (!response.ok) throw Error('Gmail read HTTP ' + response.status);
        return response.json();
      };
      let id = job.acceptedId;
      if (!id) { const list = await get('/messages?' + new URLSearchParams({ q: 'in:sent rfc822msgid:' + job.internetId, maxResults: '2' })); if (list.nextPageToken || list.messages?.length > 1) throw Error('Ambiguous sent copies'); id = list.messages?.[0]?.id; }
      if (!id) { results.push({ jobId: job.id, found: false }); continue; }
      const raw = await get('/messages/' + encodeURIComponent(id) + '?format=full');
      const headers = raw.payload.headers;
      const h = name => headers.filter(h => h.name.toLowerCase() === name).map(h => h.value);
      const body = Buffer.from(raw.payload.body?.data ?? '', 'base64url').toString('utf8');
      const hash = text => createHash('sha256').update(text.replace(/\r\n/g, '\n').trim()).digest('hex');
      if (process.env.SIGNAL_RECONCILE_RECEIPTS === '1') {
        const { OutreachDelivery } = require(resolve('data/operations-validation/outreach-delivery-checked.cjs'));
        const readOnlyTransport = (url, options) => { if (options?.method && options.method !== 'GET') throw Error('This helper cannot send messages'); return fetch(url, options); };
        const verified = await new OutreachDelivery('gmail', token, readOnlyTransport, AbortSignal.timeout(30000), () => {}).reconcile(job);
        if (!verified) throw Error('No verified receipt');
        const backupDir = join(profile, 'backups', 'before-receipt-' + Date.now()); mkdirSync(backupDir, { recursive: true });
        await db.backup(join(backupDir, 'signal.db'));
        const writer = new Database(join(profile, 'signal.db'), { nativeBinding: resolve('native/better_sqlite3-electron.node') });
        try {
          writer.transaction(() => {
            const key = 'sales.outreach.' + job.id;
            const current = JSON.parse(writer.prepare('SELECT value FROM settings WHERE key=?').get(key).value);
            if (current.updatedAt !== job.updatedAt || current.bodyHash !== job.bodyHash || !['attention','dispatching'].includes(current.status)) throw Error('Outreach changed; inspect again');
            const now = Date.now();
            writer.prepare('UPDATE settings SET value=?,updated_at=? WHERE key=?').run(JSON.stringify({ ...current, status: 'sent', providerInternetId: verified.internetId, acceptedId: verified.id, threadId: verified.threadId, sentAt: current.sentAt ?? Number(raw.internalDate), checkedAt: now, updatedAt: now, detail: 'The matching Gmail sent copy was confirmed. Replies enter Sales; delivery, reading and sales are unverified.' }), now, key);
            const lead = writer.prepare('SELECT product_id,value FROM studio_leads WHERE id=?').get(job.leadId);
            if (lead?.product_id === job.productId) { const value = JSON.parse(lead.value); if (value.contact.toLowerCase() === job.to && ['discovered','qualified','trial'].includes(value.stage)) writer.prepare('UPDATE studio_leads SET value=? WHERE id=?').run(JSON.stringify({ ...value, stage: 'contacted' }), job.leadId); }
          })();
        } finally { writer.close(); }
      }
      results.push({ jobId: job.id, found: true, sent: raw.labelIds?.includes('SENT'), providerId: raw.id, threadId: raw.threadId, from: h('from'), expectedFrom: job.from, toMatches: h('to')[0] === job.to, messageIdMatches: h('message-id')[0] === job.internetId, signalIdMatches: h('x-signal-outreach-id')[0] === job.id, subject: h('subject'), expectedSubject: job.subject, bodyHashMatches: hash(body) === job.bodyHash, mimeType: raw.payload.mimeType, partCount: raw.payload.parts?.length ?? 0, extraHeaders: ['cc','bcc','reply-to','in-reply-to','references'].filter(name => h(name).length), replyToMatchesSender: h('reply-to')[0] === job.from });
    }
    const result = { providerReadsOnly: true, localReceiptsUpdated: process.env.SIGNAL_RECONCILE_RECEIPTS === '1', results };
    writeFileSync('data/operations-validation/outreach-receipt-audit.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { db.close(); }
}).then(() => app.exit(0)).catch(error => { console.error(error.message); app.exit(1); });
