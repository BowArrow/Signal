import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { GrowthEngine } from '../../src/core/growth/engine.js';
import {
  applyGrowthAction,
  dashboard,
  DEFAULT_GOAL,
  DEFAULT_SETTINGS,
  evaluateExperiment,
  queueTask,
} from '../../src/core/growth/store.js';
import {
  growthChannels,
  growthTasks,
  llmCalls,
  settings,
} from '../../src/core/db/schema.js';
import { OperationsService } from '../../src/core/operations/service.js';
import {
  ScriptedLlmClient,
  type CompletionResult,
  type LlmClient,
} from '../../src/core/llm/client.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { insertSource, insertOpportunity } from '../helpers/db.js';
import {
  growthSettingsSchema,
  type ChannelIdea,
  type ExperimentResult,
} from '../../src/shared/growth.js';

const idea: ChannelIdea = {
  hypothesis: 'A VRAM sizing guide attracts qualified buyers',
  audience: 'Local AI users',
  test: 'Publish a tutorial and measure signups for fourteen days',
  successSignal: 'Three paying customers at under $15 CAC',
  estimatedCostCents: 0,
  estimatedHours: 3,
  potentialCustomers: 20,
  confidence: 0.4,
  rationale: 'Untested hypothesis',
  evidenceIds: [],
};
const result: ExperimentResult = {
  visitors: 120,
  leads: 20,
  customers: 4,
  spendCents: 2000,
  revenueCents: 19600,
  audienceFit: 'good',
  source: 'Analytics export test-123',
  notes: 'Visitors needed offline inference',
};
let app: App;
const clock = fixedClock(1800000000000);
beforeEach(() => {
  app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger });
});
afterEach(() => app.close());
it.each([true, false])('prioritizes only a running operation over older analysis: running=%s', async running => {
  const product = first();
  const old = queueTask(app, product.id, 'analysis', product.id)!;
  clock.advance(1);
  const urgent = queueTask(app, product.id, 'marketing', 'missing-message-fixture')!;
  app.operations = new OperationsService(app);
  app.db.insert(settings).values({ key: 'operations.policy.' + product.id, value: { ...app.operations.state(product.id), running, taskId: urgent } }).onConflictDoUpdate({ target: settings.key, set: { value: { ...app.operations.state(product.id), running, taskId: urgent } } }).run();
  // Deliberately invalid task input lets us observe which job was claimed,
  // without invoking a real model, website request or delivery.
  await new GrowthEngine(app, new ScriptedLlmClient(['invalid'])).runNext();
  expect(app.db.select().from(growthTasks).where(eq(growthTasks.id, running ? old : urgent)).get()?.status).toBe('queued');
  expect(app.db.select().from(growthTasks).where(eq(growthTasks.id, running ? urgent : old)).get()?.status).toBe('failed');
});
function first() {
  return dashboard(app).products[0]!;
}
function researchAll() {
  const product = first();
  for (const channel of product.channels)
    app.db
      .update(growthChannels)
      .set({ idea })
      .where(eq(growthChannels.id, channel.id))
      .run();
  return first();
}
function shortlist(index = 0) {
  const product = researchAll();
  return applyGrowthAction(app, {
    type: 'shortlist',
    channelId: product.channels[index]!.id,
  }).products[0]!.experiments[0]!;
}

