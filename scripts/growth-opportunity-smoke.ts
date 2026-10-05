import { mkdirSync } from 'node:fs';
import { createApp } from '../src/core/app.js';
import { GrowthEngine } from '../src/core/growth/engine.js';
import { dashboard, queueTask } from '../src/core/growth/store.js';
import { opportunities, drafts } from '../src/core/db/schema.js';
import {
  insertCommunity,
  insertOpportunity,
  insertRule,
  insertSource,
} from '../tests/helpers/db.js';
const now = Date.now();
mkdirSync('data/growth-validation', { recursive: true });
const app = createApp({
  databaseUrl: `data/growth-validation/opportunity-${now}.db`,
});
const engine = new GrowthEngine(app);
try {
  const product = dashboard(app).products[0]!;
  const source = insertSource(app.dbHandle);
  const community = insertCommunity(app.dbHandle);
  insertRule(app.dbHandle, community.id, {
    fetchedAt: now,
    lastReviewedAt: now,
  });
  insertOpportunity(app.dbHandle, source.id, {
    communityId: community.id,
    title:
      'How can I use a local AI desktop assistant without sending company documents to the cloud?',
    body: 'I already have Ollama installed and running on a Windows desktop. My employer blocks cloud AI. I want a local assistant that does not require an account or subscription and can work with the network disconnected. How can I verify that a local tool is actually offline? I can pay a modest one-time price.',
    postedAt: now,
    discoveredAt: now,
  });
  for (let i = 0; i < 2; i++) {
    queueTask(app, product.id, 'opportunities', product.id);
    await engine.runNext();
  }
  const state = dashboard(app).products[0]!;
  const rows = app.db.select().from(opportunities).all();
  const replies = app.db.select().from(drafts).all();
  console.log(
    JSON.stringify(
      {
        tasks: state.tasks.map((t) => ({
          status: t.status,
          error: t.error,
          output: t.output,
        })),
        scores: rows.map((o) => ({ score: o.scoreTotal, status: o.status })),
        drafts: replies.map((d) => ({
          status: d.status,
          blocked: d.blocked,
          validators: d.validatorResults,
        })),
      },
      null,
      2,
    ),
  );
  if (
    state.tasks.some((t) => t.status !== 'done') ||
    !rows.some((o) => o.scoreTotal !== null) ||
    !replies.some((d) => !d.blocked)
  )
    throw new Error(
      'Local opportunity workflow did not produce a validated reply',
    );
} finally {
  await engine.stop();
  app.close();
}
