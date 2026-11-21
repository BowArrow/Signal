import { afterEach, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { marketingAction } from '../../src/core/marketing/actions.js';
import { executeMarketingTool } from '../../src/core/marketing/agent.js';
import { marketingView } from '../../src/core/marketing/store.js';
import { settings } from '../../src/core/db/schema.js';
import { marketingGuide } from '../../src/shared/marketing-guide.js';
import type { OperationsView } from '../../src/shared/operations.js';
import { GrowthEngine } from '../../src/core/growth/engine.js';
import { ScriptedLlmClient } from '../../src/core/llm/client.js';

const now = 1800000000000;
let app: App;
beforeEach(() => { app = createApp({ databaseUrl: ':memory:', clock: fixedClock(now), logger: silentLogger }); });
afterEach(() => app.close());
function operations(): OperationsView {
  return { products: marketingView(app).products, accounts: [], deliveries: [], tasks: [], offline: false,
    states: marketingView(app).products.map(p => ({ productId: p.id, objective: 'Help people try the product.', accountIds: ['account'], intervalHours: 24, dailyLimit: 1, running: true, revision: 1, authorizedAt: now, lastCycleAt: now, taskId: null })),
    runtimeHealth: { status: 'ready', checkedAt: now, nextCheckAt: now + 60000, failures: 0, detail: 'Ready' },
    readiness: marketingView(app).products.map(p => ({ productId: p.id, ready: true, needsAgents: true, activities: [], blockers: [] })),
  };
}
it('persists each business goal without changing its operation or enabling work', async () => {
  const [a, b] = marketingView(app).products;
  app.db.insert(settings).values({ key: `operations.policy.${a!.id}`, value: { running: false, dailyLimit: 1 } }).run();
  await marketingAction(app, { type: 'guide-plan', productId: a!.id, value: { goal: 'first-sales', audience: 'Proposal writers' } });
  await marketingAction(app, { type: 'guide-plan', productId: b!.id, value: { goal: 'more-trials', audience: 'Independent filmmakers' } });
  const reloaded = marketingView(app);
  expect(reloaded.guidePlans?.find(p => p.productId === a!.id)?.value.audience).toBe('Proposal writers');
  expect(reloaded.guidePlans?.find(p => p.productId === b!.id)?.value.goal).toBe('more-trials');
  expect(reloaded.tasks).toHaveLength(0);
  expect(app.db.select().from(settings).where(eq(settings.key, `operations.policy.${a!.id}`)).get()?.value).toEqual({ running: false, dailyLimit: 1 });
  await expect(marketingAction(app, { type: 'guide-plan', productId: 'missing', value: { goal: 'first-sales', audience: '' } })).rejects.toThrow();
});
it('keeps coaching questions and real replies durable, with the selected goal in agent context', async () => {
  const p = marketingView(app).products[0]!;
  await marketingAction(app, { type: 'guide-plan', productId: p.id, value: { goal: 'first-sales', audience: 'Proposal writers' } });
  const queued = await marketingAction(app, { type: 'guide-chat', productId: p.id, message: 'Why this audience?' });
  const id = queued.guideTaskIds![0]!;
  expect(queued.messages.find(m => m.taskId === id)?.body).toBe('Why this audience?');
  const llm = new ScriptedLlmClient([JSON.stringify({ message: 'We should test whether comparing source documents helps proposal writers.', actions: [] })]);
  await new GrowthEngine(app, llm).runNext(['marketing']);
  expect(marketingView(app).messages.find(m => m.taskId === id && m.role === 'assistant')?.body).toContain('proposal writers');
});
it('blocks publication, spending and automation tools from a coaching task at the execution boundary', async () => {
  const p = marketingView(app).products[0]!;
  const queued = await marketingAction(app, { type: 'guide-chat', productId: p.id, message: 'Help me decide what to do.' });
  const id = queued.guideTaskIds![0]!;
  for (const tool of ['blog.save', 'operations.enqueue', 'media.create', 'video.create', 'campaign.create', 'opportunities.process', 'bullseye.shortlist'] as const) {
    await expect(executeMarketingTool(app, p.id, tool, {}, new AbortController().signal, id)).rejects.toThrow('dedicated review screens');
  }
  await expect(executeMarketingTool(app, p.id, 'campaign.list', {}, new AbortController().signal, id)).resolves.toHaveProperty('campaigns');
});
it('prioritizes human requests, isolates businesses, and never confuses saved Run with a healthy agent', async () => {
  const v = operations(); const p = v.products[0]!; const other = v.products[1]!;
  await marketingAction(app, { type: 'guide-plan', productId: p.id, value: { goal: 'first-sales', audience: '' } });
  v.handoffs = [{ productId: other.id, open: 3, due: 3, waiting: 0, uncertain: 0 }];
  v.runtimeHealth!.checkedAt = now - 600000;
  expect(marketingGuide(v, marketingView(app), p.id, now)).toMatchObject({ working: false, next: { id: 'runtime' }, needsYou: [] });
  v.handoffs.push({ productId: p.id, open: 1, due: 1, waiting: 0, uncertain: 0 });
  expect(marketingGuide(v, marketingView(app), p.id, now).next.destination).toEqual({ screen: 'sales', section: 'conversations' });
  v.offline = true;
  expect(marketingGuide(v, marketingView(app), p.id, now)).toMatchObject({ working: false, status: 'Offline preview' });
});
it('uses the chosen goal and current research revision to select the next action', async () => {
  const v = operations(); const p = v.products[0]!;
  expect(marketingGuide(v, marketingView(app), p.id, now).next.id).toBe('goal');
  for (const [goal, expected] of [['more-trials', 'analytics'], ['repeatable-sales', 'revenue'], ['first-sales', 'operations']] as const) {
    await marketingAction(app, { type: 'guide-plan', productId: p.id, value: { goal, audience: '' } });
    expect(marketingGuide(v, marketingView(app), p.id, now).next.destination?.screen).toBe(expected);
  }
  v.acquisition = [{ productId: p.id, revision: 0, taskId: 'old', checkedAt: now, status: 'no-fit', detail: '', sourceUrl: '', assessments: [] }];
  expect(marketingGuide(v, marketingView(app), p.id, now).next.title).toBe('Find people with a problem you can solve');
});
