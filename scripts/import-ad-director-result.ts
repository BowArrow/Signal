import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/core/app.js';
import { settings, growthTasks } from '../src/core/db/schema.js';
import { dashboard, queueTask } from '../src/core/growth/store.js';
import { requireProduct } from '../src/core/marketing/store.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { adConceptsSchema, type AdDirectorPlan } from '../src/shared/ad-director.js';

// Import only a completed live validation as editable planning, never approvals or jobs.
const processCheck = spawnSync('powershell.exe', ['-NoProfile', '-Command', '(Get-Process Signal -ErrorAction SilentlyContinue | Measure-Object).Count'], { windowsHide: true, encoding: 'utf8' });
assert.equal(processCheck.status, 0); assert.equal(processCheck.stdout.trim(), '0', 'Close Signal before importing the prepared concepts.');
const bytes = readFileSync(process.argv[2]!);
const artifact = JSON.parse(bytes.toString('utf8')) as { mode: string; plan: AdDirectorPlan };
assert.equal(artifact.mode, 'live public research and CPU model; isolated profile; no publishing or sending');
assert.equal(artifact.plan.status, 'ready');
const result = adConceptsSchema.parse(artifact.plan.result);
assert.equal(artifact.plan.productions.length, 0);
assert.ok(Date.now() - artifact.plan.updatedAt < 86400000);
for (const concept of result.concepts) {
  assert.ok(concept.evidence.some(e => artifact.plan.sources.find(s => s.id === e.sourceId)?.kind === 'audience'));
  for (const evidence of concept.evidence) assert.ok(artifact.plan.sources.find(s => s.id === evidence.sourceId)?.body.includes(evidence.quote));
}
const app = createApp({ databaseUrl: join(process.env.APPDATA!, 'signal/signal.db'), logger: silentLogger, migrate: false });
try {
  const product = dashboard(app).products.find(p => p.name === 'Lemonade')!;
  const origin = new URL(requireProduct(app, product.id).utmBase).origin;
  assert.ok(artifact.plan.sources.some(s => s.kind === 'product' && new URL(s.url).origin === origin));
  const hash = createHash('sha256').update(bytes).digest('hex');
  const id = 'reviewed-research-' + hash.slice(0, 24), key = 'video.ad-director.' + id;
  if (!app.db.select().from(settings).where(eq(settings.key, key)).get()) app.db.transaction(() => {
    const taskId = queueTask(app, product.id, 'ad-concepts', id)!;
    const plan: AdDirectorPlan = { ...artifact.plan, id, productId: product.id, taskId, result, productions: [], updatedAt: app.clock.now() };
    app.db.insert(settings).values({ key, value: plan, updatedAt: app.clock.now() }).run();
    app.db.update(growthTasks).set({ status: 'done', promptVersion: 'ad-director.v1', output: { planId: id, concepts: result.concepts.length, liveResearchArtifactSha256: hash }, updatedAt: app.clock.now() }).where(eq(growthTasks.id, taskId)).run();
  });
  console.log(JSON.stringify({ saved: true, product: product.name, concepts: result.concepts.length, approvals: 0, renderJobs: 0, publications: 0 }));
} finally { app.close(); }
