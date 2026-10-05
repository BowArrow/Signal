import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import type { App } from '../app.js';
import { hasPendingMedia, marketingSettings, scheduleMarketing } from '../marketing/store.js';
import { runMarketingAgent } from '../marketing/agent.js';
import { runAdDirector } from '../video/ad-director.js';
import { pollMedia } from '../marketing/comfy.js';
import {
  communities,
  growthChannels,
  growthPlans,
  growthTasks,
  opportunities,
  products,
} from '../db/schema.js';
import { newId } from '../lib/id.js';
import { extractJson, type LlmClient } from '../llm/client.js';
import { agentClient, agentModel } from '../runtime/client.js';
import { runtimeSettings } from '../runtime/settings.js';
import { generateCampaign } from '../studio/generate.js';
import { RecordingLlmClient } from '../llm/recording.js';
import { loadPrompt } from '../prompts/loader.js';
import { checkDisclosure } from '../guardrails/disclosure.js';
import { assertGroundedMoney, modelContext } from './context.js';
import { getRule, isStale, refreshRules } from '../rules/registry.js';
import { runScoring } from '../scoring/run.js';
import { runDrafting } from '../draft/run.js';
import {
  analysisSchema,
  assetSchema,
  ideaSchema,
  type GrowthTaskKind,
} from '../../shared/growth.js';
import {
  dashboard,
  applyGrowthAction,
  growthSettings,
  initializeGrowth,
  queueTask,
} from './store.js';

const LEASE_MS = 10 * 60_000;
export class GrowthEngine {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deliveryTimer: ReturnType<typeof setTimeout> | null = null;
  private deliveryActive: Promise<void> | null = null;
  private active: Promise<boolean> | null = null;
  private controller: AbortController | null = null;
  private activeTaskId: string | null = null;
  private stopped = true;

  constructor(
    private readonly app: App,
    private readonly testLlm?: LlmClient,
  ) {}

