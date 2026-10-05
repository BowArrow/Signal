// Prepare saved Lemonade policies for the installed acquisition build. Never starts Run.
// Postal address is provided as one command argument, not embedded in source.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createApp } from '../src/core/app.js';
import { ConnectionService } from '../src/core/connections/service.js';
import { OperationsService } from '../src/core/operations/service.js';
import { SalesService } from '../src/core/sales/service.js';
import { OutreachService } from '../src/core/sales/outreach-service.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { products } from '../src/core/db/schema.js';
import { operationPolicySchema } from '../src/shared/operations.js';
import { outreachPolicySchema } from '../src/shared/outreach.js';

const require = createRequire(import.meta.url);
const builderRequire = createRequire(createRequire(require.resolve('electron-builder')).resolve('app-builder-lib'));
const { extractFile } = builderRequire('@electron/asar') as { extractFile: (archive: string, file: string) => Buffer };
const installed = JSON.parse(extractFile(join(process.env['LOCALAPPDATA']!, 'Programs', 'signal', 'resources', 'app.asar'), 'package.json').toString());
assert.equal(installed.version, '0.36.0', 'Install the validated acquisition build before configuring its new policy.');
const app = createApp({ databaseUrl: join(process.env['APPDATA']!, 'signal', 'signal.db'), logger: silentLogger });
try {
  app.connections = new ConnectionService(app, { available: () => false, get: () => undefined, set: () => { throw Error('This preparation never writes credentials'); }, delete: () => {} });
  app.operations = new OperationsService(app); app.sales = new SalesService(app); app.outreach = new OutreachService(app);
  const product = app.db.select().from(products).all().find(p => p.key === 'lemonade'); assert.ok(product);
  const state = app.operations.state(product.id), outreach = app.outreach.policy(product.id);
  assert.equal(state.running, false, 'Pause Lemonade first.'); assert.equal(state.taskId, null, 'Preserve active work.');
  assert.ok(state.mode !== 'acquisition', 'Already prepared; preserve subsequent settings.');
  assert.equal(outreach.enabled, false, 'Do not overwrite an enabled email policy.');
  assert.ok(!app.operations.deliveries().some(j => j.productId === product.id && ['queued', 'dispatching', 'retry', 'attention'].includes(j.status)), 'Resolve existing deliveries first.');
  const sources = app.sales.sources().filter(s => s.productId === product.id && s.senderEmail === 'sales@aionx.aionapp.org' && s.autoSync && s.aiTriage);
  assert.equal(sources.length, 1, 'Use the verified Lemonade business sender.');
  const policy = operationPolicySchema.parse({ ...Object.fromEntries(Object.keys(operationPolicySchema.shape).map(key => [key, state[key as keyof typeof state]])), mode: 'acquisition', ownedAudience: false });
  assert.ok(policy.discovery?.enabled, 'Public buyer research must be configured.');
  const email = outreachPolicySchema.parse({ enabled: true, accountId: sources[0]!.accountId, objective: 'Help the opted-in Lemonade prospect try one useful task with their own documents. Use their stated request when available, explain a small first step and how to check the source, then invite a question. Verify current trial terms and platform requirements. Do not invent familiarity, results or urgency.', mailingAddress: process.argv[2] ?? '', dailyLimit: 3, delayMinutes: 10, followUpDays: [] });
  const folder = join(process.env['APPDATA']!, 'signal', 'backups'); mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `before-acquisition-${Date.now()}.json`), JSON.stringify({ operation: state, outreach }, null, 2));
  app.db.transaction(() => { app.operations!.configure(product.id, policy); app.outreach!.configure(product.id, email); });
  // Drizzle transactions execute the callback directly; verify the persisted state.
  const after = app.operations.state(product.id), firstResponse = app.outreach.policy(product.id);
  assert.equal(after.mode, 'acquisition'); assert.equal(after.running, false); assert.equal(firstResponse.enabled, true);
  console.log(JSON.stringify({ prepared: true, business: product.name, mode: after.mode, running: after.running, initialResponsesEnabled: firstResponse.enabled, dailyEmailLimit: firstResponse.dailyLimit, followUps: firstResponse.followUpDays.length, sender: sources[0]!.senderEmail, addressSaved: Boolean(firstResponse.mailingAddress) }));
} finally { app.close(); }