describe('Bullseye experiments', () => {
  it('initializes all nineteen channels per product idempotently without invented ideas', () => {
    const state = dashboard(app);
    expect(state.products).toHaveLength(2);
    expect(
      state.products.every(
        (p) =>
          p.channels.length === 19 && p.channels.every((c) => c.idea === null),
      ),
    ).toBe(true);
    expect(dashboard(app).products[0]!.channels.map((c) => c.id)).toEqual(
      state.products[0]!.channels.map((c) => c.id),
    );
  });
  it('deduplicates queued and running research requests', () => {
    const product = first();
    applyGrowthAction(app, { type: 'research', productId: product.id });
    applyGrowthAction(app, { type: 'research', productId: product.id });
    expect(first().tasks).toHaveLength(19);
    const task = first().tasks[0]!;
    app.db
      .update(growthTasks)
      .set({ status: 'running' })
      .where(eq(growthTasks.id, task.id))
      .run();
    expect(queueTask(app, product.id, task.kind, task.targetId)).toBeNull();
  });
  it('enforces three shortlisted channels and preserves history when removing one', () => {
    const product = researchAll();
    for (const c of product.channels.slice(0, 3))
      applyGrowthAction(app, { type: 'shortlist', channelId: c.id });
    expect(() =>
      applyGrowthAction(app, {
        type: 'shortlist',
        channelId: product.channels[3]!.id,
      }),
    ).toThrow('three');
    applyGrowthAction(app, {
      type: 'remove',
      channelId: product.channels[0]!.id,
    });
    expect(first().experiments).toHaveLength(3);
    applyGrowthAction(app, {
      type: 'shortlist',
      channelId: product.channels[3]!.id,
    });
    expect(first().channels.filter((c) => c.ring === 'middle')).toHaveLength(3);
  });
  it('refreshes completed research without deleting ideas or duplicating pending work', async () => {
    const product = researchAll();
    applyGrowthAction(app, { type: 'research', productId: product.id });
    expect(first().tasks).toHaveLength(0);
    applyGrowthAction(app, { type: 'research', productId: product.id, refresh: true });
    applyGrowthAction(app, { type: 'research', productId: product.id, refresh: true });
    expect(first().tasks).toHaveLength(19);
    expect(first().channels.every((c) => c.idea?.hypothesis === idea.hypothesis)).toBe(true);
    const llm = new ScriptedLlmClient([JSON.stringify({ ...idea, hypothesis: 'A refreshed hypothesis' })]);
    await new GrowthEngine(app, llm).runNext();
    expect(first().channels.filter((c) => c.idea?.hypothesis === 'A refreshed hypothesis')).toHaveLength(1);
    expect(llm.calls[0]!.reasoningEffort).toBe('none');
    await new GrowthEngine(app, new ScriptedLlmClient(['invalid'])).runNext();
    expect(first().channels.every((c) => c.idea)).toBe(true);
  });
  it('snapshots thresholds and uses the configured product domain for experiment UTMs', () => {
    const exp = shortlist();
    expect(new URL(exp.trackedUrl).searchParams.get('utm_campaign')).toBe(
      exp.id,
    );
    expect(new URL(exp.trackedUrl).origin).toBe(
      new URL(app.config.products[0]!.utmBase).origin,
    );
    applyGrowthAction(app, {
      type: 'goal',
      productId: first().id,
      value: { ...DEFAULT_GOAL, minCustomers: 500 },
    });
    expect(first().experiments[0]!.goal.minCustomers).toBe(3);
  });
  it('refuses over-budget ideas, invalid funnel counts, and results before starting', () => {
    const channel = researchAll().channels[0]!;
    app.db
      .update(growthChannels)
      .set({ idea: { ...idea, estimatedCostCents: 999999 } })
      .where(eq(growthChannels.id, channel.id))
      .run();
    expect(() =>
      applyGrowthAction(app, { type: 'shortlist', channelId: channel.id }),
    ).toThrow('budget');
    const exp = shortlist();
    expect(() =>
      applyGrowthAction(app, {
        type: 'results',
        experimentId: exp.id,
        value: result,
      }),
    ).toThrow('Start');
    applyGrowthAction(app, { type: 'start', experimentId: exp.id });
    expect(() =>
      applyGrowthAction(app, {
        type: 'results',
        experimentId: exp.id,
        value: { ...result, customers: 999 },
      }),
    ).toThrow();
  });
  it('requires measured evidence for focus and revokes it when corrected measurements fail', () => {
    const exp = shortlist();
    expect(() =>
      applyGrowthAction(app, { type: 'focus', channelId: exp.channelId }),
    ).toThrow('completed');
    applyGrowthAction(app, { type: 'start', experimentId: exp.id });
    applyGrowthAction(app, {
      type: 'results',
      experimentId: exp.id,
      value: result,
    });
    applyGrowthAction(app, { type: 'focus', channelId: exp.channelId });
    expect(first().channels.filter((c) => c.ring === 'inner')).toHaveLength(1);
    applyGrowthAction(app, {
      type: 'results',
      experimentId: exp.id,
      value: { ...result, customers: 0 },
    });
    expect(first().channels.filter((c) => c.ring === 'inner')).toHaveLength(0);
  });
  it('never converts missing measurements or zero customers into zero CAC success', () => {
    expect(evaluateExperiment(null, DEFAULT_GOAL).verdict).toBe('unmeasured');
    expect(
      evaluateExperiment({ ...result, customers: 0 }, DEFAULT_GOAL).cacCents,
    ).toBeNull();
    expect(
      evaluateExperiment({ ...result, visitors: 20, leads: 10 }, DEFAULT_GOAL)
        .verdict,
    ).toBe('insufficient');
    expect(
      evaluateExperiment({ ...result, audienceFit: 'unknown' }, DEFAULT_GOAL)
        .verdict,
    ).toBe('stop');
  });
  it('rejects remote runtimes, credentials in URLs, NaN and unknown action fields', () => {
    for (const baseUrl of [
      'https://example.com/v1',
      'http://localhost.evil.test/v1',
      'http://user:pass@localhost:8080/v1',
      'file:///tmp/model',
    ]) {
      expect(
        growthSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, baseUrl })
          .success,
      ).toBe(false);
    }
    expect(() =>
      applyGrowthAction(app, {
        type: 'goal',
        productId: first().id,
        value: { ...DEFAULT_GOAL, minCustomers: NaN },
      }),
    ).toThrow();
    expect(() =>
      applyGrowthAction(app, {
        type: 'research',
        productId: first().id,
        publish: true,
      }),
    ).toThrow();
  });
});

