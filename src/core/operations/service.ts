import { createHash, randomBytes } from 'node:crypto';
import twitterText from 'twitter-text';
import { and, eq, like } from 'drizzle-orm';
import type { App } from '../app.js';
import { growthTasks, marketingToolCalls, marketingMedia, marketingWorkflows, products, settings } from '../db/schema.js';
import { initializeMarketing, queueMarketing, requireProduct } from '../marketing/store.js';
import { copyWarnings } from '../studio/store.js';
import { hasDisclosure } from '../guardrails/disclosure.js';
import { newId } from '../lib/id.js';
import { DELIVERY_PROVIDERS, hasPublishingPermission, deliveryInputSchema, operationPolicySchema, type Delivery, type OperationPolicy, type OperationState, type OperationsView } from '../../shared/operations.js';
import { DeliveryError } from './delivery.js';
import { imageWorkflow } from './images.js';
import { chooseOperation } from './learning.js';
import { operationReadiness } from './readiness.js';
import { agentModel } from '../runtime/client.js';
import { BRAND_CARD_WORKFLOW } from '../../shared/brand-card.js';
import { DemandDiscovery } from './discovery.js';
import { generationClaimWarnings } from './claims.js';
import { acquisitionCycle, assessAcquisition } from './acquisition.js';
import { blueskyReferenceSchema } from './bluesky-discovery.js';
import type { LlmClient } from '../llm/client.js';
import { acquisitionDueAt } from '../../shared/acquisition-cadence.js';
import { requireNaturalReply, lacksReplyContext } from '../marketing/voice.js';
import { ConversationTracker } from './conversations.js';
import { deliveryCapacity } from '../../shared/delivery-capacity.js';
import { buyerIntent } from '../../shared/buyer-intent.js';

