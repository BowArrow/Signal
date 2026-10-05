// Apply the owner's requested channel tests after installing the verified 0.42
// package and quitting Signal. No service, model or delivery is started here.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { operationPolicySchema, hasPublishingPermission, DELIVERY_PROVIDERS } from '../src/shared/operations.ts';

const receipt = JSON.parse(readFileSync('data/operations-validation/release-0.42.json', 'utf8').replace(/^\uFEFF/, ''));
assert.equal(createHash('sha256').update(readFileSync(join(process.env.LOCALAPPDATA, 'Programs', 'signal', 'resources', 'app.asar'))).digest('hex'), receipt.appAsarSha256, 'Install the tested 0.42 package first.');
const processes = spawnSync('powershell.exe', ['-NoProfile', '-Command', '(Get-Process Signal -ErrorAction SilentlyContinue | Measure-Object).Count'], { windowsHide: true, encoding: 'utf8' });
assert.equal(processes.status, 0); assert.equal(processes.stdout.trim(), '0', 'Quit Signal before changing its operating policy.');
const db = new DatabaseSync(join(process.env.APPDATA, 'signal', 'signal.db'));
const now = Date.now();
try {
  db.exec('BEGIN IMMEDIATE');
  const product = db.prepare("SELECT id FROM products WHERE key='lemonade'").get(); assert.ok(product);
  const key = 'operations.policy.' + product.id;
  const before = JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get(key).value);
  assert.equal(before.mode, 'acquisition');
  const deliveries = db.prepare("SELECT value FROM settings WHERE key LIKE 'operations.delivery.%'").all().map(r => JSON.parse(r.value));
  assert.ok(!deliveries.some(d => d.productId === product.id && ['queued', 'dispatching', 'retry', 'attention'].includes(d.status)), 'Resolve pending deliveries before changing channel selection.');
  assert.equal(db.prepare("SELECT count(*) AS n FROM growth_tasks WHERE product_id=? AND kind='marketing' AND status IN ('queued','running')").get(product.id).n, 0, 'Wait for the current marketing task to finish.');
  const accounts = db.prepare("SELECT value FROM settings WHERE key LIKE 'connections.account.%'").all().map(r => JSON.parse(r.value)).filter(a => a.productId === product.id && DELIVERY_PROVIDERS.includes(a.provider) && a.status === 'verified' && hasPublishingPermission(a) && (!a.expiresAt || a.expiresAt > now || a.refreshable));
  assert.ok(accounts.length > 0 && accounts.length <= 10);
  const policy = operationPolicySchema.parse({ mode: before.mode, testChannels: true, ownedAudience: before.ownedAudience, replyToRequests: before.replyToRequests,
    objective: before.objective, accountIds: accounts.map(a => a.id), intervalHours: before.intervalHours, dailyLimit: before.dailyLimit,
    ...(before.discovery ? { discovery: before.discovery } : {}), ...(before.imageWorkflowId ? { imageWorkflowId: before.imageWorkflowId } : {}) });
  const next = { ...before, ...policy, revision: before.revision + 1, lastCycleAt: null, taskId: null, targetAccountId: null, authorizedAt: before.running ? now : null };
  delete next.learning; delete next.demandEvidence;
  writeFileSync('data/operations-validation/channel-tests-policy-before-0.42.json', JSON.stringify(before, null, 2));
  const put = db.prepare('UPDATE settings SET value=?, updated_at=? WHERE key=?');
  put.run(JSON.stringify(next), now, key);
  // Retain search history and declined findings across this distribution-only edit.
  for (const prefix of ['operations.discovery.', 'operations.acquisition.']) {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(prefix + product.id);
    if (row) { const value = JSON.parse(row.value); value.revision = next.revision; put.run(JSON.stringify(value), now, prefix + product.id); }
  }
  const result = { productId: product.id, revision: next.revision, testChannels: true, destinations: accounts.map(a => a.provider), dailyLimit: next.dailyLimit, runningPreserved: next.running === before.running, externalActions: 0 };
  db.exec('COMMIT');
  writeFileSync('data/operations-validation/owner-channel-tests-0.42.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
finally { db.close(); }