describe('durable local agents', () => {
  it('maps simple model evidence labels back to the real opportunity IDs', async () => {
    const product = first();
    const source = insertSource(app.dbHandle);
    const opportunity = insertOpportunity(app.dbHandle, source.id, {
      matchedProductId: product.id,
    });
    queueTask(app, product.id, 'research', product.channels[0]!.id);
    const llm = new ScriptedLlmClient([
      JSON.stringify({ ...idea, evidenceIds: ['E1'] }),
    ]);
    await new GrowthEngine(app, llm).runNext();
    expect(first().channels[0]!.idea?.evidenceIds).toEqual([opportunity.id]);
    expect(llm.calls[0]!.prompt).toContain('"id":"E1"');
  });
  it('automatically shortlists three affordable ideas only after considering all channels', () => {
    const engine = new GrowthEngine(app);
    applyGrowthAction(app, {
      type: 'settings',
      value: { ...DEFAULT_SETTINGS, enabled: true },
    });
    engine.schedule();
    expect(first().experiments).toHaveLength(0);
    researchAll();
    clock.advance(61 * 60000);
    engine.schedule();
    expect(first().experiments).toHaveLength(3);
    expect(first().channels.filter((c) => c.ring === 'middle')).toHaveLength(3);
    expect(first().tasks.filter((t) => t.kind === 'campaign')).toHaveLength(3);
    expect(first().channels.filter((c) => c.ring === 'inner')).toHaveLength(0);
  });
  it('repairs a malformed structured output once and records both attempts', async () => {
    const product = first();
    queueTask(app, product.id, 'research', product.channels[0]!.id);
    const llm = new ScriptedLlmClient([
      '{"hypothesis":"incomplete"}',
      JSON.stringify(idea),
    ]);
    await new GrowthEngine(app, llm).runNext();
    expect(first().tasks[0]!.status).toBe('done');
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]!.prompt).toContain('only correction attempt');
    expect(app.db.select().from(llmCalls).all()).toHaveLength(2);
  });
  it('persists a real schema-validated response and records model telemetry', async () => {
    const product = first();
    const channel = product.channels[0]!;
    queueTask(app, product.id, 'research', channel.id);
    const llm = new ScriptedLlmClient([JSON.stringify(idea)]);
    await new GrowthEngine(app, llm).runNext();
    expect(first().channels[0]!.idea).toEqual(idea);
    expect(first().tasks[0]!.status).toBe('done');
    expect(app.db.select().from(llmCalls).all()).toHaveLength(1);
    expect(llm.calls[0]!.prompt).toContain('untrusted reference data');
  });
  it('records failures for invalid JSON, schema violations, and invented evidence instead of producing a plan', async () => {
    const product = first();
    for (const [index, response] of [
      'not json',
      JSON.stringify({ hypothesis: 'incomplete' }),
      JSON.stringify({ ...idea, evidenceIds: ['made-up'] }),
    ].entries()) {
      queueTask(app, product.id, 'research', product.channels[index]!.id);
      await new GrowthEngine(app, new ScriptedLlmClient([response])).runNext();
    }
    expect(first().tasks.every((t) => t.status === 'failed' && t.error)).toBe(
      true,
    );
    expect(first().channels.every((c) => c.idea === null)).toBe(true);
  });
  it('allows retry after failure without replaying successful tasks', async () => {
    const product = first();
    queueTask(app, product.id, 'research', product.channels[0]!.id);
    await new GrowthEngine(app, new ScriptedLlmClient(['bad'])).runNext();
    applyGrowthAction(app, { type: 'retry', taskId: first().tasks[0]!.id });
    await new GrowthEngine(
      app,
      new ScriptedLlmClient([JSON.stringify(idea)]),
    ).runNext();
    expect(first().tasks.filter((t) => t.status === 'done')).toHaveLength(1);
    expect(await new GrowthEngine(app).runNext()).toBe(false);
  });
  it('discards cancelled in-flight output and prevents a second worker claiming the same task', async () => {
    const product = first();
    queueTask(app, product.id, 'research', product.channels[0]!.id);
    let finish!: (r: CompletionResult) => void;
    const llm: LlmClient = {
      available: () => ({ ready: true }),
      complete: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    };
    const firstWorker = new GrowthEngine(app, llm).runNext();
    expect(await new GrowthEngine(app, llm).runNext()).toBe(false);
    applyGrowthAction(app, { type: 'cancel', taskId: first().tasks[0]!.id });
    finish({
      text: JSON.stringify(idea),
      inputTokens: 0,
      outputTokens: 0,
      model: 'test',
      stopReason: 'end_turn',
    });
    await firstWorker;
    expect(first().tasks[0]!.status).toBe('cancelled');
    expect(first().channels[0]!.idea).toBeNull();
  });
  it('makes interrupted leases visible and keeps scheduling bounded and idempotent', () => {
    const engine = new GrowthEngine(app);
    applyGrowthAction(app, {
      type: 'settings',
      value: { ...DEFAULT_SETTINGS, enabled: true },
    });
    engine.schedule();
    engine.schedule();
    expect(dashboard(app).products.flatMap((p) => p.tasks)).toHaveLength(7);
    applyGrowthAction(app, {
      type: 'settings',
      value: { ...DEFAULT_SETTINGS, enabled: false },
    });
    clock.advance(120 * 60000);
    engine.schedule();
    expect(dashboard(app).products.flatMap((p) => p.tasks)).toHaveLength(7);
  });
  it('recovers a crashed lease as a retryable failure', async () => {
    const product = first();
    const id = queueTask(app, product.id, 'research', product.channels[0]!.id)!;
    app.db
      .update(growthTasks)
      .set({
        status: 'running',
        lease: 'old-process',
        updatedAt: clock.now() - 11 * 60000,
      })
      .where(eq(growthTasks.id, id))
      .run();
    expect(await new GrowthEngine(app).runNext()).toBe(false);
    expect(first().tasks[0]!.status).toBe('failed');
    expect(first().tasks[0]!.error).toContain('interrupted');
  });
});