const STATE = 'operations.policy.';
const JOB = 'operations.delivery.';
const DAY = 86400000;
const supported = (provider: string) => (DELIVERY_PROVIDERS as readonly string[]).includes(provider);
const fingerprint = (body: string) => createHash('sha256').update(body.toLowerCase().replace(/https:\/\/\S+/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()).digest('hex');
export class OperationsService {
  private active: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private activeProduct: string | null = null;
  private startRevisions = new Map<string, number>();
  readonly discovery: DemandDiscovery;
  readonly conversations: ConversationTracker;
  constructor(private readonly app: App) { this.discovery = new DemandDiscovery(app); this.conversations = new ConversationTracker(app, () => this.deliveries()); }
  private get<T>(key: string): T | undefined { return this.app.db.select().from(settings).where(eq(settings.key, key)).get()?.value as T | undefined; }
  private put(key: string, value: unknown) { this.app.db.insert(settings).values({ key, value, updatedAt: this.app.clock.now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: this.app.clock.now() } }).run(); }
  state(productId: string): OperationState {
    const product = requireProduct(this.app, productId);
    return this.get<OperationState>(STATE + productId) ?? { productId, objective: `Help ${product.name}'s target buyers solve a specific problem and start a trial. Use verified product facts and measure which campaign brings customers.`, accountIds: [], intervalHours: 24, dailyLimit: 1, running: false, revision: 0, authorizedAt: null, lastCycleAt: null, taskId: null };
  }
  deliveries(): Delivery[] { return this.app.db.select().from(settings).where(like(settings.key, `${JOB}%`)).all().map(row => row.value as Delivery).sort((a, b) => b.createdAt - a.createdAt); }
  imageBusy() { return this.deliveries().some(j => j.status === 'queued' && j.image && j.image.phase !== 'ready' && j.leaseUntil > this.app.clock.now()); }
  imagePreview(productId: string, id: string) { const job = this.job(productId, id); if (!this.app.operationImages) throw new Error('Image preview is unavailable.'); return `data:image/jpeg;base64,${this.app.operationImages.read(job.image?.asset).toString('base64')}`; }
  view(): OperationsView {
    initializeMarketing(this.app);
    const businesses = this.app.db.select().from(products).where(eq(products.enabled, true)).all();
    return { outreachActivity: businesses.flatMap(p => this.app.outreach ? [this.app.outreach.activity(p.id)] : []), conversations: this.conversations.view(), acquisitionQueue: businesses.filter(p => this.state(p.id).mode === 'acquisition').map(p => { const state = this.state(p.id), candidates = this.discovery.context(state); return { productId: p.id, count: candidates.length, nextAt: acquisitionDueAt(state, acquisitionCycle(this.app, p.id), candidates.map(f => f.id), this.completedAcquisitionAt(state)) }; }), acquisition: businesses.flatMap(p => { const cycle = acquisitionCycle(this.app, p.id); return cycle ? [cycle] : []; }), discovery: businesses.filter(p => this.state(p.id).discovery?.enabled).map(p => this.discovery.snapshot(this.state(p.id))), readiness: businesses.map(p => this.readiness(p.id)), prospectSources: this.app.prospects?.sources().map(s => ({ productId: s.productId, audienceName: s.audienceName, enabled: s.enabled, status: s.status, provider: s.provider ?? 'mailchimp' })) ?? [], outreachPolicies: businesses.map(p => ({ productId: p.id, enabled: this.app.outreach?.policy(p.id).enabled ?? false, dailyLimit: this.app.outreach?.policy(p.id).dailyLimit ?? 0, followUpDays: this.app.outreach?.policy(p.id).followUpDays ?? [] })), imageWorkflows: businesses.map(p => ({ id: BRAND_CARD_WORKFLOW, productId: p.id, name: 'Branded card ? local layout' })).concat(this.app.db.select().from(marketingWorkflows).all().filter(w => { try { imageWorkflow(this.app, w.productId, w.id); return true; } catch { return false; } }).map(w => ({ id: w.id, productId: w.productId, name: w.name }))), handoffs: businesses.map(p => ({ productId: p.id, ...(this.app.salesHandoffs?.summary(p.id) ?? { open: 0, due: 0, waiting: 0, uncertain: 0 }) })), ...(this.app.runtimeSupervisor ? { runtimeHealth: this.app.runtimeSupervisor.view() } : {}), emailReplies: businesses.map(p => ({ productId: p.id, enabled: this.app.salesReplies?.policy(p.id).enabled ?? false, dailyLimit: this.app.salesReplies?.policy(p.id).dailyLimit ?? 0, followUpDays: this.app.salesReplies?.policy(p.id).followUpDays ?? [] })), products: businesses.map(p => ({ id: p.id, name: p.name })), states: businesses.map(p => this.state(p.id)), accounts: this.app.connections?.accounts().filter(a => supported(a.provider)) ?? [], deliveries: this.deliveries().slice(0, 300), tasks: this.app.db.select({ id: growthTasks.id, productId: growthTasks.productId, status: growthTasks.status, error: growthTasks.error }).from(growthTasks).where(eq(growthTasks.kind, 'marketing')).all(), offline: this.app.env.SIGNAL_OFFLINE === '1' };
  }
  configure(productId: string, value: OperationPolicy) {
    const policy = operationPolicySchema.parse(value); this.validateAccounts(productId, policy.accountIds);
    if (policy.imageWorkflowId) {
      imageWorkflow(this.app, productId, policy.imageWorkflowId);
      if (!policy.accountIds.some(id => this.app.connections?.accounts().some(a => a.id === id && a.provider === 'bluesky'))) throw new Error('Select a Bluesky destination for automatic images.');
    }
    if (this.deliveries().some(j => j.productId === productId && j.attempts > 0 && ['dispatching', 'retry', 'attention'].includes(j.status))) throw new Error('Reconcile attempted deliveries, or explicitly stop retrying them, before changing operating settings. Pause remains available.');
    this.pause(productId);
    const state = this.state(productId);
    this.put(STATE + productId, { ...state, ...policy, mode: policy.mode, ownedAudience: policy.ownedAudience, testChannels: policy.testChannels, replyToRequests: policy.replyToRequests, publicReplyLimit: policy.publicReplyLimit, imageWorkflowId: policy.imageWorkflowId, discovery: policy.discovery, demandEvidence: undefined, revision: state.revision + 1, authorizedAt: null, lastCycleAt: null, taskId: null, targetAccountId: null, learning: undefined });
    for (const job of this.deliveries().filter(j => j.productId === productId && ['queued', 'retry'].includes(j.status))) this.put(JOB + job.id, { ...job, status: 'cancelled', detail: 'Operating settings changed. A new campaign will use the new settings.', updatedAt: this.app.clock.now() });
  }
  private validateAccounts(productId: string, ids: string[]) {
    requireProduct(this.app, productId);
    const accounts = this.app.connections?.accounts() ?? [];
    for (const id of ids) {
      const account = accounts.find(a => a.id === id && a.productId === productId);
      if (!account || !supported(account.provider)) throw new Error('Choose a supported account connected to this business.');
      if (account.status !== 'verified' || (account.expiresAt && account.expiresAt <= this.app.clock.now() && !account.refreshable)) throw new Error(`Reconnect or verify ${account.label} before running.`);
      if (!hasPublishingPermission(account)) throw new Error(`Check ${account.provider === 'x' ? 'X' : account.provider === 'facebook' ? 'Facebook Page' : 'LinkedIn'} with publishing access in Connections before running.`);
    }
  }
  run(productId: string) {
    if (this.app.env.SIGNAL_OFFLINE === '1') throw new Error('Turn off offline mode before running the operation.');
    const state = this.state(productId); operationPolicySchema.parse(statePolicy(state)); this.validateAccounts(productId, state.accountIds);
    const readiness = this.readiness(productId); if (!readiness.ready) throw new Error(readiness.blockers.join(' '));
    this.put(STATE + productId, { ...state, running: true, authorizedAt: this.app.clock.now() });
  }
  readiness(productId: string) { return operationReadiness(this.app, this.state(productId)); }
  async assessAcquisition(productId: string, taskId: string, llm: LlmClient, model: string, signal: AbortSignal) {
    const state = this.state(productId);
    const check = () => {
      signal.throwIfAborted(); const current = this.state(productId);
      if (!current.running || current.mode !== 'acquisition' || current.revision !== state.revision || current.taskId !== taskId || !this.app.db.select().from(growthTasks).where(and(eq(growthTasks.id, taskId), eq(growthTasks.productId, productId), eq(growthTasks.status, 'running'))).get()) throw new Error('Acquisition cycle paused or replaced.');
    };
    check();
    const result = await assessAcquisition(this.app, state, llm, model, signal, check);
    check();
    if (result.cycle.status === 'ready') {
      const finding = state.demandEvidence?.find(f => f.id === result.cycle.selectedFindingId);
      if (!finding) throw new Error('Selected buyer evidence is no longer available.');
      this.put(STATE + productId, { ...this.state(productId), targetAccountId: result.cycle.accountId, demandEvidence: [finding], learning: result.cycle.learning });
    }
    return result;
  }
  async start(productId: string, prepareRuntime: (models: string[]) => Promise<void>) {
    const readiness = this.readiness(productId); if (!readiness.ready) throw new Error(readiness.blockers.join(' '));
    const revision = (this.startRevisions.get(productId) ?? 0) + 1; this.startRevisions.set(productId, revision);
    const models = this.agentModels(productId);
    if (models.length) await prepareRuntime(models);
    if (this.startRevisions.get(productId) !== revision || JSON.stringify(models) !== JSON.stringify(this.agentModels(productId))) throw new Error('Operation startup was cancelled or its model settings changed. Run again when ready.');
    this.run(productId);
  }
  agentModels(productId: string) {
    const state = this.state(productId);
    return this.readiness(productId).needsAgents ? [...new Set([agentModel(this.app, 'marketing'), ...((state.imageWorkflowId && state.imageWorkflowId !== BRAND_CARD_WORKFLOW) || this.app.videoCampaigns?.policy(productId).enabled ? [agentModel(this.app, 'vision')] : [])])] : [];
  }
  pause(productId: string) {
    this.conversations.pause(productId);
    this.app.video?.pauseAgentWork(productId);
    this.app.videoPublishing?.pause(productId);
    this.discovery.pause(productId);
    this.startRevisions.set(productId, (this.startRevisions.get(productId) ?? 0) + 1);
    this.app.prospects?.pause(productId);
    this.app.outreach?.pause(productId);
    this.app.prospectResearch?.pause(productId);
    this.app.salesReplies?.pause(productId);
    this.app.sales?.pause(productId);
    const state = this.state(productId); this.put(STATE + productId, { ...state, running: false });
    if (this.activeProduct === productId) this.controller?.abort();
  }
  cancel(productId: string, id: string, acceptUncertain = false) {
    const job = this.job(productId, id);
    if (!['queued', 'retry', 'attention'].includes(job.status) || (job.attempts > 0 && !acceptUncertain)) throw new Error('A delivery that may have reached its destination must be reconciled or explicitly stopped with its uncertainty acknowledged.');
    this.put(JOB + id, { ...job, status: 'cancelled', detail: job.attempts > 0 ? 'Owner stopped further attempts. This content may already exist remotely; publication is unconfirmed.' : 'Cancelled before delivery.', updatedAt: this.app.clock.now() });
  }
  retry(productId: string, id: string) {
    const job = this.job(productId, id); const state = this.state(productId);
    if (job.status !== 'attention' || job.revision !== state.revision) throw new Error('Only an unresolved delivery under the same operating settings can be retried.');
    this.validateAccounts(productId, [job.accountId]);
    this.put(JOB + id, { ...job, status: 'retry', nextAttemptAt: this.app.clock.now(), detail: 'Will reconcile the existing publication before attempting delivery.' });
    if (job.image && !job.image.asset && job.attempts === 0) {
      const media = this.app.db.select().from(marketingMedia).where(eq(marketingMedia.id, job.image.mediaId)).get();
      this.put(JOB + id, { ...job, status: 'queued', image: { ...job.image, phase: 'pending', reviewAttempts: 0, mediaId: media && ['failed', 'cancelled'].includes(media.status) ? newId() : job.image.mediaId, detail: 'Checking the local image again.' }, leaseUntil: 0 });
    }
  }
  private job(productId: string, id: string) { requireProduct(this.app, productId); const job = this.get<Delivery>(JOB + id); if (!job || job.productId !== productId) throw new Error('Delivery not found for this business.'); return job; }
  private completedAcquisitionAt(state: OperationState): number | undefined {
    if (!state.taskId) return undefined;
    const task = this.app.db.select().from(growthTasks).where(and(eq(growthTasks.id, state.taskId), eq(growthTasks.productId, state.productId))).get();
    const cycle = acquisitionCycle(this.app, state.productId);
    return task?.status === 'done' && cycle?.revision === state.revision && cycle.taskId === state.taskId && ['ready', 'researching', 'no-fit'].includes(cycle.status) ? task.updatedAt : undefined;
  }
  context(productId: string) {
    const state = this.state(productId);
    return { ...state, accounts: this.app.connections?.accounts().filter(a => a.productId === productId && state.accountIds.includes(a.id)).map(a => ({ id: a.id, provider: a.provider, label: a.label })), recentDeliveries: this.deliveries().filter(j => j.productId === productId).slice(0, 10).map(j => ({ title: j.title, status: j.status, detail: j.detail, receipt: j.receipt })) };
  }
  enqueue(productId: string, taskId: string, input: unknown) {
    const prepared = this.prepareDelivery(productId, taskId, input);
    if ('existing' in prepared) return prepared.existing;
    const { job } = prepared;
    this.put(JOB + job.id, job);
    return { id: job.id, status: job.status, detail: job.detail };
  }
  /** Validate without reserving a slot or creating any delivery. Enqueue rechecks
   * current policy after the asynchronous editorial review has completed. */
  preflight(productId: string, taskId: string, input: unknown): void {
    this.prepareDelivery(productId, taskId, input);
  }
  private prepareDelivery(productId: string, taskId: string, input: unknown) {
    const value = deliveryInputSchema.parse(input); const state = this.state(productId);
    if (state.mode === 'acquisition') {
      const decision = acquisitionCycle(this.app, productId);
      if (decision?.status !== 'ready' || decision.taskId !== taskId || decision.revision !== state.revision || decision.selectedFindingId !== value.demand?.findingId || decision.accountId !== value.accountId) throw new Error('Customer acquisition requires a verified problem and its selected distribution route. A generic replacement post cannot complete this cycle.');
    }
    if (state.discovery?.enabled && (!value.demand || (value.demand.findingId !== 'none' && !state.demandEvidence?.some(f => f.id === value.demand!.findingId)))) throw new Error('Explain the public research decision. Select a finding from this cycle, or none when no observation fits.');
    if (!state.discovery?.enabled && value.demand) throw new Error('Public research is not enabled for this cycle. Omit demand.');
    if (!state.running || !state.authorizedAt) throw new Error('The owner must start this business in Operations before deliveries can be queued.');
    if (!state.accountIds.includes(value.accountId)) throw new Error('This destination is not enabled in the operating settings.');
    this.validateAccounts(productId, [value.accountId]);
    const task = this.app.db.select().from(growthTasks).where(and(eq(growthTasks.id, taskId), eq(growthTasks.productId, productId), eq(growthTasks.status, 'running'))).get();
    if (!task || state.taskId !== taskId) throw new Error('Only the active operating cycle can queue a delivery.');
    if (state.targetAccountId && value.accountId !== state.targetAccountId) throw new Error('Use the destination selected for this operating cycle.');
    const prior = this.deliveries().find(j => j.taskId === taskId);
    if (prior) return { existing: { id: prior.id, status: prior.status, detail: 'This cycle already has a durable delivery.' } };
    const product = requireProduct(this.app, productId);
    const evidence = this.app.db.select().from(marketingToolCalls).where(and(eq(marketingToolCalls.productId, productId), eq(marketingToolCalls.taskId, taskId), eq(marketingToolCalls.name, 'product.inspect'), eq(marketingToolCalls.status, 'done'))).all().flatMap(call => { try { const result = JSON.parse(call.result) as { url?: unknown }; return typeof result.url === 'string' ? [result.url] : []; } catch { return []; } });
    const origin = new URL(product.utmBase).origin;
    if (!value.evidence.some(url => new URL(url).origin === origin && evidence.some(observed => { try { return new URL(observed).href === new URL(url).href; } catch { return false; } }))) throw new Error('Inspect the current product website during this cycle and cite its returned URL before queuing public copy.');
    const publicCopy = `${value.title}\n${value.description}\n${value.body}`;
    const warnings = [...copyWarnings(publicCopy), ...generationClaimWarnings(publicCopy)];
    if (/\b(?:does(?:n't| not)|won't|will not|never)\s+(?:send|upload|transmit)\s+(?:your\s+)?(?:data|files|documents)\b|\bwithout\s+(?:the\s+)?(?:associated\s+)?data\s+risks?\b/i.test(value.body)) warnings.push('Remove absolute data-transfer or data-risk claims. Describe local inference and optional network features accurately.');
    if (/\b(?:data|files|documents|conversations)\s+(?:never\s+leave|(?:always\s+)?stay\s+(?:where|on))|\babsolute\s+(?:data\s+)?(?:privacy|sovereignty)|\bunacceptable risk\b/i.test(value.body)) warnings.push('Remove absolute data-location promises and fear-based claims. Describe local inference and optional network features precisely.');
    if (warnings.length) throw new Error(`Public copy needs revision: ${warnings.join(' ')}`);
    const account = this.app.connections!.accounts().find(a => a.id === value.accountId)!;
    const finding = state.demandEvidence?.find(f => f.id === value.demand?.findingId);
    const isReply = state.mode === 'acquisition' && state.replyToRequests && account.provider === 'bluesky' && finding?.kind === 'bluesky' && finding.reply;
    const capacity = deliveryCapacity(state, this.deliveries(), this.app.clock.now());
    if (isReply ? !capacity.canReply : !capacity.canPublish) throw new Error('The daily delivery limit is already reserved for this activity.');
    const helpFirst = Boolean(isReply && buyerIntent(finding.excerpt) === 'work-problem');
    if (isReply) {
      if (buyerIntent(finding.excerpt) === 'insufficient-context') throw new Error('This post does not establish a software request or a concrete personal work problem. Do not turn casual conversation into a product pitch.');
      if (lacksReplyContext(finding.excerpt)) throw new Error('The public request has no concrete subject. Do not infer a document problem from the word summarize; wait for usable context.');
      requireNaturalReply(value.body);
      if (helpFirst && (/https?:\/\//i.test(value.body) || value.body.toLowerCase().includes(product.name.toLowerCase()))) throw new Error('Answer the work problem first without a product name or link. Signal adds team affiliation. Wait for interest before recommending the app.');
      blueskyReferenceSchema.parse(finding.reply);
      if (finding.postedAt < this.app.clock.now() - 7 * DAY || !finding.requestLanguage) throw new Error('The public request is stale or does not ask for help.');
      if (this.deliveries().some(j => j.reply?.authorDid === finding.reply!.authorDid && j.createdAt > this.app.clock.now() - 30 * DAY && (j.status !== 'cancelled' || j.attempts > 0))) throw new Error('This person already has a reserved or attempted response. Do not repeatedly approach them.');
    }
    if (state.imageWorkflowId && account.provider === 'bluesky' && !isReply) {
      imageWorkflow(this.app, productId, state.imageWorkflowId);
      if (state.imageWorkflowId === BRAND_CARD_WORKFLOW) {
        if (value.visual) throw new Error('Branded cards use the reviewed title and description. Omit visual.');
      } else if (!value.visual) throw new Error('This policy requires an image. Include visual.prompt describing a specific editorial illustration of the buyer problem; no product screenshots, text, logos or testimonials.');
    } else if (value.visual) throw new Error('Automatic images are not enabled for this destination.');
    if (['bluesky', 'linkedin', 'x', 'facebook'].includes(account.provider)) {
      const links = [...value.body.matchAll(/https?:\/\/[^\s)<>]+/g)].map(m => m[0]);
      const businessLink = links.find(link => { try { return new URL(link).origin === origin; } catch { return false; } });
      if (helpFirst) {
        value.body += ' (' + product.name + ' team)';
      } else if (isReply && !hasDisclosure(value.body)) {
        // Lead with the useful answer. Keep affiliation beside the product link.
        value.body = businessLink ? value.body.replace(businessLink, 'Our app: ' + businessLink) : value.body + ' Our app: ' + product.utmBase;
      } else {
        if (!businessLink) value.body += ' ' + product.utmBase;
        if (!hasDisclosure(value.body)) value.body = 'Our app: ' + value.body;
      }
    }
    if (account.provider === 'bluesky' && ((!helpFirst && !hasDisclosure(value.body)) || [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(value.body)].length > 300)) throw new Error('Bluesky copy needs affiliation disclosure and at most 300 characters, including the link.');
    if (account.provider === 'signal-blog' && value.body.length < 700) throw new Error('Write a useful complete article of at least 700 characters, including practical steps and a relevant call to action.');
    const urls = [...value.body.matchAll(/https?:\/\/[^\s)<>]+/g)].map(m => m[0]);
    if (!helpFirst && !urls.some(url => { try { const parsed = new URL(url); return parsed.origin === origin && parsed.protocol === 'https:'; } catch { return false; } })) throw new Error('Include a relevant HTTPS call-to-action link to this business website.');
    const path = (url: URL) => url.pathname.replace(/\/$/, '') || '/';
    const knownPaths = new Set([product.utmBase, ...evidence].flatMap(url => { try { const parsed = new URL(url); return parsed.origin === origin && parsed.protocol === 'https:' ? [path(parsed)] : []; } catch { return []; } }));
    if (urls.some(url => { try { const parsed = new URL(url); return parsed.origin === origin && (Boolean(parsed.username || parsed.password) || !knownPaths.has(path(parsed))); } catch { return false; } })) throw new Error('Use the configured business website URL or a page inspected during this cycle. Do not invent a destination path or attach affiliation text to the URL; put that text in a separate sentence. Use exactly ' + product.utmBase + ' on its own line. Unverified URL paths: ' + urls.flatMap(url => { try { const parsed = new URL(url); return parsed.origin === origin && !knownPaths.has(path(parsed)) ? [parsed.pathname.slice(0, 160)] : []; } catch { return []; } }).slice(0, 5).join(', '));
    const hash = fingerprint(value.body);
    if (this.deliveries().some(j => j.productId === productId && j.fingerprint === hash && (j.status !== 'cancelled' || j.attempts > 0))) throw new Error('This copy has already been queued. Choose a different useful buyer problem.');
    const id = newId(); const now = this.app.clock.now();
    const slug = `${value.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 65).replace(/-$/, '') || 'guide'}-${id.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)}`;
    // AT Protocol TID: 53-bit microsecond timestamp followed by a 10-bit clock ID.
    let tid = BigInt(now) * 1000n * 1024n + BigInt(randomBytes(2).readUInt16BE() % 1024);
    const alphabet = '234567abcdefghijklmnopqrstuvwxyz'; let recordKey = '';
    for (let i = 0; i < 13; i++) { recordKey = alphabet[Number(tid & 31n)]! + recordKey; tid >>= 5n; }
    const body = value.body.replace(/https:\/\/[^\s)<>]+/g, link => { try { const u = new URL(link); if (u.origin !== origin) return link; u.searchParams.set('utm_source', 'signal'); u.searchParams.set('utm_medium', account.provider === 'signal-blog' ? 'content' : 'social'); u.searchParams.set('utm_campaign', id); return u.toString(); } catch { return link; } });
    if (account.provider === 'bluesky' && [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(body)].length > 300) throw new Error('Shorten the Bluesky caption to leave room for its tracked campaign link. Aim for 120–180 characters before the link. Tracking must not be silently removed.');
    if (account.provider === 'linkedin' && body.length > 3000) throw new Error('Shorten the LinkedIn post to fit 3,000 characters including its tracked campaign link.');
    if (account.provider === 'facebook' && body.length > 5000) throw new Error('Keep the Facebook campaign post within 5,000 characters including its tracked campaign link.');
    if (account.provider === 'x' && !twitterText.parseTweet(body).valid) throw new Error('Shorten the X post to fit 280 weighted characters including its tracked campaign link.');
    const job: Delivery = { ...value, body, id, productId, taskId, provider: account.provider as Delivery['provider'], revision: state.revision, fingerprint: hash, slug, recordKey, author: `${product.name} team`, status: 'queued', createdAt: now, updatedAt: now, nextAttemptAt: now, attempts: 0, leaseUntil: 0, leaseId: '', detail: 'Queued for the selected destination. Not published yet.', receipt: null };
    if (isReply) job.reply = { ...finding.reply!, text: finding.excerpt };
    if (state.imageWorkflowId && account.provider === 'bluesky' && !isReply) job.image = { workflowId: state.imageWorkflowId, mediaId: newId(), phase: 'pending', detail: 'Waiting to render the campaign image.', reviewAttempts: 0 };
    if (state.learning) job.learning = state.learning;
    if (state.demandEvidence?.length) job.demandEvidence = state.demandEvidence;
    return { job };
  }
  schedule(productId?: string) {
    if (this.app.env.SIGNAL_OFFLINE === '1') return;
    for (const product of this.app.db.select().from(products).where(eq(products.enabled, true)).all().filter(p => !productId || p.id === productId)) {
      this.app.db.transaction(() => {
        const state = this.state(product.id);
        if (state.accountIds.length === 0 && state.mode !== 'acquisition') return;
        if (state.discovery?.enabled && this.discovery.snapshot(state).lastAttemptAt === null) return;
        const capacity = deliveryCapacity(state, this.deliveries(), this.app.clock.now());
        if (!state.running || (!capacity.canPublish && !capacity.canReply)) return;
        const demandEvidence = this.discovery.context(state);
        const decision = acquisitionCycle(this.app, state.productId);
        // Empty scans must not consume the acquisition interval. New candidates
        // after a completed empty/no-fit batch can be assessed promptly, without
        // changing publication limits or rapidly retrying a failed generation.
        const dueAt = state.mode === 'acquisition' ? acquisitionDueAt(state, decision, demandEvidence.map(f => f.id), this.completedAcquisitionAt(state)) : state.lastCycleAt === null ? 0 : state.lastCycleAt + state.intervalHours * 3600000;
        if (dueAt === null || this.app.clock.now() < dueAt) return;
        if (this.app.db.select().from(growthTasks).where(and(eq(growthTasks.productId, state.productId), eq(growthTasks.kind, 'marketing'))).all().some(t => ['queued', 'running'].includes(t.status))) return;
        try { this.validateAccounts(state.productId, state.accountIds); } catch { return; }
        const learning = state.mode === 'acquisition' ? state.learning : chooseOperation(this.app, state, this.deliveries()); const target = learning?.accountId ?? null;
        const taskId = queueMarketing(this.app, state.productId, state.mode === 'acquisition' ? `Run a customer acquisition cycle. Objective: ${state.objective}\nQualify observed customer requests against current product evidence before deciding whether to publish. Research and an honest no-fit or missing-access outcome are valid work; do not manufacture a promotional post to satisfy a quota. Keep Sales and reporting under their saved policies. No ads or spending.` : `Run an autonomous operation cycle. Objective: ${state.objective}\nDestination account: ${target}. Inspect the current product website, choose a distinct buyer problem based on available evidence, then use operations.enqueue to schedule finished public copy for that account. This is an authorized delivery under the owner's operating policy. Do not stop at a local draft. Do not invent claims. No ads or spending.`);
        this.put(STATE + state.productId, { ...state, taskId, targetAccountId: target, learning, demandEvidence, lastCycleAt: this.app.clock.now() });
      }, { behavior: 'immediate' });
    }
  }
  tick(agentsReady = true): Promise<void> {
    if (this.active) return this.active;
    this.active = (async () => { await this.discovery.tick(this.app.db.select().from(products).where(eq(products.enabled, true)).all().map(p => this.state(p.id))); await this.conversations.tick(); if (agentsReady) await this.prepareImage(); await this.dispatchNext(); })().finally(() => { this.active = null; this.controller = null; this.activeProduct = null; });
    return this.active;
  }
  async stop() { this.controller?.abort(); await this.discovery.stop(); await this.conversations.stop(); await this.active; }
  private async prepareImage() {
    if (this.app.env.SIGNAL_OFFLINE === '1') return;
    const job = this.app.db.transaction(() => {
      const next = this.deliveries().reverse().find(j => j.status === 'queued' && j.image && !['ready', 'attention'].includes(j.image.phase) && j.leaseUntil <= this.app.clock.now() && this.state(j.productId).running && this.state(j.productId).revision === j.revision);
      if (!next) return null;
      const claimed = { ...next, leaseId: newId(), leaseUntil: this.app.clock.now() + 300000 }; this.put(JOB + next.id, claimed); return claimed;
    });
    if (!job) return;
    this.controller = new AbortController(); this.activeProduct = job.productId;
    const check = () => { this.controller!.signal.throwIfAborted(); const state = this.state(job.productId); const current = this.job(job.productId, job.id); if (!state.running || state.revision !== job.revision || current.status !== 'queued' || current.leaseId !== job.leaseId) throw new Error('The image campaign changed or paused.'); this.validateAccounts(job.productId, [job.accountId]); };
    try {
      check();
      if (!this.app.operationImages) throw new Error('Image processing is unavailable. Open this campaign in the Signal desktop app.');
      await this.app.operationImages.advance(job, this.controller.signal, image => { check(); this.put(JOB + job.id, { ...this.job(job.productId, job.id), image, ...(image.phase === 'attention' ? { status: 'attention', detail: image.detail } : {}) }); }, check);
    } catch (error) { if (!this.controller.signal.aborted) { const current = this.job(job.productId, job.id); if (current.leaseId === job.leaseId && current.status === 'queued') this.put(JOB + job.id, { ...current, status: 'attention', detail: error instanceof Error ? error.message : 'Image preparation failed.' }); } }
    finally { const current = this.job(job.productId, job.id); if (current.leaseId === job.leaseId) this.put(JOB + job.id, { ...current, leaseUntil: 0 }); this.controller = null; this.activeProduct = null; }
  }
  private async dispatchNext() {
    if (this.app.env.SIGNAL_OFFLINE === '1' || !this.app.connections) return;
    const now = this.app.clock.now();
    const job = this.app.db.transaction(() => {
      const next = this.deliveries().reverse().find(j => this.state(j.productId).running && (!j.image || (j.image.phase === 'ready' && j.image.asset)) && ((['queued', 'retry'].includes(j.status) && j.nextAttemptAt <= now) || (j.status === 'dispatching' && j.leaseUntil <= now)));
      if (!next) return null;
      const state = this.state(next.productId);
      if (next.revision !== state.revision) { this.put(JOB + next.id, { ...next, status: 'attention', detail: 'Operating settings changed during delivery. Reconcile this publication before starting another.' }); return null; }
      // A lower daily cap after a settings edit cannot release old work automatically.
      const claimed: Delivery = { ...next, status: 'dispatching', attempts: next.attempts + 1, leaseUntil: now + 180000, leaseId: newId(), updatedAt: now, detail: 'Checking the destination and delivering.' };
      this.put(JOB + next.id, claimed); return claimed;
    });
    if (!job) return;
    this.controller = new AbortController(); this.activeProduct = job.productId;
    const canWrite = () => {
      const state = this.state(job.productId); const current = this.job(job.productId, job.id);
      if (!state.running || state.revision !== job.revision || !state.accountIds.includes(job.accountId) || current.leaseId !== job.leaseId) throw new DeliveryError('Operation paused or its authorization changed.');
      this.validateAccounts(job.productId, [job.accountId]);
    };
    const finish = (patch: Partial<Delivery>) => { const current = this.job(job.productId, job.id); if (current.leaseId === job.leaseId) this.put(JOB + job.id, { ...current, ...patch, leaseUntil: 0, updatedAt: this.app.clock.now() }); };
    try {
      canWrite();
      const receipt = await this.app.connections.deliver(job, this.controller.signal, canWrite, {
        started: author => {
          canWrite(); const current = this.job(job.productId, job.id);
          if (current.publicationAttempt) throw new DeliveryError('This publication already has a send record. Reconcile it before continuing.');
          this.put(JOB + job.id, { ...current, publicationAttempt: { author, startedAt: this.app.clock.now() } });
        },
        rejected: () => {
          const current = this.job(job.productId, job.id);
          if (current.leaseId !== job.leaseId) throw new DeliveryError('Publication ownership changed. Reconciliation is required.');
          const { publicationAttempt: _attempt, ...rest } = current;
          this.put(JOB + job.id, rest);
        },
        accepted: id => {
          const current = this.job(job.productId, job.id);
          if (current.leaseId !== job.leaseId || !current.publicationAttempt) throw new DeliveryError('Publication ownership changed after provider acceptance. Reconciliation is required.');
          this.put(JOB + job.id, { ...current, publicationAttempt: { ...current.publicationAttempt, id } });
        },
      });
      finish({ status: 'published', receipt: { ...receipt, confirmedAt: this.app.clock.now() }, detail: 'Destination confirmed publication. This is not evidence of a sale.' });
    } catch (error) {
      const retry = (this.controller.signal.aborted || (error instanceof DeliveryError && error.retryable)) && job.attempts < 5;
      finish({ status: retry ? 'retry' : 'attention', nextAttemptAt: this.app.clock.now() + Math.min(3600000, 60000 * 2 ** job.attempts), detail: error instanceof DeliveryError ? error.message : 'Delivery needs attention. Verify the account and network connection, then retry reconciliation.' });
    }
  }
}
function statePolicy(state: OperationState): OperationPolicy { return { mode: state.mode, ownedAudience: state.ownedAudience, testChannels: state.testChannels, replyToRequests: state.replyToRequests, publicReplyLimit: state.publicReplyLimit, objective: state.objective, accountIds: state.accountIds, intervalHours: state.intervalHours, dailyLimit: state.dailyLimit, ...(state.imageWorkflowId ? { imageWorkflowId: state.imageWorkflowId } : {}), ...(state.discovery ? { discovery: state.discovery } : {}) }; }
