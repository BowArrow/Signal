import { eq, like, and, inArray } from 'drizzle-orm';
import type { App } from '../app.js';
import { growthTasks, products, settings } from '../db/schema.js';
import { queueMarketing, requireProduct } from '../marketing/store.js';
import { newId } from '../lib/id.js';
import { h3EstimateCents } from '../../shared/video-budget.js';
import { videoCampaignPolicySchema, type VideoCampaignCycle, type VideoCampaignPolicy, type VideoCampaignStatus, type VideoCampaignView } from '../../shared/video-campaigns.js';

const POLICY = 'video.campaign.policy.', CYCLE = 'video.campaign.cycle.';
const PAUSED = 'Automatic video production is paused for this business.';
export class VideoCampaignService {
  constructor(private readonly app: App) {}
  private rows<T>(prefix: string) { return this.app.db.select().from(settings).where(like(settings.key, prefix + '%')).all().map(r => r.value as T); }
  private put(key: string, value: unknown) { this.app.db.insert(settings).values({ key, value, updatedAt: this.app.clock.now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: this.app.clock.now() } }).run(); }
  policy(productId: string): VideoCampaignPolicy {
    const product = requireProduct(this.app, productId);
    return this.rows<VideoCampaignPolicy>(POLICY).find(p => p.productId === productId) ?? { productId, enabled: false, intervalHours: 24, objective: `Show one customer problem that ${product.name} solves, then invite viewers to see the product.` };
  }
  configure(productId: string, input: unknown) {
    requireProduct(this.app, productId); const policy = videoCampaignPolicySchema.parse(input);
    this.app.operations?.pause(productId);
    this.put(POLICY + productId, { ...policy, productId });
  }
  cycles() { return this.rows<VideoCampaignCycle>(CYCLE).sort((a, b) => b.createdAt - a.createdAt); }
  taskContext(productId: string, taskId: string) {
    const cycle = this.cycles().find(c => c.productId === productId && [c.shotTaskId, c.adTaskId].includes(taskId));
    return cycle ? { cycleId: cycle.id, action: cycle.adTaskId === taskId ? 'video.assemble' as const : 'video.create' as const, objective: cycle.objective, shotId: this.app.video?.jobs().find(j => j.productId === productId && j.sourceTaskId === cycle.shotTaskId)?.id } : undefined;
  }
  assertTaskMayRun(productId: string, taskId: string) {
    if (this.taskContext(productId, taskId) && (!this.policy(productId).enabled || !this.app.operations?.state(productId).running)) throw new Error(PAUSED);
  }
  setup(productId: string): { ready: boolean; detail: string } {
    const video = this.app.video; if (!video) return { ready: false, detail: 'Video production is unavailable.' };
    const view = video.view(), budget = video.cloudBudget();
    if (view.config.renderer !== 'cloud' || !view.config.agentCloudEnabled) return { ready: false, detail: 'Select MiniMax cloud and enable budgeted agent shots in Rendering setup.' };
    if (!view.minimaxConnected) return { ready: false, detail: 'Save a MiniMax API key in Rendering setup.' };
    if (!view.blenderReady || !view.ffmpegReady) return { ready: false, detail: 'Choose Blender and FFmpeg in Rendering setup.' };
    if (!view.config.agentDailyLimit || !view.config.dailyCloudLimit || budget.limitCents < h3EstimateCents(5) || budget.maxShotCents < h3EstimateCents(5)) return { ready: false, detail: 'Allow agent/cloud jobs and set budgets that cover a five-second H3 shot and its guide.' };
    if (!video.characters().some(c => c.productId === productId && c.reference && c.approvedAt)) return { ready: false, detail: 'Import and approve a character reference for this business.' };
    return { ready: true, detail: 'Run can plan cloud shots and assemble approved footage. Full playback approval is required before editing a generated clip and before publishing the finished ad.' };
  }
  status(productId: string): VideoCampaignStatus {
    const policy = this.policy(productId), setup = this.setup(productId);
    const base = { productId, enabled: policy.enabled, ...setup };
    if (!policy.enabled) return { ...base, detail: 'Automatic video production is off.' };
    const cycle = this.cycles().find(c => c.productId === productId);
    if (!cycle) {
      const budget = this.app.video?.cloudBudget();
      const exhausted = budget && budget.attemptedCents + h3EstimateCents(5) > budget.limitCents;
      return { ...base, detail: !setup.ready ? setup.detail : exhausted ? 'Waiting for room in the rolling daily H3 budget.' : 'Ready for the first video cycle when this business is running.' };
    }
    const jobs = this.app.video!.jobs();
    const shot = jobs.find(j => j.productId === productId && j.sourceTaskId === cycle.shotTaskId);
    const ad = cycle.adTaskId && jobs.find(j => j.productId === productId && j.sourceTaskId === cycle.adTaskId);
    const detail = cycle.completedAt ? 'Finished ad approved. Its YouTube policy controls publishing; the next production cycle follows the saved interval.'
      : ad ? (ad.approvedAt ? 'Finished ad approved.' : ad.output ? 'Play and approve the finished ad in Video production.' : ad.detail)
      : cycle.adTaskId ? this.taskDetail(cycle.adTaskId, 'The agent is assembling the approved clip into an ad.')
      : shot ? (shot.output && !shot.approvedAt ? 'Play and approve the generated clip before the agent assembles the ad.' : shot.approvedAt ? 'Approved clip ready for ad assembly on Run.' : shot.detail)
      : this.taskDetail(cycle.shotTaskId, 'The agent is researching and directing the first shot.');
    return { ...base, cycle, detail, ...(shot ? { shotId: shot.id } : {}), ...(ad ? { adId: ad.id } : {}) };
  }
  private taskDetail(id: string, pending: string) {
    const task = this.app.db.select().from(growthTasks).where(eq(growthTasks.id, id)).get();
    if (task?.status === 'failed' && task.error === PAUSED) return 'Planning paused. Run resumes the original task.';
    return !task || !['queued', 'running'].includes(task.status) ? 'The planning task ended without the required video job. Review its tool activity; this cycle will not create replacement renders automatically.' : pending;
  }
  view(): VideoCampaignView {
    const businesses = this.app.db.select().from(products).where(eq(products.enabled, true)).all();
    return { policies: businesses.map(p => this.policy(p.id)), statuses: businesses.map(p => this.status(p.id)) };
  }
  schedule() {
    if (this.app.env.SIGNAL_OFFLINE === '1' || !this.app.video) return;
    this.app.db.transaction(() => {
      for (const policy of this.rows<VideoCampaignPolicy>(POLICY).filter(p => p.enabled)) {
        const business = this.app.db.select().from(products).where(and(eq(products.id, policy.productId), eq(products.enabled, true))).get();
        if (!business || !this.app.operations?.state(policy.productId).running) continue;
        const current = this.cycles().find(c => c.productId === policy.productId);
        const pendingTask = current && this.app.db.select().from(growthTasks).where(eq(growthTasks.id, current.adTaskId ?? current.shotTaskId)).get();
        if (pendingTask?.status === 'failed' && pendingTask.error === PAUSED) {
          this.app.db.update(growthTasks).set({ status: 'queued', error: null, lease: null, updatedAt: this.app.clock.now() }).where(eq(growthTasks.id, pendingTask.id)).run(); continue;
        }
        const jobs = this.app.video!.jobs();
        const ad = current?.adTaskId && jobs.find(j => j.productId === policy.productId && j.sourceTaskId === current.adTaskId);
        if (current && ad && ad.output && ad.approvedAt && !current.completedAt) { this.put(CYCLE + current.id, { ...current, completedAt: this.app.clock.now() }); continue; }
        if (this.app.db.select().from(growthTasks).where(and(eq(growthTasks.productId, policy.productId), eq(growthTasks.kind, 'marketing'), inArray(growthTasks.status, ['queued', 'running']))).get()) continue;
        if (this.app.video!.context(policy.productId).agentSlotsRemaining < 1) continue;
        if (current && !current.completedAt) {
          const shot = jobs.find(j => j.productId === policy.productId && j.sourceTaskId === current.shotTaskId);
          if (current.adTaskId || !shot?.output || !shot.approvedAt || shot.phase !== 'ready') continue;
          const adTaskId = queueMarketing(this.app, policy.productId, `Automatic video production: assemble the approved clip ${shot.id} into one finished ad using video.assemble. Inspect current product facts first. Objective: ${JSON.stringify(current.objective)}. Use this business's website, a truthful headline and a concrete call to action. Use only approved footage. If local narration is ready, include a short script in an available stock voice; keep it within the edit's duration. Do not publish or claim sales. Save exactly one ad job; playback approval follows.`);
          this.put(CYCLE + current.id, { ...current, adTaskId }); continue;
        }
        if (current && this.app.clock.now() - current.createdAt < policy.intervalHours * 3600000) continue;
        if (!this.setup(policy.productId).ready) continue;
        const budget = this.app.video!.cloudBudget(); if (budget.attemptedCents + h3EstimateCents(5) > budget.limitCents) continue;
        const id = newId();
        const shotTaskId = queueMarketing(this.app, policy.productId, `Automatic video production: inspect current product facts and use video.create to direct one five-second character shot. Objective: ${JSON.stringify(policy.objective)}. Use approved characters from this business's video context. Show a specific customer problem with clear physical action. Preserve the story bible. Do not synthesize product interfaces, invent capabilities or make unsupported outcome claims. Cloud H3 rendering uses the saved budget and Run/Pause policy. Save exactly one shot job, then finish; full playback review follows.`);
        this.put(CYCLE + id, { id, productId: policy.productId, objective: policy.objective, createdAt: this.app.clock.now(), shotTaskId });
      }
    }, { behavior: 'immediate' });
  }
}
