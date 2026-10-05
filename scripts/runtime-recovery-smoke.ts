import assert from 'node:assert/strict';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { ConnectionService, type CredentialVault } from '../src/core/connections/service.js';
import { OperationsService } from '../src/core/operations/service.js';
import { LocalRuntime } from '../src/core/runtime/manager.js';
import { RuntimeSupervisor, pauseAllOperations } from '../src/core/runtime/continuity.js';
import { runtimeSettings, saveRuntimeSettings } from '../src/core/runtime/settings.js';

// Runtime-only validation. No installed profile, account credentials, agent
// tasks or real publishing transport are used. Stop only a server owned here.
const app = createApp({ databaseUrl: ':memory:', logger: silentLogger }); const runtime = new LocalRuntime(app); const supervisor = new RuntimeSupervisor(app, runtime); app.runtimeSupervisor = supervisor;
try {
  saveRuntimeSettings(app, { ...runtimeSettings(app), provider: 'local' });
  const values = new Map<string, string>(); const vault: CredentialVault = { available: () => true, get: key => values.get(key), set: (key, value) => { values.set(key, value); }, delete: key => { values.delete(key); } };
  const connection = new ConnectionService(app, vault, undefined, async (_url, init) => { assert.equal(init?.method ?? 'GET', 'GET'); return Response.json({ error: 'Post not found' }, { status: 404 }); }); app.connections = connection; app.operations = new OperationsService(app);
  for (const product of connection.view().products) { await connection.connect({ productId: product.id, provider: 'signal-blog', label: 'Runtime-only fixture', credential: 'synthetic-key' }); const account = connection.accounts().find(a => a.productId === product.id)!; app.operations.configure(product.id, { accountIds: [account.id], objective: 'Runtime-only validation; do not generate or publish.', dailyLimit: 1, intervalHours: 24 }); app.operations.run(product.id); }
  const initial = await runtime.status(); await supervisor.tick(); console.log(JSON.stringify({ stage: 'ready', initiallyRunning: initial.ok, health: supervisor.view(), managed: (await runtime.status()).managed })); assert.equal(supervisor.view().status, 'ready');
  let recoveryVerified = false;
  if ((await runtime.status()).managed) {
    runtime.stop(); let stopped = false;
    for (let i = 0; i < 10; i++) { if (!(await runtime.status()).ok) { stopped = true; break; } await new Promise(resolve => setTimeout(resolve, 500)); }
    assert(stopped, 'The runtime owned by this check did not stop.'); supervisor.recheck(); await supervisor.tick(); assert.equal(supervisor.view().status, 'ready'); assert((await runtime.status()).managed); recoveryVerified = true;
  }
  pauseAllOperations(app); supervisor.hold(); await supervisor.tick(); assert.equal(supervisor.view().status, 'stopped');
  console.log(JSON.stringify({ ok: true, recoveryVerified, externalServerPreserved: initial.ok, businesses: connection.view().products.length, realPublications: 0, realEmails: 0 }));
} finally { await supervisor.stop(); app.close(); }
