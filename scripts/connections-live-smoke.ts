import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../src/core/app.js';
import { __setConfigForTests } from '../src/core/config/load.js';
import { ConnectionService, type CredentialVault } from '../src/core/connections/service.js';
import { silentLogger } from '../src/core/lib/logger.js';

// Read-only verification, isolated in-memory metadata and credentials. Never
// print config values, provider bodies, or write the installed account profile.
const path = join(process.env['APPDATA'] ?? '', 'Signal', 'website-publishing.json');
if (!existsSync(path)) throw new Error('No installed website configuration found.');
const configuration = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
for (const product of ['LEMONADE', 'CINEGEN']) { const key = `SIGNAL_${product}_PUBLISH_KEY`; if (typeof configuration[key] === 'string') process.env[key] = configuration[key]; }
process.env['SIGNAL_OFFLINE'] = '0'; __setConfigForTests(null);
const app = createApp({ databaseUrl: ':memory:', logger: silentLogger });
const data = new Map<string, string>(); const vault: CredentialVault = { available: () => true, get: key => data.get(key), set: (key, value) => { data.set(key, value); }, delete: key => { data.delete(key); } };
try {
  const service = new ConnectionService(app, vault); const view = service.view();
  for (const productId of view.configuredWebsites) await service.importWebsite(productId);
  const results = service.accounts().map(account => ({ provider: account.provider, label: account.label, status: account.status }));
  console.log(JSON.stringify({ readOnly: true, isolated: true, results }));
  if (results.length !== 2 || results.some(result => result.status !== 'verified')) process.exitCode = 1;
} finally { data.clear(); app.close(); }
