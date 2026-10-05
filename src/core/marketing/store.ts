import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { fundingView } from '../revenue/funding.js';
import type { App } from '../app.js';
import { dashboard, initializeGrowth, queueTask } from '../growth/store.js';
import { newId } from '../lib/id.js';
import { engineeringRequests, growthTasks, marketingCash, marketingCommitments, marketingDrafts, marketingEdges, marketingMedia, marketingMemory, marketingMessages, marketingToolCalls, marketingWorkflows, products, settings } from '../db/schema.js';
import { marketingSettingsSchema, memoryInputSchema, requestInputSchema, type BudgetView, type MarketingSettings, type MarketingView } from '../../shared/marketing.js';

const KEY = 'marketing.operator.v1';
export const DEFAULT_MARKETING: MarketingSettings = {
  model: 'qwen3.5:9b',
  enabled: false, intervalHours: 6, voice: 'Warm, direct and useful. Use short sentences, concrete details and natural contractions. Answer the person’s actual question first. No hype, fake testimonials, invented firsthand experience or made-up employee identity. In public drafts, disclose that we build the product when relevant.',
  reinvestPct: 10, reserveCents: 0, capCents: 2500,
  comfyUrl: 'http://127.0.0.1:8188', searxUrl: '',
};
export function marketingSettings(app: App): MarketingSettings {
  const row = app.db.select().from(settings).where(eq(settings.key, KEY)).get();
  return row ? marketingSettingsSchema.parse(row.value) : { ...DEFAULT_MARKETING };
}
export function saveMarketingSettings(app: App, input: unknown): void {
  const value = marketingSettingsSchema.parse(input);
  app.db.insert(settings).values({ key: KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: app.clock.now() } }).run();
}
export function requireProduct(app: App, productId: string) {
  const p = app.db.select().from(products).where(eq(products.id, productId)).get();
  if (!p?.enabled || !app.config.products.some((c) => c.key === p.key)) throw new Error('Unknown product');
  return p;
}
export function remember(app: App, productId: string, input: unknown): string {
  requireProduct(app, productId);
  const value = memoryInputSchema.parse(input);
  return app.db.transaction((tx) => {
    const duplicate = tx.select().from(marketingMemory).where(and(eq(marketingMemory.productId, productId), eq(marketingMemory.body, value.body), eq(marketingMemory.status, 'active'))).get();
    if (duplicate) return duplicate.id;
    if (value.supersedesId) {
      const old = tx.select().from(marketingMemory).where(and(eq(marketingMemory.id, value.supersedesId), eq(marketingMemory.productId, productId), eq(marketingMemory.status, 'active'))).get();
      if (!old) throw new Error('Memory to correct is not active in this product');
      tx.update(marketingMemory).set({ status: 'superseded' }).where(eq(marketingMemory.id, old.id)).run();
    }
    const id = newId();
    tx.insert(marketingMemory).values({ ...value, id, productId, createdAt: app.clock.now() }).run();
    const root = tx.select().from(marketingMemory).where(and(eq(marketingMemory.productId, productId), eq(marketingMemory.kind, 'product'), eq(marketingMemory.status, 'active'))).get();
    if (root && root.id !== id) tx.insert(marketingEdges).values({ id: newId(), productId, fromId: root.id, toId: id, relation: 'describes' }).onConflictDoNothing().run();
    if (value.supersedesId) tx.insert(marketingEdges).values({ id: newId(), productId, fromId: id, toId: value.supersedesId, relation: 'supersedes' }).run();
    return id;
  });
}
export function recall(app: App, productId: string, query: string) {
  requireProduct(app, productId);
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)?.slice(0, 12) ?? [];
  // Product-scoped lexical retrieval plus one graph hop; bounded on local data.
  const rows = app.db.select().from(marketingMemory).where(and(eq(marketingMemory.productId, productId), eq(marketingMemory.status, 'active'))).orderBy(desc(marketingMemory.createdAt)).limit(1000).all();
  const ranked = rows.map((m) => ({ m, score: terms.reduce((n, t) => n + (m.title.toLowerCase().includes(t) ? 3 : 0) + (m.body.toLowerCase().includes(t) ? 1 : 0), 0) })).sort((a, b) => b.score - a.score).slice(0, 8).map((x) => x.m);
  const ids = new Set(ranked.map((m) => m.id));
  const edges = app.db.select().from(marketingEdges).where(eq(marketingEdges.productId, productId)).all().filter((e) => ids.has(e.fromId) || ids.has(e.toId));
  const connected = new Set(edges.flatMap((e) => [e.fromId, e.toId]));
  return { memories: [...ranked, ...rows.filter((m) => connected.has(m.id) && !ids.has(m.id)).slice(0, 4)], edges: edges.slice(0, 20) };
}
export function addEngineeringRequest(app: App, productId: string, input: unknown) {
  requireProduct(app, productId);
  const value = requestInputSchema.parse(input);
  const fingerprint = createHash('sha256').update(value.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')).digest('hex');
  const existing = app.db.select().from(engineeringRequests).where(and(eq(engineeringRequests.productId, productId), eq(engineeringRequests.fingerprint, fingerprint))).get();
  if (existing) return { id: existing.id, duplicate: true };
  const id = newId();
  app.db.transaction((tx) => {
    tx.insert(engineeringRequests).values({ id, productId, fingerprint, value, createdAt: app.clock.now() }).run();
    remember(app, productId, { title: value.title, body: `Engineering proposal: ${value.problem}\n${value.rationale}\nSuccess metric: ${value.metric}`, kind: 'hypothesis', source: `engineering:${id}`, confidence: 0.4 });
  });
  return { id, duplicate: false };
}
export function budget(app: App, productId: string): BudgetView {
  requireProduct(app, productId);
  const policy = marketingSettings(app);
  const cash = app.db.select().from(marketingCash).where(eq(marketingCash.productId, productId)).all();
  const funding = fundingView(app, productId);
  const surplusCents = funding.policy ? funding.eligibleCents : Math.max(0, cash.reduce((n, r) => n + (r.kind === 'settled_surplus' ? r.amountCents : r.kind === 'adjustment' ? -r.amountCents : 0), 0));
  const allocationCents = funding.policy ? Math.max(0, funding.allocationCents - cash.filter(r => r.kind === 'adjustment').reduce((sum, r) => sum + r.amountCents, 0)) : Math.min(policy.capCents, Math.floor(Math.max(0, surplusCents - policy.reserveCents) * policy.reinvestPct / 100));
  const spentCents = cash.filter((r) => r.kind === 'spend').reduce((n, r) => n + r.amountCents, 0);
  const committedCents = app.db.select().from(marketingCommitments).where(and(eq(marketingCommitments.productId, productId), eq(marketingCommitments.status, 'reserved'))).all().reduce((n, r) => n + r.amountCents, 0);
  const availableCents = Math.max(0, allocationCents - spentCents - committedCents);
  if (funding.policy) return { surplusCents, allocationCents, spentCents, committedCents, availableCents, tier: availableCents > 0 ? 'funded-tests' : 'bootstrap', explanation: funding.blockers.length ? funding.blockers.join(' ') : 'Sales-funded test allowance after the saved reserve and deductions. Prior spend and reservations reduce what remains. Manual surplus credits are excluded. This is not profit, a bank balance, or permission to launch an ad.' };
  const state = dashboard(app).products.find((p) => p.id === productId)!;
  const winners = state.experiments.filter((e) => e.status === 'completed' && e.evaluation.verdict === 'promising');
  const repeatable = winners.some((e) => winners.filter((w) => w.channelId === e.channelId).length >= 2);
  const tier = availableCents > 0 && winners.length ? repeatable ? 'repeatable' : 'funded-tests' : winners.length ? 'organic' : 'bootstrap';
  return { surplusCents, allocationCents, spentCents, committedCents, availableCents, tier,
    explanation: tier === 'bootstrap' ? 'Start with zero-cash work. A completed promising test is needed before paid experiments.' : tier === 'organic' ? 'An organic test met its goals. Keep cash spending at zero until settled surplus funds it.' : tier === 'funded-tests' ? 'Recorded surplus can fund bounded tests. Reserve a concrete amount before execution.' : 'Repeated promising tests and available surplus support measured expansion; affordability is recalculated after every adjustment.' };
}
export function enforceMarketingBudget(app: App, productId: string, costCents: number): void {
  if (costCents <= 0 || !app.db.select().from(settings).where(eq(settings.key, 'marketing.bootstrap.v1')).get()) return;
  const funds = budget(app, productId);
  if (['bootstrap', 'organic'].includes(funds.tier) || costCents > funds.availableCents) throw new Error('This test needs cash that the current marketing tier has not earned. Choose a zero-cash test or record settled surplus and measured outcomes in Cash & tiers.');
}
export function reserveGrowthTest(app: App, productId: string, experimentId: string, costCents: number): void {
  if (costCents <= 0 || !app.db.select().from(settings).where(eq(settings.key, 'marketing.bootstrap.v1')).get()) return;
  const existing = app.db.select().from(marketingCommitments).where(and(eq(marketingCommitments.productId, productId), eq(marketingCommitments.reference, experimentId), eq(marketingCommitments.status, 'reserved'))).get();
  const funds = budget(app, productId);
  if (existing) {
    if (existing.amountCents < costCents || funds.spentCents + funds.committedCents > funds.allocationCents) throw new Error('This reserved experiment is no longer fully funded');
    return;
  }
  enforceMarketingBudget(app, productId, costCents);
  app.db.insert(marketingCommitments).values({ id: newId(), productId, reference: experimentId, amountCents: costCents, note: 'Estimated cost reserved when the test clock started; no payment was made.' }).run();
}
export function queueMarketing(app: App, productId: string, message: string) {
  requireProduct(app, productId);
  const id = newId();
  const taskId = queueTask(app, productId, 'marketing', id)!;
  app.db.insert(marketingMessages).values({ id, productId, role: 'user', body: message, taskId, createdAt: app.clock.now() }).run();
  return taskId;
}
export function scheduleMarketing(app: App): void {
  const config = marketingSettings(app);
  if (!config.enabled) return;
  for (const p of dashboard(app).products) {
    if (app.operations?.state(p.id).running) continue;
    const latest = app.db.select().from(growthTasks).where(and(eq(growthTasks.productId, p.id), eq(growthTasks.kind, 'marketing'))).orderBy(desc(growthTasks.createdAt)).get();
    if (latest && (['queued', 'running'].includes(latest.status) || app.clock.now() - latest.createdAt < config.intervalHours * 3600000)) continue;
    queueMarketing(app, p.id, 'Run our next marketing cycle. Use memory and available evidence, pick the highest-value zero-cash action, produce something useful, and add an engineering request only if it unlocks a concrete experiment. Do not repeat completed work. Respect the current budget tier.');
  }
}
export function initializeMarketing(app: App): void {
  initializeGrowth(app);
  const marker = 'marketing.bootstrap.v1';
  if (app.db.select().from(settings).where(eq(settings.key, marker)).get()) return;
  app.db.transaction((tx) => {
    for (const p of dashboard(app).products) {
      const config = requireProduct(app, p.id);
      const current = app.config.products.find((item) => item.key === config.key)!;
      tx.update(products).set({ positioning: current.positioning, targetBuyer: current.targetBuyer, proofPoints: current.proofPoints }).where(eq(products.id, p.id)).run();
      const lemon = config.key === 'lemonade';
      remember(app, p.id, { kind: 'product', title: `${p.name}: public product positioning`, body: lemon
        ? 'Local AI desktop assistant for Windows and Linux. Works with local files and models. $49 perpetual license with a 14-day trial. No behavioral telemetry; use voluntary attribution and checkout records. Public website claims must be checked before quoting specifics.'
        : 'Browser-based AI video production workspace: storyboarding, character creation, generation, timeline editing and collaborative review. 3D scene creator is beta. Free offer includes one project and watermarked 720p exports. Verify current pricing and entitlements before quoting them.', source: config.utmBase, confidence: 0.9 });
      remember(app, p.id, { kind: 'preference', title: 'No financial runway', body: 'The founder has no financial runway. Start at zero cash. Never invent revenue or treat gross sales, model forecasts, free credits or experiment estimates as spendable cash. Use recorded settled surplus after fees, refunds, fulfillment costs and obligations. Keep customer responses specific, truthful and useful.', source: 'Founder instruction, 2026-09-08', confidence: 1 });
      remember(app, p.id, { kind: 'lesson', title: 'Bullseye operating method', body: 'Consider all 19 channels, run at most three affordable tests, measure customer acquisition cost, volume and fit, then focus on a measured winner. Cash tiers are Signal’s conservative adaptation, not thresholds prescribed by Traction. Founder learning and useful demonstrations come before paid scale.', source: 'https://mixergy.com/interviews/gabriel-weinberg-traction/', confidence: 0.9 });
      addEngineeringRequest(app, p.id, { title: 'Verify campaign-to-purchase attribution', problem: 'We need evidence of which small test produces paying customers before increasing spend. Existing implementation needs an engineering audit.', rationale: 'Conversion evidence unlocks learning without paid acquisition.', acceptance: ['Audit current checkout attribution before adding new code.', 'Preserve campaign/referral metadata through a qualifying purchase and deduplicate order IDs.', 'Account for refunds and distinguish settled surplus from gross sales.', lemon ? 'Preserve the promise of no behavioral telemetry; use voluntary source answers or checkout metadata.' : 'Measure consented activation milestones and aggregate purchase outcomes.'], evidence: [config.utmBase, 'https://support.google.com/analytics/answer/10917952'], workaround: 'Record campaign source and anonymized order reference manually in Signal.', metric: 'Purchases attributed to completed experiments', priority: 'now', channelKey: 'engineering' });
      addEngineeringRequest(app, p.id, { title: 'Affiliate pilot and referral ledger', problem: 'An affiliate channel needs partner interest and trustworthy purchase attribution; we have not established either for this pilot.', rationale: 'Validate a few willing partners before building a broad affiliate platform.', acceptance: ['Confirm partner interest and approved commission terms first.', 'Keep referral identity through checkout with duplicate and self-referral checks.', 'Reverse commissions on refunds; pay only under approved settlement terms.', 'Include clear affiliation disclosures.'], evidence: ['Founder requested evaluating an affiliate system', 'https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers'], workaround: 'Use a few unique referral links and a manually reconciled ledger.', metric: 'Net contribution from referred qualifying purchases', priority: 'later', channelKey: 'affiliates' });
    }
    tx.insert(settings).values({ key: marker, value: true }).run();
  });
}
export function marketingView(app: App): MarketingView {
  initializeMarketing(app);
  return {
    settings: marketingSettings(app), products: dashboard(app).products.map((p) => ({ id: p.id, name: p.name, currency: p.currency, url: requireProduct(app, p.id).utmBase, budget: budget(app, p.id) })),
    messages: app.db.select().from(marketingMessages).orderBy(desc(marketingMessages.createdAt), desc(sql`rowid`)).limit(150).all().reverse(),
    memories: app.db.select().from(marketingMemory).orderBy(desc(marketingMemory.createdAt)).limit(1000).all(),
    edges: app.db.select().from(marketingEdges).all(), requests: app.db.select().from(engineeringRequests).orderBy(desc(engineeringRequests.createdAt)).all(),
    drafts: app.db.select().from(marketingDrafts).orderBy(desc(marketingDrafts.createdAt)).limit(200).all(), cash: app.db.select().from(marketingCash).orderBy(desc(marketingCash.createdAt)).all(),
    commitments: app.db.select().from(marketingCommitments).all(), tools: app.db.select().from(marketingToolCalls).orderBy(desc(marketingToolCalls.createdAt)).limit(100).all(),
    workflows: app.db.select({ id: marketingWorkflows.id, productId: marketingWorkflows.productId, name: marketingWorkflows.name }).from(marketingWorkflows).all(),
    media: app.db.select().from(marketingMedia).orderBy(desc(marketingMedia.createdAt)).limit(100).all(),
    tasks: app.db.select({ id: growthTasks.id, productId: growthTasks.productId, status: growthTasks.status, error: growthTasks.error, updatedAt: growthTasks.updatedAt }).from(growthTasks).where(eq(growthTasks.kind, 'marketing')).orderBy(desc(growthTasks.createdAt)).limit(100).all(),
  };
}
export function hasPendingMedia(app: App): boolean {
  return Boolean(app.video?.agentBusy() || app.operations?.imageBusy?.() || app.db.select().from(marketingMedia).where(inArray(marketingMedia.status, ['queued', 'running', 'submitting'])).get());
}
