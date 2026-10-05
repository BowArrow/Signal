import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { enforceMarketingBudget, reserveGrowthTest } from '../marketing/store.js';
import type { App } from '../app.js';
import {
  growthChannels,
  growthExperiments,
  growthPlans,
  growthTasks,
  opportunities,
  products,
  settings,
} from '../db/schema.js';
import { newId } from '../lib/id.js';
import {
  CHANNELS,
  goalSchema,
  growthSettingsSchema,
  resultSchema,
  type ExperimentResult,
  type GrowthAction,
  type GrowthDashboard,
  type GrowthGoal,
  type GrowthSettings,
  type GrowthTaskKind,
} from '../../shared/growth.js';

export const DEFAULT_SETTINGS: GrowthSettings = {
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'gemma4:e4b',
  pipelineModel: 'qwen2.5-coder:7b',
  enabled: false,
  autoPlan: true,
  intervalMinutes: 60,
};
export const DEFAULT_GOAL: GrowthGoal = {
  description: 'Find a repeatable path to the first 10 paying customers',
  targetCustomers: 10,
  maxCacCents: 1500,
  experimentBudgetCents: 5000,
  testDays: 14,
  minVisitors: 100,
  minCustomers: 3,
};
const SETTINGS_KEY = 'growth.runtime.v1';
export function growthSettings(app: App): GrowthSettings {
  const row = app.db
    .select()
    .from(settings)
    .where(eq(settings.key, SETTINGS_KEY))
    .get();
  return row ? growthSettingsSchema.parse(row.value) : { ...DEFAULT_SETTINGS };
}

export function initializeGrowth(app: App): void {
  app.db.transaction((tx) => {
    for (const config of app.config.products) {
      let product = tx
        .select()
        .from(products)
        .where(eq(products.key, config.key))
        .get();
      if (!product) {
        product = tx
          .insert(products)
          .values({ ...config, id: newId() })
          .returning()
          .get();
      } else {
        // Product facts in config must reach existing installations as well as
        // fresh seeds. Brand preferences and measured experiment history live separately.
        const changed = Object.entries(config).some(([key, value]) => key !== 'enabled' && JSON.stringify(product![key as keyof typeof product]) !== JSON.stringify(value));
        if (changed) product = tx.update(products).set({ ...config, enabled: product.enabled, updatedAt: app.clock.now() }).where(eq(products.id, product.id)).returning().get();
      }
      if (!product || !product.enabled) continue;
      tx.insert(growthPlans)
        .values({ productId: product.id, goal: DEFAULT_GOAL })
        .onConflictDoNothing()
        .run();
      for (const [key] of CHANNELS) {
        tx.insert(growthChannels)
          .values({ id: newId(), productId: product.id, key })
          .onConflictDoNothing()
          .run();
      }
    }
  });
}

export function evaluateExperiment(
  result: ExperimentResult | null,
  goal: GrowthGoal,
) {
  if (!result)
    return {
      verdict: 'unmeasured' as const,
      reason: 'Record actual results before choosing a core channel.',
      cacCents: null,
    };
  const cacCents = result.customers
    ? result.spendCents / result.customers
    : null;
  if (result.spendCents > goal.experimentBudgetCents)
    return {
      verdict: 'stop' as const,
      reason:
        'Actual spend exceeded the experiment budget. Review the cost overrun before scaling.',
      cacCents,
    };
  if (result.visitors < goal.minVisitors)
    return {
      verdict: 'insufficient' as const,
      reason: `Need at least ${goal.minVisitors} measured visitors before comparing this test.`,
      cacCents,
    };
  if (
    result.customers < goal.minCustomers ||
    result.audienceFit !== 'good' ||
    cacCents === null ||
    cacCents > goal.maxCacCents
  ) {
    return {
      verdict: 'stop' as const,
      reason:
        'Customer count, acquisition cost, or audience fit did not meet the test thresholds. Revise the hypothesis.',
      cacCents,
    };
  }
  return {
    verdict: 'promising' as const,
    reason:
      'Meets the recorded test thresholds. This is directional evidence; validate repeatability and capacity before scaling.',
    cacCents,
  };
}

