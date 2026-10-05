import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { studioAction, studioView } from '../src/core/studio/store.js';
import { GrowthEngine } from '../src/core/growth/engine.js';
import { ScriptedLlmClient } from '../src/core/llm/client.js';
const app = createApp({ databaseUrl: process.argv[2]!, logger: silentLogger });
try {
  const p = studioView(app).products[0]!;
  studioAction(app, { type: 'campaign', productId: p.id, value: { title: 'A useful first-customer demonstration', channel: 'content', objective: 'Help a founder try a concrete local workflow.', audience: p.brand.audience, offer: p.brand.offer, formats: ['social'] } });
  const c = studioView(app).campaigns[0]!; studioAction(app, { type: 'generate', productId: p.id, id: c.id });
  await new GrowthEngine(app, new ScriptedLlmClient([JSON.stringify({ title: 'Try one useful workflow', body: 'I build Lemonade. Before choosing an AI tool, test it on a task you already understand. Save the result and note where you had to intervene. That tells you much more than a generic benchmark. We are looking for founders willing to share which repetitive task they want help with.', rationale: 'A specific invitation to learn from real workflows.', evidence: ['Synthetic UI fixture; not a live campaign'], reviewNotes: ['Verify product facts and the final destination before distribution.'] })])).runNext(['studio']);
} finally { app.close(); }
