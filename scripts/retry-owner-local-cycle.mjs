// One-time recovery of the observed pre-delivery model failure, after installing
// its tested transport fix. No credentials, publication or policy changes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';

const receipt = JSON.parse(readFileSync('data/operations-validation/release-0.40.json', 'utf8').replace(/^\uFEFF/, ''));
assert.equal(receipt.installed, true);
assert.equal(createHash('sha256').update(readFileSync(join(process.env.LOCALAPPDATA, 'Programs/signal/resources/app.asar'))).digest('hex'), receipt.appAsarSha256);
const db = new Database(join(process.env.APPDATA, 'signal/signal.db'), { fileMustExist: true, nativeBinding: resolve('native/better_sqlite3-node.node') });
try {
  const result = db.transaction(() => {
    const productId = 'CzP0iRc7x8uUdmTdZE25h';
    const taskId = 'jdllo-FsXrXflTYJ557C_';
    const state = JSON.parse(db.prepare('SELECT value FROM settings WHERE key = ?').get('operations.policy.' + productId).value);
    assert.ok(state.running && state.authorizedAt && state.mode === 'acquisition' && state.revision === 6 && state.taskId === taskId);
    const task = db.prepare('SELECT * FROM growth_tasks WHERE id = ? AND product_id = ?').get(taskId, productId);
    assert.equal(task.status, 'failed');
    assert.equal(task.kind, 'marketing');
    assert.equal(task.error, 'Cannot reach the configured model provider. Check Settings and Goals & runtime, then retry this task.');
    const calls = db.prepare('SELECT name,status FROM marketing_tool_calls WHERE task_id = ?').all(taskId);
    assert.ok(calls.length > 0 && calls.every(call => call.name === 'product.inspect' && call.status === 'done'), 'Only the observed read-only inspection may have occurred');
    const deliveries = db.prepare("SELECT value FROM settings WHERE key LIKE 'operations.delivery.%'").all().map(row => JSON.parse(row.value));
    assert.ok(!deliveries.some(delivery => delivery.taskId === taskId), 'A delivery already exists; do not replay');
    const before = { id: task.id, status: task.status, error: task.error, updatedAt: task.updated_at };
    assert.equal(db.prepare("UPDATE growth_tasks SET status='queued',error=NULL,lease=NULL,updated_at=? WHERE id=? AND status='failed'").run(Date.now(), taskId).changes, 1);
    return { at: new Date().toISOString(), before, after: 'queued', policyRevision: state.revision, policyChanged: false, externalDeliveriesByHelper: 0 };
  }).immediate();
  writeFileSync('data/operations-validation/retry-0.40.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { db.close(); }