export function dashboard(app: App): GrowthDashboard {
  initializeGrowth(app);
  const activeKeys = new Set(app.config.products.map((p) => p.key));
  return {
    settings: growthSettings(app),
    products: app.db
      .select()
      .from(products)
      .where(eq(products.enabled, true))
      .all()
      .filter((p) => activeKeys.has(p.key))
      .map((product) => {
        const plan = app.db
          .select()
          .from(growthPlans)
          .where(eq(growthPlans.productId, product.id))
          .get();
        const channels = app.db
          .select()
          .from(growthChannels)
          .where(eq(growthChannels.productId, product.id))
          .all();
        return {
          id: product.id,
          name: product.name,
          currency: product.currency,
          goal: plan?.goal ?? DEFAULT_GOAL,
          channels: CHANNELS.flatMap(([key, name, hint]) => {
            const channel = channels.find((c) => c.key === key);
            const evidence = channel?.idea?.evidenceIds.length
              ? app.db
                  .select({
                    id: opportunities.id,
                    title: opportunities.title,
                    url: opportunities.url,
                  })
                  .from(opportunities)
                  .where(inArray(opportunities.id, channel.idea.evidenceIds))
                  .all()
              : [];
            return channel ? [{ ...channel, name, hint, evidence }] : [];
          }),
          experiments: app.db
            .select()
            .from(growthExperiments)
            .where(eq(growthExperiments.productId, product.id))
            .orderBy(desc(growthExperiments.createdAt))
            .all()
            .map((e) => ({
              ...e,
              channelName:
                CHANNELS.find(
                  (c) =>
                    c[0] === channels.find((c) => c.id === e.channelId)?.key,
                )?.[1] ?? '',
              evaluation: evaluateExperiment(e.result, e.goal),
            })),
          tasks: visibleTasks(app, product.id),
        };
      }),
  };
}

function visibleTasks(app: App, productId: string) {
  const recent = app.db
    .select()
    .from(growthTasks)
    .where(eq(growthTasks.productId, productId))
    .orderBy(desc(growthTasks.createdAt))
    .limit(100)
    .all();
  // Keep campaign assets accessible even after many scheduled analysis cycles.
  const outputs = app.db
    .select()
    .from(growthTasks)
    .where(
      and(
        eq(growthTasks.productId, productId),
        eq(growthTasks.status, 'done'),
        inArray(growthTasks.kind, ['campaign', 'analysis']),
      ),
    )
    .orderBy(desc(growthTasks.createdAt))
    .all();
  const pending = app.db
    .select()
    .from(growthTasks)
    .where(
      and(
        eq(growthTasks.productId, productId),
        inArray(growthTasks.status, ['queued', 'running']),
      ),
    )
    .all();
  const latestByTarget = new Map<string, typeof growthTasks.$inferSelect>();
  for (const task of outputs) {
    const key = `${task.kind}:${task.targetId}`;
    if (!latestByTarget.has(key)) latestByTarget.set(key, task);
  }
  const visible = new Map(
    [...recent, ...pending, ...latestByTarget.values()].map((t) => [t.id, t]),
  );
  return [...visible.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function queueTask(
  app: App,
  productId: string,
  kind: GrowthTaskKind,
  targetId: string,
): string | null {
  return app.db.transaction((tx) => {
    const active = tx
      .select()
      .from(growthTasks)
      .where(
        and(
          eq(growthTasks.productId, productId),
          eq(growthTasks.kind, kind),
          eq(growthTasks.targetId, targetId),
          inArray(growthTasks.status, ['queued', 'running']),
        ),
      )
      .get();
    if (active) return null;
    const id = newId();
    tx.insert(growthTasks)
      .values({
        id,
        productId,
        kind,
        targetId,
        createdAt: app.clock.now(),
        updatedAt: app.clock.now(),
      })
      .run();
    return id;
  });
}

const id = z.string().min(1).max(100);
const actionSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('settings'), value: growthSettingsSchema })
    .strict(),
  z
    .object({ type: z.literal('goal'), productId: id, value: goalSchema })
    .strict(),
  z.object({ type: z.literal('research'), productId: id, refresh: z.boolean().optional() }).strict(),
  ...(['analysis', 'opportunities'] as const).map((type) =>
    z.object({ type: z.literal(type), productId: id }).strict(),
  ),
  ...(['shortlist', 'remove', 'focus'] as const).map((type) =>
    z.object({ type: z.literal(type), channelId: id }).strict(),
  ),
  ...(['start', 'campaign'] as const).map((type) =>
    z.object({ type: z.literal(type), experimentId: id }).strict(),
  ),
  z
    .object({
      type: z.literal('results'),
      experimentId: id,
      value: resultSchema,
    })
    .strict(),
  ...(['cancel', 'retry'] as const).map((type) =>
    z.object({ type: z.literal(type), taskId: id }).strict(),
  ),
]);

