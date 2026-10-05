// Update the paused Lemonade policy after installing 0.37. Never starts Run.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { ConnectionService } from '../src/core/connections/service.js';
import { OperationsService } from '../src/core/operations/service.js';
import { products } from '../src/core/db/schema.js';
import { operationPolicySchema } from '../src/shared/operations.js';

const require = createRequire(import.meta.url);
const builderRequire = createRequire(createRequire(require.resolve('electron-builder')).resolve('app-builder-lib'));
const { extractFile } = builderRequire('@electron/asar') as { extractFile: (archive: string, file: string) => Buffer };
const installed = JSON.parse(extractFile(join(process.env['LOCALAPPDATA']!, 'Programs', 'signal', 'resources', 'app.asar'), 'package.json').toString());
assert.ok(['0.37.0', '0.38.0'].includes(installed.version), 'Install a verified request-reply build first.');
const app = createApp({ databaseUrl: join(process.env['APPDATA']!, 'signal', 'signal.db'), logger: silentLogger });
try {
  app.connections = new ConnectionService(app, { available: () => false, get: () => undefined, set: () => { throw Error('No credential writes'); }, delete: () => {} });
  app.operations = new OperationsService(app);
  const product = app.db.select().from(products).all().find(p => p.key === 'lemonade'); assert.ok(product);
  const state = app.operations.state(product.id);
  assert.equal(state.running, false, 'Preserve an active operation.'); assert.equal(state.taskId, null, 'Preserve active work.');
  assert.equal(state.mode, 'acquisition'); assert.ok(!state.replyToRequests, 'Preserve subsequent owner edits.');
  assert.ok(state.accountIds.some(id => app.connections!.accounts().some(a => a.id === id && a.provider === 'bluesky' && a.status === 'verified')));
  assert.ok(!app.operations.deliveries().some(j => j.productId === product.id && ['queued', 'dispatching', 'retry', 'attention'].includes(j.status)), 'Resolve existing deliveries first.');
  const queries = [{ kind: 'bluesky' as const, query: 'documents' }, { kind: 'bluesky' as const, query: 'PDF' }, { kind: 'bluesky' as const, query: 'offline AI' }, { kind: 'bluesky' as const, query: 'summarize' }, ...(state.discovery?.queries.filter(q => q.kind !== 'bluesky') ?? [])].slice(0, 8);
  const policy = operationPolicySchema.parse({ ...Object.fromEntries(Object.keys(operationPolicySchema.shape).map(key => [key, state[key as keyof typeof state]])), replyToRequests: true, intervalHours: 1, discovery: { enabled: true, queries } });
  const folder = join(process.env['APPDATA']!, 'signal', 'backups'); mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `before-request-replies-${Date.now()}.json`), JSON.stringify(state, null, 2));
  app.operations.configure(product.id, policy);
  const after = app.operations.state(product.id);
  assert.equal(after.running, false); assert.equal(after.replyToRequests, true); assert.equal(after.dailyLimit, state.dailyLimit);
  console.log(JSON.stringify({ business: product.name, running: after.running, replyToRequests: after.replyToRequests, intervalHours: after.intervalHours, dailyLimit: after.dailyLimit, searches: after.discovery?.queries.length, fundsAuthorized: false }));
} finally { app.close(); }