  async checkRuntime(requiredModels?: string[]) {
    const config = growthSettings(this.app);
    if (this.app.env.SIGNAL_OFFLINE === '1')
      return { ok: false, detail: 'SIGNAL_OFFLINE=1', models: [] as string[] };
    const client = agentClient(this.app);
    const result = await client.ping();
    const expected = requiredModels ?? (runtimeSettings(this.app).provider === 'openai' ? [agentModel(this.app, 'growth')] : [config.model, config.pipelineModel, marketingSettings(this.app).model]);
    const missingModels = expected.filter(
      (m) => !(result.models ?? []).includes(m),
    );
    return {
      ...result,
      ok: result.ok && missingModels.length === 0,
      detail:
        result.ok && missingModels.length > 0
          ? `Configured model(s) ${missingModels.join(', ')} not served. Choose installed models.`
          : result.detail,
    };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    initializeGrowth(this.app);
    // Approved mail and fresh inbox checks must not wait for a model call.
    // These services serialize their own work; false prevents this loop from
    // starting generation or triage, while retaining normal delivery guards.
    const deliveryLoop = (): void => {
      if (this.stopped) return;
      this.deliveryActive = (async () => {
        await this.app.sales?.tick(false);
        if (this.stopped) return;
        await this.app.salesReplies?.tick(false);
        if (this.stopped) return;
        await this.app.outreach?.tick(false);
      })().catch(error => {
        this.app.logger.error('approved email worker failed', { error: String(error) });
      }).finally(() => {
        this.deliveryActive = null;
        if (!this.stopped) this.deliveryTimer = setTimeout(deliveryLoop, 2000);
      });
    };
    deliveryLoop();
    const loop = async (): Promise<void> => {
      if (this.stopped) return;
      try {
        const runtimeReady = await this.app.runtimeSupervisor?.readyForAgents() ?? true;
        await pollMedia(this.app);
        const agentsReady = runtimeReady && !hasPendingMedia(this.app);
        await this.app.prospects?.tick();
        await this.app.sales?.tick(agentsReady);
        await this.app.salesReplies?.tick(agentsReady);
        this.app.salesHandoffs?.sync();
        await this.app.revenue?.tick();
        await this.app.outreach?.tick(agentsReady);
        await this.app.prospectResearch?.tick(agentsReady);
        await this.app.analytics?.tick();
        await this.app.seo?.tick();
        if (agentsReady) this.app.operations?.schedule();
        await this.app.operations?.tick(agentsReady);
        if (agentsReady) { scheduleMarketing(this.app); this.schedule(); await this.runNext(); }
      } catch (error) {
        this.app.logger.error('growth worker failed', { error: String(error) });
      }
      if (!this.stopped) this.timer = setTimeout(() => void loop(), 2000);
    };
    void loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.deliveryTimer) clearTimeout(this.deliveryTimer);
    this.deliveryTimer = null;
    this.controller?.abort();
    await this.app.operations?.stop();
    await this.app.revenue?.stop();
    await this.app.analytics?.stop();
    await this.app.seo?.stop();
    await this.app.sales?.stop();
    await this.app.salesReplies?.stop();
    await this.app.outreach?.stop();
    await this.app.prospectResearch?.stop();
    await this.app.prospects?.stop();
    await this.deliveryActive;
    await this.active;
  }

  cancel(taskId: string): void {
    if (taskId === this.activeTaskId) this.controller?.abort();
  }

  schedule(): void {
    const config = growthSettings(this.app);
    if (!config.enabled) return;
    const now = this.app.clock.now();
    this.app.db.transaction((tx) => {
      for (let product of dashboard(this.app).products) {
        const plan = tx
          .select()
          .from(growthPlans)
          .where(eq(growthPlans.productId, product.id))
          .get();
        if (
          plan?.lastScheduledAt != null &&
          now - plan.lastScheduledAt < config.intervalMinutes * 60_000
        )
          continue;
        if (config.autoPlan) {
          this.planNextActions(product);
          product =
            dashboard(this.app).products.find((p) => p.id === product.id) ??
            product;
        }
        const core = product.channels.find((c) => c.ring === 'inner');
        const missing = core
          ? []
          : product.channels.filter((c) => !c.idea).slice(0, 3);
        for (const channel of missing)
          queueTask(this.app, product.id, 'research', channel.id);
        for (const exp of product.experiments.filter(
          (e) => e.status !== 'completed' && (!core || e.channelId === core.id),
        )) {
          const existing = tx
            .select()
            .from(growthTasks)
            .where(
              and(
                eq(growthTasks.kind, 'campaign'),
                eq(growthTasks.targetId, exp.id),
                inArray(growthTasks.status, ['done', 'queued', 'running']),
              ),
            )
            .get();
          if (!existing) queueTask(this.app, product.id, 'campaign', exp.id);
        }
        if (missing.length === 0)
          queueTask(this.app, product.id, 'analysis', product.id);
        tx.update(growthPlans)
          .set({ lastScheduledAt: now, updatedAt: now })
          .where(eq(growthPlans.productId, product.id))
          .run();
      }
      // The community pipeline spans products. Schedule it once per interval.
      const latest = tx
        .select()
        .from(growthTasks)
        .where(eq(growthTasks.kind, 'opportunities'))
        .orderBy(desc(growthTasks.createdAt))
        .get();
      const first = dashboard(this.app).products[0];
      if (
        first &&
        (!latest || now - latest.createdAt >= config.intervalMinutes * 60_000)
      )
        queueTask(this.app, first.id, 'opportunities', first.id);
    });
  }

  runNext(kinds?: GrowthTaskKind[]): Promise<boolean> {
    if (this.active) return this.active;
    this.active = this.executeNext(kinds).finally(() => {
      this.active = null;
    });
    return this.active;
  }

  private planNextActions(
    product: ReturnType<typeof dashboard>['products'][number],
  ): void {
    const winners = product.channels
      .flatMap((channel) => {
        const latest = product.experiments
          .filter((e) => e.channelId === channel.id && e.status === 'completed')
          .sort((a, b) => b.updatedAt - a.updatedAt)[0];
        return latest?.evaluation.verdict === 'promising'
          ? [{ channel, experiment: latest }]
          : [];
      })
      .sort(
        (a, b) =>
          (a.experiment.evaluation.cacCents ?? Infinity) -
          (b.experiment.evaluation.cacCents ?? Infinity),
      );
    const winner = winners.find(
      (w) =>
        w.channel.ring !== 'outer' ||
        product.channels.filter((c) => c.ring !== 'outer').length < 3,
    );
    if (winner) {
      if (winner.channel.ring !== 'inner')
        applyGrowthAction(this.app, {
          type: 'focus',
          channelId: winner.channel.id,
        });
      if (
        !product.experiments.some(
          (e) => e.channelId === winner.channel.id && e.status !== 'completed',
        )
      ) {
        applyGrowthAction(this.app, {
          type: 'shortlist',
          channelId: winner.channel.id,
        });
      }
      return;
    }
    if (product.channels.some((c) => !c.idea)) return; // Avoid selecting only familiar channels.
    const active = product.experiments.filter((e) => e.status !== 'completed');
    if (active.length) return;
    const candidates = product.channels
      .filter(
        (c) =>
          c.idea &&
          c.idea.estimatedCostCents <= product.goal.experimentBudgetCents &&
          !product.experiments.some((e) => e.channelId === c.id),
      )
      .sort(
        (a, b) =>
          (b.idea?.confidence ?? 0) - (a.idea?.confidence ?? 0) ||
          (a.idea?.estimatedCostCents ?? 0) - (b.idea?.estimatedCostCents ?? 0),
      )
      .slice(0, 3);
    if (!candidates.length) return;
    for (const channel of product.channels.filter((c) => c.ring !== 'outer'))
      applyGrowthAction(this.app, { type: 'remove', channelId: channel.id });
    for (const channel of candidates)
      applyGrowthAction(this.app, { type: 'shortlist', channelId: channel.id });
  }

  private async executeNext(kinds?: GrowthTaskKind[]): Promise<boolean> {
    const app = this.app;
    if (app.outreach?.agentBusy() || hasPendingMedia(app)) return false;
    const now = app.clock.now();
    const lease = newId();
    const task = app.db.transaction((tx) => {
      // A crashed process leaves a visible, retryable failure, not a silent replay of an external action.
      tx.update(growthTasks)
        .set({
          status: 'failed',
          error: 'Worker interrupted. Retry this local task.',
          lease: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(growthTasks.status, 'running'),
            lt(growthTasks.updatedAt, now - LEASE_MS),
          ),
        )
        .run();
      // One local inference task across all processes sharing this database.
      if (
        tx
          .select()
          .from(growthTasks)
          .where(eq(growthTasks.status, 'running'))
          .get()
      )
        return undefined;
      const operationTasks = app.operations ? tx.select({ id: products.id }).from(products).where(eq(products.enabled, true)).all().flatMap(product => {
        const state = app.operations!.state(product.id);
        return state.running && state.taskId ? [state.taskId] : [];
      }) : [];
      const urgent = operationTasks.length ? tx.select().from(growthTasks).where(and(
        eq(growthTasks.status, 'queued'), eq(growthTasks.kind, 'marketing'), inArray(growthTasks.id, operationTasks),
        kinds ? inArray(growthTasks.kind, kinds) : undefined,
      )).orderBy(asc(growthTasks.createdAt), asc(growthTasks.id)).get() : undefined;
      const requestedAd = !kinds || kinds.includes('ad-concepts') ? tx.select().from(growthTasks).where(and(
        eq(growthTasks.status, 'queued'), eq(growthTasks.kind, 'ad-concepts'),
      )).orderBy(asc(growthTasks.createdAt), asc(growthTasks.id)).get() : undefined;
      const next = requestedAd ?? urgent ?? tx
        .select()
        .from(growthTasks)
        .where(
          and(
            eq(growthTasks.status, 'queued'),
            kinds ? inArray(growthTasks.kind, kinds) : undefined,
          ),
        )
        .orderBy(asc(growthTasks.createdAt), asc(growthTasks.id))
        .get();
      if (!next) return undefined;
      return tx
        .update(growthTasks)
        .set({ status: 'running', lease, updatedAt: now })
        .where(
          and(eq(growthTasks.id, next.id), eq(growthTasks.status, 'queued')),
        )
        .returning()
        .get();
    });
    if (!task) return false;
    this.controller = new AbortController();
    this.activeTaskId = task.id;
    const config = { ...growthSettings(app), model: agentModel(app, 'growth'), pipelineModel: agentModel(app, 'pipeline') };
    const base =
      this.testLlm ??
      agentClient(app, this.controller.signal);
    const llm = new RecordingLlmClient(base, app.db, runtimeSettings(app).provider, app.clock);
    const owns = () =>
      app.db
        .select()
        .from(growthTasks)
        .where(
          and(
            eq(growthTasks.id, task.id),
            eq(growthTasks.lease, lease),
            eq(growthTasks.status, 'running'),
          ),
        )
        .get();
    let promptVersion: string | null = null;
    let actualModel =
      ['marketing', 'ad-concepts'].includes(task.kind) ? agentModel(app, 'marketing') : task.kind === 'opportunities' ? config.pipelineModel : config.model;
    app.db.update(growthTasks).set({ model: actualModel }).where(eq(growthTasks.id, task.id)).run();
    try {
      const product = app.db
        .select()
        .from(products)
        .where(eq(products.id, task.productId))
        .get();
      if (
        !product?.enabled ||
        !app.config.products.some((p) => p.key === product.key)
      )
        throw new Error('Product retired or removed');
      let output: Record<string, unknown>;
      if (task.kind === 'marketing') {
        output = await runMarketingAgent(app, task.productId, task.id, task.targetId, this.controller.signal, this.testLlm);
      } else if (task.kind === 'ad-concepts') {
        promptVersion = 'ad-director.v1';
        output = await runAdDirector(app, task.productId, task.targetId, task.id, llm, actualModel, this.controller.signal);
      } else if (task.kind === 'studio') {
        promptVersion = 'studio.v1';
        output = await generateCampaign(app, task.productId, task.targetId, task.id, llm, actualModel, this.controller.signal);
      } else if (task.kind === 'opportunities') {
        actualModel = config.pipelineModel;
        output = await this.opportunityStep(llm, config.pipelineModel);
      } else {
        const state = dashboard(app).products.find((p) => p.id === product.id);
        if (!state) throw new Error('Growth plan missing');
        const evidenceRows = app.db
          .select()
          .from(opportunities)
          .where(eq(opportunities.matchedProductId, product.id))
          .orderBy(desc(opportunities.discoveredAt))
          .limit(12)
          .all();
        const evidence = evidenceRows.map((o, index) => ({
          id: `E${index + 1}`,
          title: o.title,
          text: o.body.slice(0, 1000),
          url: o.url,
          discoveredAt: o.discoveredAt,
        }));
        const channel = state.channels.find((c) => c.id === task.targetId);
        const experiment = state.experiments.find(
          (e) => e.id === task.targetId,
        );
        if (task.kind === 'research' && !channel)
          throw new Error('Channel no longer exists');
        if (task.kind === 'campaign' && !experiment)
          throw new Error('Experiment no longer exists');
        const context = {
          product: {
            name: product.name,
            positioning: product.positioning,
            targetBuyer: product.targetBuyer,
            proofPoints: product.proofPoints,
            currency: product.currency,
            ...(product.priceCents > 0
              ? { priceCents: product.priceCents }
              : {}),
            url: product.utmBase,
          },
          goal: state.goal,
          evidence:
            task.kind === 'analysis'
              ? []
              : task.kind === 'campaign'
                ? evidence.slice(0, 3)
                : evidence,
          ...(channel ? { channel } : {}),
          ...(experiment
            ? {
                experiment,
                priorExperiments: state.experiments
                  .filter(
                    (e) =>
                      e.channelId === experiment.channelId &&
                      e.id !== experiment.id &&
                      e.status === 'completed',
                  )
                  .slice(0, 5),
                channel: state.channels.find(
                  (c) => c.id === experiment.channelId,
                ),
              }
            : {}),
          ...(task.kind === 'analysis'
            ? {
                channels: state.channels.map((c) => ({
                  name: c.name,
                  ring: c.ring,
                  hypothesis: c.idea?.hypothesis.slice(0, 400) ?? null,
                  estimatedCostCents: c.idea?.estimatedCostCents ?? null,
                  potentialCustomers: c.idea?.potentialCustomers ?? null,
                  confidence: c.idea?.confidence ?? null,
                })),
                experiments: state.experiments.slice(0, 12),
              }
            : {}),
        };
        const prompt = loadPrompt(`growth-${task.kind}`, 1);
        promptVersion = prompt.version;
        let repair = '';
        let validated: Record<string, unknown> | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          const completion = await llm.complete({
            model: config.model,
            prompt:
              prompt.render({
                context: JSON.stringify(
                  modelContext(context, product.currency),
                ),
              }) + repair,
            maxTokens: task.kind === 'research' ? 3000 : 6000,
            temperature: 0.2,
            expectsJson: true,
            // Keep research and analysis from spending their output budget on
            // hidden reasoning before returning a usable result.
            ...(task.kind !== 'campaign' ? { reasoningEffort: 'none' as const } : {}),
            task: `growth.${task.kind}`,
          });
          actualModel = completion.model;
          if (
            completion.stopReason === 'length' ||
            completion.stopReason === 'max_tokens'
          )
            throw new Error(
              'Model output was truncated; choose a model that can finish this task',
            );
          try {
            const raw = extractJson<unknown>(completion.text);
            if (task.kind === 'research') {
              const idea = ideaSchema.parse(raw);
              if (
                idea.evidenceIds.some(
                  (id) => !evidence.some((e) => e.id === id),
                )
              )
                throw new Error(
                  `Model cited evidence outside the supplied sources. Allowed evidenceIds: ${evidence.map((e) => e.id).join(', ') || 'none; return []'}.`,
                );
              validated = {
                ...idea,
                evidenceIds: idea.evidenceIds.map(
                  (id) =>
                    evidenceRows[evidence.findIndex((e) => e.id === id)]!.id,
                ),
              };
            } else if (task.kind === 'campaign') {
              const asset = assetSchema.parse(raw);
              if (
                checkDisclosure(asset.body, [
                  { key: product.key, name: product.name },
                ]).violation
              )
                throw new Error(
                  'Campaign is missing founder affiliation disclosure. Retry or choose a stronger model.',
                );
              if (
                /\]\(\s*#\s*\)|\{\{|\[insert\b|example\.(?:com|invalid)/i.test(
                  asset.body,
                )
              )
                throw new Error(
                  'Campaign contains placeholder content. Retry or choose a stronger model.',
                );
              if (!experiment || !asset.body.includes(experiment.trackedUrl))
                throw new Error(
                  'Campaign omitted its experiment URL. Retry the draft.',
                );
              assertGroundedMoney(asset, context, product.currency);
              validated = asset;
            } else {
              const analysis = analysisSchema.parse(raw);
              assertGroundedMoney(analysis, context, product.currency);
              validated = analysis;
            }
            break;
          } catch (error) {
            if (attempt === 1 || !owns()) throw error;
            repair =
              '\n' +
              loadPrompt('growth-repair', 1).render({
                error: String(error).slice(0, 2000),
                response: JSON.stringify(completion.text).slice(0, 14000),
              });
          }
        }
        if (!validated)
          throw new Error('Model output did not satisfy the task contract');
        output = validated;
      }
      app.db.transaction((tx) => {
        if (!owns()) return; // Cancellation or another lease makes this output obsolete.
        if (task.kind === 'research')
          tx.update(growthChannels)
            .set({ idea: ideaSchema.parse(output), updatedAt: app.clock.now() })
            .where(eq(growthChannels.id, task.targetId))
            .run();
        tx.update(growthTasks)
          .set({
            status: 'done',
            output,
            model: actualModel,
            promptVersion,
            error: null,
            lease: null,
            updatedAt: app.clock.now(),
          })
          .where(eq(growthTasks.id, task.id))
          .run();
      });
    } catch (error) {
      if (owns())
        app.db
          .update(growthTasks)
          .set({
            status: 'failed',
            error:
              error instanceof Error
                ? (error.name === 'TimeoutError'
                    ? 'The model did not respond before the time limit. Check Settings and Goals & runtime, then retry this task.'
                    : error.message === 'fetch failed'
                      ? 'Cannot reach the configured model provider. Check Settings and Goals & runtime, then retry this task.'
                      : error.message).slice(0, 1800)
                : String(error),
            model: actualModel,
            promptVersion,
            lease: null,
            updatedAt: app.clock.now(),
          })
          .where(eq(growthTasks.id, task.id))
          .run();
    } finally {
      this.controller = null;
      this.activeTaskId = null;
    }
    return true;
  }

  private async opportunityStep(
    llm: LlmClient,
    model: string,
  ): Promise<Record<string, unknown>> {
    const app = this.app;
    // One bounded step per task, so local inference cannot hold the worker indefinitely.
    const scored = app.db
      .select()
      .from(opportunities)
      .where(eq(opportunities.status, 'scored'))
      .get();
    if (scored) {
      const result = await runDrafting(
        app.db,
        llm,
        { draftModel: model, maxOutputTokens: app.config.llm.maxOutputTokens },
        app.logger,
        { limit: 1, clock: app.clock },
      );
      if (result.failed.length)
        throw new Error(result.failed.map((f) => f.error).join('; '));
      return {
        summary: `Drafted ${result.drafted.length}; skipped ${result.skipped.length}. Replies are in the review queue.`,
        ...result,
      };
    }
    const pending = app.db
      .select()
      .from(opportunities)
      .where(inArray(opportunities.status, ['new', 'rules_unknown']))
      .limit(50)
      .all();
    for (const item of pending) {
      if (!item.communityId) continue;
      const community = app.db
        .select()
        .from(communities)
        .where(eq(communities.id, item.communityId))
        .get();
      if (!community || community.blockedAt != null) continue;
      const rule = getRule(app.db, community.id);
      if (!rule || isStale(rule, app.clock)) {
        const fetcher = app.rulesFetchers.get(community.platform);
        if (!fetcher?.available().ready) continue;
        const result = await refreshRules(
          app.db,
          community,
          fetcher,
          llm,
          model,
          app.logger,
          app.clock,
        );
        if (result.status === 'error') throw new Error(result.detail);
        return {
          summary: `Rules: ${community.displayName}. ${result.status}`,
          ...result,
        };
      }
    }
    const result = await runScoring(
      app.db,
      llm,
      {
        classifierModel: model,
        ...app.config.scoring,
        cooldownDays: app.config.publishLimits.communityCooldownDays,
        ratioCapPct: app.config.publishLimits.selfPromoRatioMaxPct,
        ratioWindow: app.config.publishLimits.selfPromoRatioWindow,
      },
      app.logger,
      { limit: 1, clock: app.clock },
    );
    if (result.failed.length)
      throw new Error(result.failed.map((f) => f.error).join('; '));
    return {
      summary: `Scored ${result.scored.length} opportunities.`,
      ...result,
    };
  }
}