export function applyGrowthAction(app: App, input: unknown): GrowthDashboard {
  const action = actionSchema.parse(input) as GrowthAction;
  initializeGrowth(app);
  const now = app.clock.now();
  app.db.transaction((tx) => {
    if (action.type === 'settings') {
      tx.insert(settings)
        .values({ key: SETTINGS_KEY, value: action.value, updatedAt: now })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: action.value, updatedAt: now },
        })
        .run();
      return;
    }
    if ('productId' in action) {
      const p = tx
        .select()
        .from(products)
        .where(eq(products.id, action.productId))
        .get();
      if (!p?.enabled || !app.config.products.some((c) => c.key === p.key))
        throw new Error('Unknown or retired product');
      if (action.type === 'goal') {
        tx.update(growthPlans)
          .set({ goal: action.value, updatedAt: now })
          .where(eq(growthPlans.productId, p.id))
          .run();
      } else if (action.type === 'research') {
        for (const channel of tx
          .select()
          .from(growthChannels)
          .where(eq(growthChannels.productId, p.id))
          .all()) {
          if (action.refresh || !channel.idea) queueTask(app, p.id, 'research', channel.id);
        }
      } else {
        queueTask(app, p.id, action.type, p.id);
      }
      return;
    }
    if ('taskId' in action) {
      const task = tx
        .select()
        .from(growthTasks)
        .where(eq(growthTasks.id, action.taskId))
        .get();
      if (!task) throw new Error('Task not found');
      if (action.type === 'cancel') {
        tx.update(growthTasks)
          .set({ status: 'cancelled', lease: null, updatedAt: now })
          .where(
            and(
              eq(growthTasks.id, task.id),
              inArray(growthTasks.status, ['queued', 'running']),
            ),
          )
          .run();
      } else {
        if (!['failed', 'cancelled'].includes(task.status))
          throw new Error('Only failed or cancelled tasks can be retried');
        queueTask(app, task.productId, task.kind, task.targetId);
      }
      return;
    }
    if ('experimentId' in action) {
      const exp = tx
        .select()
        .from(growthExperiments)
        .where(eq(growthExperiments.id, action.experimentId))
        .get();
      if (!exp) throw new Error('Experiment not found');
      if (action.type === 'campaign') {
        queueTask(app, exp.productId, 'campaign', exp.id);
      } else if (action.type === 'start') {
        if (exp.status !== 'planned')
          throw new Error('This experiment has already started');
        const channel = tx
          .select()
          .from(growthChannels)
          .where(eq(growthChannels.id, exp.channelId))
          .get();
        if (!channel || channel.ring === 'outer')
          throw new Error('Shortlist this channel before starting its test');
        reserveGrowthTest(app, exp.productId, exp.id, channel.idea?.estimatedCostCents ?? 0);
        const running = tx
          .select()
          .from(growthExperiments)
          .where(
            and(
              eq(growthExperiments.productId, exp.productId),
              eq(growthExperiments.status, 'running'),
            ),
          )
          .all();
        if (running.length >= 3)
          throw new Error(
            'Finish an active experiment before starting another (maximum three)',
          );
        tx.update(growthExperiments)
          .set({
            status: 'running',
            startedAt: now,
            endsAt: now + exp.goal.testDays * 86400000,
            updatedAt: now,
          })
          .where(eq(growthExperiments.id, exp.id))
          .run();
      } else {
        if (exp.status === 'planned')
          throw new Error('Start this test before recording results');
        tx.update(growthExperiments)
          .set({ result: action.value, status: 'completed', updatedAt: now })
          .where(eq(growthExperiments.id, exp.id))
          .run();
        // Correcting a measurement can invalidate an earlier focus decision.
        if (
          evaluateExperiment(action.value, exp.goal).verdict !== 'promising'
        ) {
          tx.update(growthChannels)
            .set({ ring: 'middle', updatedAt: now })
            .where(
              and(
                eq(growthChannels.id, exp.channelId),
                eq(growthChannels.ring, 'inner'),
              ),
            )
            .run();
        }
      }
      return;
    }
    const channel = tx
      .select()
      .from(growthChannels)
      .where(eq(growthChannels.id, action.channelId))
      .get();
    if (!channel) throw new Error('Channel not found');
    if (action.type === 'remove') {
      const running = tx
        .select()
        .from(growthExperiments)
        .where(
          and(
            eq(growthExperiments.channelId, channel.id),
            eq(growthExperiments.status, 'running'),
          ),
        )
        .get();
      if (running)
        throw new Error(
          'Record the active test results before removing this channel',
        );
      tx.update(growthChannels)
        .set({ ring: 'outer', updatedAt: now })
        .where(eq(growthChannels.id, channel.id))
        .run();
    } else if (action.type === 'focus') {
      if (channel.ring === 'outer') {
        const selected = tx
          .select()
          .from(growthChannels)
          .where(
            and(
              eq(growthChannels.productId, channel.productId),
              inArray(growthChannels.ring, ['middle', 'inner']),
            ),
          )
          .all();
        if (selected.length >= 3)
          throw new Error(
            'Remove a shortlisted channel before focusing another (maximum three)',
          );
      }
      const latest = tx
        .select()
        .from(growthExperiments)
        .where(
          and(
            eq(growthExperiments.channelId, channel.id),
            eq(growthExperiments.status, 'completed'),
          ),
        )
        .orderBy(desc(growthExperiments.updatedAt))
        .get();
      if (
        !latest ||
        evaluateExperiment(latest.result, latest.goal).verdict !== 'promising'
      )
        throw new Error(
          'A core channel needs a completed test that meets its measured success thresholds',
        );
      tx.update(growthChannels)
        .set({ ring: 'middle', updatedAt: now })
        .where(
          and(
            eq(growthChannels.productId, channel.productId),
            eq(growthChannels.ring, 'inner'),
          ),
        )
        .run();
      tx.update(growthChannels)
        .set({ ring: 'inner', updatedAt: now })
        .where(eq(growthChannels.id, channel.id))
        .run();
    } else {
      if (!channel.idea)
        throw new Error('Research this channel before designing its test');
      const selected = tx
        .select()
        .from(growthChannels)
        .where(
          and(
            eq(growthChannels.productId, channel.productId),
            inArray(growthChannels.ring, ['middle', 'inner']),
          ),
        )
        .all();
      if (channel.ring === 'outer' && selected.length >= 3)
        throw new Error(
          'Keep at most three channels in the shortlist; remove one first',
        );
      const open = tx
        .select()
        .from(growthExperiments)
        .where(
          and(
            eq(growthExperiments.channelId, channel.id),
            inArray(growthExperiments.status, ['planned', 'running']),
          ),
        )
        .get();
      if (open) {
        tx.update(growthChannels)
          .set({
            ring: channel.ring === 'inner' ? 'inner' : 'middle',
            updatedAt: now,
          })
          .where(eq(growthChannels.id, channel.id))
          .run();
        return;
      }
      enforceMarketingBudget(app, channel.productId, channel.idea.estimatedCostCents);
      const plan = tx
        .select()
        .from(growthPlans)
        .where(eq(growthPlans.productId, channel.productId))
        .get();
      const product = tx
        .select()
        .from(products)
        .where(eq(products.id, channel.productId))
        .get();
      if (!plan || !product) throw new Error('Product plan not found');
      if (channel.idea.estimatedCostCents > plan.goal.experimentBudgetCents)
        throw new Error(
          'This idea exceeds your test budget; revise the goal or choose a cheaper channel',
        );
      const experimentId = newId();
      const url = new URL(product.utmBase);
      if (!['http:', 'https:'].includes(url.protocol))
        throw new Error('Product URL must use HTTP or HTTPS');
      url.searchParams.set('utm_source', 'signal');
      url.searchParams.set('utm_medium', channel.key);
      url.searchParams.set('utm_campaign', experimentId);
      tx.insert(growthExperiments)
        .values({
          id: experimentId,
          productId: product.id,
          channelId: channel.id,
          title: channel.idea.hypothesis,
          goal: plan.goal,
          trackedUrl: url.toString(),
          createdAt: now,
          updatedAt: now,
        })
        .run();
      tx.update(growthChannels)
        .set({
          ring: channel.ring === 'inner' ? 'inner' : 'middle',
          updatedAt: now,
        })
        .where(eq(growthChannels.id, channel.id))
        .run();
      queueTask(app, product.id, 'campaign', experimentId);
    }
  });
  return dashboard(app);
}
