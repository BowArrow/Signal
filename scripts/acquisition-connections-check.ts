// Diagnostic only: no workers, messages, campaigns, or publishing are started.
import { app } from 'electron';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../src/core/app.js';
import { ConnectionService } from '../src/core/connections/service.js';
import { AnalyticsService } from '../src/core/analytics/service.js';
import { AccountVault } from '../electron/main/connection-handlers.js';
import { silentLogger } from '../src/core/lib/logger.js';

const owner = join(process.env['APPDATA']!, 'signal');
const temporary = process.env['SIGNAL_ACQUISITION_CHECK_PROFILE'];
if (!temporary) throw new Error('Use acquisition-connections-check.mjs.');
app.disableHardwareAcceleration(); app.setPath('userData', temporary);
copyFileSync(join(owner, 'Local State'), join(temporary, 'Local State'));
void app.whenReady().then(async () => {
  const signal = createApp({ databaseUrl: join(owner, 'signal.db'), logger: silentLogger, migrate: false });
  const connections = new ConnectionService(signal, new AccountVault(join(owner, 'account-credentials')), async () => { throw new Error('Interactive authorization is outside this diagnostic.'); });
  signal.connections = connections;
  const analytics = new AnalyticsService(signal);
  const results: unknown[] = [];
  try {
    for (const account of connections.accounts().filter(a => ['bluesky', 'ga4'].includes(a.provider))) {
      try {
        await connections.verify(account.productId, account.id);
        if (account.provider === 'bluesky') {
          const findings = await connections.blueskyRequests(account.productId, account.id, '"local AI"', AbortSignal.timeout(60000));
          results.push({ accountId: account.id, productId: account.productId, provider: account.provider, ok: true, findings: findings.length });
        } else {
          const configured = analytics.states().find(s => s.productId === account.productId);
          if (!configured) throw new Error('This business has no configured Analytics property.');
          const response = await connections.analyticsRead(account.productId, { ...configured, accountId: account.id }, AbortSignal.timeout(60000));
          results.push({ accountId: account.id, productId: account.productId, provider: account.provider, ok: true, sessions: response.rows.reduce((n, r) => n + r.sessions, 0) });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        // Only locally authored HTTP status, never arbitrary provider messages.
        const status = /^Provider returned HTTP (\d{3})\./.exec(message)?.[1];
        results.push({ accountId: account.id, productId: account.productId, provider: account.provider, ok: false, httpStatus: status ?? null, detail: 'Connection or capability check failed; no sends attempted.' });
      }
    }
    mkdirSync('output/marketing-audit', { recursive: true });
    writeFileSync('output/marketing-audit/connections.json', JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
    console.log(JSON.stringify(results));
  } finally { signal.close(); app.quit(); }
}).catch(() => { console.error('Acquisition connection diagnostic failed.'); app.exit(1); });
