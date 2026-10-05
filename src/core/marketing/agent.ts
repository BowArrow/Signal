import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { App } from '../app.js';
import type { LlmClient } from '../llm/client.js';
import { extractJson } from '../llm/client.js';
import { agentClient, agentModel } from '../runtime/client.js';
import { BRAND_CARD_WORKFLOW } from '../../shared/brand-card.js';
import { runtimeSettings } from '../runtime/settings.js';
import { RecordingLlmClient } from '../llm/recording.js';
import { dashboard, applyGrowthAction, queueTask } from '../growth/store.js';
import { modelContext } from '../growth/context.js';
import { newId } from '../lib/id.js';
import { loadPrompt } from '../prompts/loader.js';
import { engineeringRequests, growthTasks, marketingDrafts, marketingEdges, marketingMemory, marketingMessages, marketingToolCalls, marketingWorkflows, opportunities } from '../db/schema.js';
import { draftInputSchema, memoryInputSchema } from '../../shared/marketing.js';
import { addEngineeringRequest, budget, hasPendingMedia, initializeMarketing, marketingSettings, recall, remember, requireProduct } from './store.js';
import { comfyStatus, submitMedia } from './comfy.js';
import { publicPage, searchWeb } from './web.js';
import { blogRequest } from './blog.js';
import { brandProfile, studioAction, studioView } from '../studio/store.js';
import { briefSchema } from '../../shared/studio.js';
import { reviewOperationCopy } from '../operations/review.js';
import { operationAgentSchema } from '../operations/agent-schema.js';
import { campaignFeedback, clearRecoveredFinding, rememberCampaignRejection } from '../operations/feedback.js';
import { NATURAL_VOICE } from './voice.js';
import { buyerIntent, CONSULTATIVE_REPLY } from '../../shared/buyer-intent.js';

const tools = ['operations.enqueue', 'memory.search', 'memory.remember', 'memory.link', 'product.inspect', 'web.read', 'web.search', 'signals.find', 'engineering.add', 'draft.save', 'blog.read', 'blog.save', 'bullseye.research', 'bullseye.shortlist', 'opportunities.process', 'media.status', 'media.create', 'video.status', 'video.create', 'video.assemble', 'campaign.list', 'campaign.create', 'accounts.list', 'accounts.preview'] as const;
const stepSchema = z.object({ message: z.string().min(1).max(6000), actions: z.array(z.object({ tool: z.enum(tools), input: z.record(z.unknown()) })).max(3) });
const outputSchema = { type: 'object', additionalProperties: false, required: ['message', 'actions'], properties: {
  message: { type: 'string', maxLength: 600 },
  actions: { type: 'array', maxItems: 1, items: { type: 'object', additionalProperties: false, required: ['tool', 'input'], properties: { tool: { type: 'string', enum: [...tools] }, input: { type: 'object' } } } },
} };

export async function executeMarketingTool(app: App, productId: string, name: typeof tools[number], input: Record<string, unknown>, signal: AbortSignal, taskId?: string): Promise<unknown> {
  signal.throwIfAborted();
  const product = requireProduct(app, productId);
  if (name === 'operations.enqueue') {
    if (!app.operations || !taskId) throw new Error('Operations require an active desktop operating cycle.');
    return app.operations.enqueue(productId, taskId, input);
  }
  if (name === 'accounts.list') return { accounts: (app.connections?.accounts() ?? []).filter(a => a.productId === productId).map(a => ({ id: a.id, provider: a.provider, label: a.label, identity: a.identity, status: a.status, detail: a.detail })), boundary: 'Connections provide account reads. Linking an account does not enable automatic sending, posting, or spending.' };
  if (name === 'accounts.preview') {
    if (!app.connections) throw new Error('Account connections require the desktop credential vault.');
    return { untrustedAccountData: await app.connections.verify(productId, z.string().min(1).parse(input['accountId']), true) };
  }
  if (name === 'campaign.list') {
    const state = studioView(app);
    return { campaigns: state.campaigns.filter(c => c.productId === productId).slice(0, 12), assets: state.assets.filter(a => a.productId === productId).map(a => ({ id: a.id, campaignId: a.campaignId, kind: a.kind, status: a.status })).slice(0, 30), pipeline: state.leads.filter(l => l.productId === productId).reduce<Record<string, number>>((counts, row) => { counts[row.value.stage] = (counts[row.value.stage] ?? 0) + 1; return counts; }, {}) };
  }
  if (name === 'campaign.create') {
    const brief = briefSchema.parse(input);
    const before = new Set(studioView(app).campaigns.map(c => c.id));
    const state = studioAction(app, { type: 'campaign', productId, value: brief });
    const campaign = state.campaigns.find(c => c.productId === productId && !before.has(c.id))!;
    studioAction(app, { type: 'generate', productId, id: campaign.id });
    return { campaignId: campaign.id, status: 'Campaign brief saved and materials queued for generation. Review in Growth workspace.' };
  }
  if (name === 'blog.read' || name === 'blog.save') {
    const connectedKey = app.connections?.websiteKey(productId);
    return blogRequest(product.key, input, { read: name === 'blog.read', signal, offline: app.env.SIGNAL_OFFLINE === '1', env: { ...app.env, ...(connectedKey ? { [`SIGNAL_${product.key.toUpperCase()}_PUBLISH_KEY`]: connectedKey } : {}) } });
  }
  const string = (key: string) => z.string().trim().min(1).max(4000).parse(input[key]);
  if (name === 'memory.search') return recall(app, productId, string('query'));
  if (name === 'memory.link') {
    const value = z.object({ fromId: z.string(), toId: z.string(), relation: z.enum(['supports', 'contradicts', 'blocks', 'tests', 'produces']) }).strict().parse(input);
    for (const id of [value.fromId, value.toId]) if (!app.db.select().from(marketingMemory).where(and(eq(marketingMemory.id, id), eq(marketingMemory.productId, productId), eq(marketingMemory.status, 'active'))).get()) throw new Error('Both linked memories must be active in the selected product');
    app.db.insert(marketingEdges).values({ id: newId(), productId, ...value }).onConflictDoNothing().run();
    return { status: 'inferred relationship saved', ...value };
  }
  if (name === 'memory.remember') {
    const value = memoryInputSchema.parse(input);
    // Only fetched observations and owner edits establish facts. Model memory is a hypothesis.
    const id = remember(app, productId, { ...value, kind: 'hypothesis', confidence: Math.min(0.6, value.confidence), source: `Agent hypothesis: ${value.source}` });
    return { id, status: 'hypothesis saved' };
  }
  if (name === 'product.inspect' || name === 'web.read') {
    const page = await publicPage(app, name === 'product.inspect' ? product.utmBase : string('url'), signal);
    signal.throwIfAborted();
    const memoryId = remember(app, productId, { title: page.title.slice(0, 200), body: page.body.slice(0, 4000) || 'Page returned no readable text.', kind: 'observation', source: page.url, confidence: 0.75 });
    return { ...page, memoryId };
  }
  if (name === 'web.search') return searchWeb(app, string('query'));
  if (name === 'signals.find') {
    const query = string('query').toLowerCase();
    const stop = new Set(['the', 'and', 'for', 'with', 'how', 'what', 'user', 'users', 'need', 'needs', 'pain', 'points', 'workflow', 'marketing', 'challenge', 'challenges']);
    const terms = query.match(/[\p{L}\p{N}]+/gu)?.filter((s) => s.length > 2 && !stop.has(s)).slice(0, 8) ?? [];
    const productTerms = product.key === 'cinegen' ? /\b(video|film|storyboard|animation|animating|footage|cinema|cinegen)\b/i : /\b(local|offline|privacy|private|ollama|lemonade|document)\b/i;
    return app.db.select().from(opportunities).orderBy(desc(opportunities.discoveredAt)).limit(300).all()
      .filter((o) => (!o.matchedProductId || o.matchedProductId === productId) && productTerms.test(`${o.title} ${o.body.slice(0, 1200)}`))
      .map((o) => ({ o, score: terms.reduce((n, t) => n + (o.title.toLowerCase().includes(t) ? 4 : 0) + (o.body.toLowerCase().includes(t) ? 1 : 0), 0) }))
      .filter(({ o, score }) => score >= Math.min(2, terms.length) && (terms.length > 0 || o.matchedProductId === productId))
      .sort((a, b) => b.score - a.score).slice(0, 4).map(({ o }) => ({ id: o.id, title: o.title, body: o.body.slice(0, 1000), url: o.url, status: o.status }));
  }
  if (name === 'engineering.add') return addEngineeringRequest(app, productId, input);
  if (name === 'draft.save') {
    const value = draftInputSchema.parse(input);
    if (['article', 'demo'].includes(value.kind) && value.body.length < 350) throw new Error('Save the finished artifact, not a teaser or plan. An article needs useful explanatory paragraphs; a demo needs concrete steps, narration, verification and a call to action.');
    if (/still building out|still building (?:some |these )?features|(?:can't|cannot) promise specific performance claims|as an AI|game.changer|revolutionary/iu.test(value.body)) throw new Error('Revise the voice: remove hype, internal drafting caveats and unsupported claims that product features are unfinished. Give a concrete useful answer from the supplied facts.');
    if (/\b(as a satisfied customer|I bought|I purchased|I have been using)\b/i.test(value.body)) throw new Error('Remove invented personal/customer experience from the draft');
    const existing = app.db.select().from(marketingDrafts).where(and(eq(marketingDrafts.productId, productId), eq(marketingDrafts.status, 'draft'))).all().find((d) => d.value.body === value.body);
    if (existing) return { id: existing.id, status: 'already saved' };
    const id = newId(); app.db.transaction((tx) => { tx.insert(marketingDrafts).values({ id, productId, value, createdAt: app.clock.now() }).run();
      remember(app, productId, { title: `Draft: ${value.title}`, body: `Saved ${value.kind} draft for review, not published: ${value.body.slice(0, 3000)}`, kind: 'hypothesis', source: `draft:${id}`, confidence: 0.5 });
    });
    return { id, status: 'draft saved for review; not sent or published' };
  }
  if (name === 'bullseye.research') { applyGrowthAction(app, { type: 'research', productId }); return { status: 'remaining channel research queued' }; }
  if (name === 'bullseye.shortlist') {
    const channelId = string('channelId');
    const state = dashboard(app).products.find((p) => p.id === productId)!;
    const c = state.channels.find((c) => c.id === channelId);
    if (!c?.idea) throw new Error('Choose a researched channel in this product');
    const funds = budget(app, productId);
    if (c.idea.estimatedCostCents > 0 && (['bootstrap', 'organic'].includes(funds.tier) || c.idea.estimatedCostCents > funds.availableCents)) throw new Error('This channel is not affordable at the current cash tier. Choose a zero-cash test.');
    applyGrowthAction(app, { type: 'shortlist', channelId }); return { status: 'shortlisted; campaign queued' };
  }
  if (name === 'opportunities.process') return { taskId: queueTask(app, productId, 'opportunities', productId), status: 'one guarded opportunity step queued' };
  if (name === 'media.status') return { ...await comfyStatus(app), workflows: app.db.select({ id: marketingWorkflows.id, name: marketingWorkflows.name }).from(marketingWorkflows).where(eq(marketingWorkflows.productId, productId)).all() };
  if (name === 'media.create') return submitMedia(app, productId, string('workflowId'), string('prompt'), taskId);
  if (name === 'video.status') {
    if (!app.video) throw new Error('Video production requires the desktop app.');
    return app.video.context(productId);
  }
  if (name === 'video.create') {
    if (!app.video || !taskId) throw new Error('Video creation requires an active desktop marketing task.');
    return app.video.agentShot(productId, taskId, input);
  }
  if (name === 'video.assemble') {
    if (!app.video || !taskId) throw new Error('Ad editing requires an active desktop marketing task.');
    return app.video.agentAssemble(productId, taskId, input);
  }
  throw new Error('Unsupported tool');
}

export async function runMarketingAgent(app: App, productId: string, taskId: string, targetId: string, signal: AbortSignal, testLlm?: LlmClient): Promise<Record<string, unknown>> {
  initializeMarketing(app);
  const product = requireProduct(app, productId);
  const operatorModel = agentModel(app, 'marketing');
  const llm = testLlm ?? new RecordingLlmClient(agentClient(app, signal), app.db, runtimeSettings(app).provider, app.clock);
  const request = app.db.select().from(marketingMessages).where(and(eq(marketingMessages.id, targetId), eq(marketingMessages.productId, productId))).get();
  if (!request) throw new Error('Marketing request missing');
  let acquisitionSource: Awaited<ReturnType<typeof publicPage>> | undefined;
  if (app.operations?.state(productId).mode === 'acquisition' && app.operations.state(productId).taskId === taskId) {
    const result = await app.operations.assessAcquisition(productId, taskId, llm, operatorModel, signal);
    acquisitionSource = result.source;
    if (result.cycle.status !== 'ready') {
      app.db.insert(marketingMessages).values({ id: newId(), productId, role: 'assistant', body: result.cycle.detail, taskId, createdAt: app.clock.now() }).run();
      return { summary: result.cycle.detail, acquisition: result.cycle.status, publicationQueued: false, contactsAdded: 0 };
    }
  }
  const conversation = app.db.select().from(marketingMessages).where(eq(marketingMessages.productId, productId)).orderBy(desc(marketingMessages.createdAt), desc(sql`rowid`)).limit(8).all().reverse().map((m) => ({ role: m.role, body: m.body.slice(0, 2500) }));
  const state = dashboard(app).products.find((p) => p.id === productId)!;
  for (const experiment of state.experiments.filter((e) => e.status === 'completed').slice(0, 12)) {
    const source = `experiment:${experiment.id}:${experiment.updatedAt}`;
    const prior = app.db.select().from(marketingMemory).where(and(eq(marketingMemory.productId, productId), eq(marketingMemory.status, 'active'))).all().find((m) => m.source.startsWith(`experiment:${experiment.id}:`));
    if (prior?.source !== source) remember(app, productId, { title: `${experiment.channelName}: recorded test outcome`, body: JSON.stringify({ note: 'Owner-recorded results, not a cash deposit or independent audit', result: experiment.result, evaluation: experiment.evaluation }), kind: 'observation', source, confidence: 0.8, ...(prior ? { supersedesId: prior.id } : {}) });
  }
  const recentWork = {
    commercialEvidence: app.revenue?.context(productId),
    campaignAnalytics: app.analytics?.context(productId),
    searchResearch: app.seo?.context(productId),
    existingSearchPage: undefined as Awaited<ReturnType<typeof publicPage>> | undefined,
    salesInbox: app.sales?.context(productId),
    ownerHandoffs: app.salesHandoffs?.summary(productId),
    operation: app.operations?.context(productId),
    brand: brandProfile(app, productId),
    video: app.video?.context(productId),
    drafts: app.db.select().from(marketingDrafts).where(eq(marketingDrafts.productId, productId)).orderBy(desc(marketingDrafts.createdAt)).limit(6).all().map((d) => ({ title: d.value.title, status: d.status })),
    engineering: app.db.select().from(engineeringRequests).where(eq(engineeringRequests.productId, productId)).limit(20).all().map((r) => ({ id: r.id, title: r.value.title, status: r.status })),
  };
  const context = modelContext({ product: { name: product.name, url: product.utmBase, currency: product.currency, positioning: product.positioning, targetBuyer: product.targetBuyer, proofPoints: product.proofPoints }, voice: marketingSettings(app).voice, budget: budget(app, productId), memories: recall(app, productId, request.body).memories.map((m) => ({ id: m.id, title: m.title, body: m.body.slice(0, 800), kind: m.kind, source: m.source })), channels: state.channels.map((c) => ({ id: c.id, name: c.name, ring: c.ring, estimatedCostCents: c.idea?.estimatedCostCents })), conversation }, product.currency);
  const history: unknown[] = [];
  let productEvidence: unknown;
  let productEvidenceUrl: string | undefined;
  let previousFeedback: ReturnType<typeof campaignFeedback> = { deferredFindingIds: [], corrections: [] };
  let failedDrafts = 0;
  let finalMessage = ''; let completedTools = 0;
  let finishAfterWrite = false;
  const videoProduction = app.videoCampaigns?.taskContext(productId, taskId);
  const operating = app.operations?.state(productId).taskId === taskId;
  const destination = recentWork.operation?.targetAccountId ?? (recentWork.operation?.accountIds.length === 1 ? recentWork.operation.accountIds[0] : undefined);
  const shortPost = Boolean(recentWork.operation?.accounts?.some(a => a.id === destination && a.provider === 'bluesky'));
  const publicReply = shortPost && recentWork.operation?.mode === 'acquisition' && recentWork.operation.replyToRequests && recentWork.operation.demandEvidence?.some(f => f.kind === 'bluesky' && f.reply);
  const xPost = Boolean(recentWork.operation?.accounts?.some(a => a.id === destination && a.provider === 'x'));
  const linkedInPost = Boolean(recentWork.operation?.accounts?.some(a => a.id === destination && a.provider === 'linkedin'));
  const facebookPost = Boolean(recentWork.operation?.accounts?.some(a => a.id === destination && a.provider === 'facebook'));
  const followup = operating && recentWork.operation?.mode !== 'acquisition' && ['test-interest', 'build-on'].includes(recentWork.operation?.learning?.mode ?? '');
  const selectionBrief = followup ? `FOLLOW-UP CYCLE: use recentWork.operation.learning.${recentWork.operation?.learning?.mode === 'test-interest' ? 'traffic.reference' : 'reference'} to identify the reference action. The reader has already completed that action. Explain one concrete thing they can do NEXT using a capability in the current product source. Do not tell them to repeat the reference action with different wording. Name the new action in the public body, title and description; avoid broad workflow promises. Prior copy identifies the topic only, not product truth. Engaged sessions are a weak interest proxy, not buyers, leads, sales, product-market fit or proof of success. Do not publish internal analytics/payment counts or claim the campaign worked. Keep the call to action concrete and supported.\n\n` : '';
  const destinationBrief = operating ? `THIS CYCLE: ${(shortPost || xPost) ? 'A short social post, not an article. Write one or two plain-text sentences, about 120 to 180 characters. Omit URLs and affiliation text from body; Signal adds company disclosure; for a first work-problem reply it omits the link, otherwise it adds the verified business link. No Markdown headings, lists or emphasis.' : facebookPost ? 'A useful Facebook Page post in plain text, about 600 to 1800 characters, with a concrete buyer workflow, company affiliation and the product URL. No invented personal experience.' : linkedInPost ? 'A useful LinkedIn member post in plain text, about 600 to 1800 characters, with a concrete buyer workflow, affiliation and a product URL. No invented personal experience.' : 'A complete practical website article.'} Destination accountId: ${destination ?? 'the account named in the request'}. ${recentWork.operation?.imageWorkflowId && recentWork.operation.imageWorkflowId !== BRAND_CARD_WORKFLOW && shortPost && !publicReply ? 'Include visual.prompt with a specific editorial illustration to accompany this short post.' : 'Do not include visual.'}\n\n` : '';
  const automatic = Boolean(videoProduction) || operating || /marketing cycle/i.test(request.body);
  const stillOwned = () => { signal.throwIfAborted(); app.videoCampaigns?.assertTaskMayRun(productId, taskId); if (app.db.select().from(growthTasks).where(and(eq(growthTasks.id, taskId), eq(growthTasks.status, 'running'))).get() == null) throw new Error('Task cancelled'); if (operating) { const state = app.operations!.state(productId); if (!state.running || state.taskId !== taskId) throw new Error('Operation paused or replaced.'); } };
  if (operating || videoProduction) {
    // Product verification is an obligatory workflow step, not a suggestion the
    // model can skip or mistake for a check completed in an earlier cycle.
    stillOwned();
    const result = acquisitionSource ?? await executeMarketingTool(app, productId, 'product.inspect', {}, signal, taskId);
    productEvidence = result;
    productEvidenceUrl = z.object({ url: z.string().url() }).parse(result).url;
    previousFeedback = campaignFeedback(app, productId, result);
    stillOwned();
    app.db.insert(marketingToolCalls).values({ id: newId(), productId, taskId, name: 'product.inspect', status: 'done', result: JSON.stringify(result).slice(0, 16000), createdAt: app.clock.now() }).run();
    history.push({ tool: 'product.inspect', result }); completedTools++;
    const searchFinding = recentWork.operation?.demandEvidence?.find(f => f.kind === 'search-console');
    if (searchFinding) {
      if (new URL(searchFinding.url).origin !== new URL(product.utmBase).origin) throw new Error('Search evidence must belong to this product website.');
      const page = await publicPage(app, searchFinding.url, signal); stillOwned();
      recentWork.existingSearchPage = { ...page, body: page.body.slice(0, 5000) };
      app.db.insert(marketingToolCalls).values({ id: newId(), productId, taskId, name: 'seo.page', status: 'done', result: JSON.stringify(recentWork.existingSearchPage), createdAt: app.clock.now() }).run();
    }
  }
  for (let step = 0; step < 4; step++) {
    stillOwned();
    const changeAngle = operating && failedDrafts >= 2 && recentWork.operation?.mode !== 'acquisition';
    const demandEvidence = changeAngle ? [] : (recentWork.operation?.demandEvidence ?? []).filter(f => !previousFeedback.deferredFindingIds.includes(f.id));
    if (operating && recentWork.operation?.mode === 'acquisition' && !demandEvidence.length) throw new Error('The qualified request was ruled out by editorial feedback. No replacement promotion was queued.');
    const campaignSchema = operating ? operationAgentSchema(destination ?? undefined, Boolean(recentWork.operation?.imageWorkflowId && recentWork.operation.imageWorkflowId !== BRAND_CARD_WORKFLOW && shortPost && !publicReply), shortPost || xPost, recentWork.operation?.discovery?.enabled ? demandEvidence.map(f => f.id) : undefined, productEvidenceUrl) : outputSchema;
    const currentWork = operating ? { ...recentWork, operation: { ...recentWork.operation, demandEvidence, ...(recentWork.operation?.mode === 'acquisition' ? { learning: undefined } : {}) }, editorialFeedback: previousFeedback.corrections } : recentWork;
    // Always retain the current source as complete JSON. Slicing the end of the
    // serialized history dropped source facts and anchored revisions to old copy.
    const priorAttempt = history.filter(item => (item as { tool?: string }).tool !== 'product.inspect').slice(-1);
    const promptHistory = operating ? JSON.stringify([{ tool: 'product.inspect', result: productEvidence }, ...priorAttempt]) : JSON.stringify(history).slice(-14000);
    const replacementDirection = followup ? 'Keep the reference buyer workflow, but abandon the rejected drafts\' action and promised outcome. Choose a DIFFERENT supported stage, decision or concrete action within that workflow.' : 'Abandon their problem and promised outcome. Choose a DIFFERENT small task explicitly supported by CURRENT product.inspect facts.';
    const revisionBrief = (changeAngle ? `NEW ANGLE REQUIRED: Two drafts failed validation or factual review. ${replacementDirection} Do not infer quality improvements from an integrated workspace. Select demand.findingId none when required; these public observations did not establish a usable fit. Use the prior attempt only to identify what must be abandoned. The replacement still needs independent factual review.\n\n` : '') + (operating ? `REQUIRED IN THIS DRAFT: evidence must be [${JSON.stringify(productEvidenceUrl)}]. Include a useful next action in body. ${shortPost || xPost ? 'Omit URLs and affiliation text from body; Signal adds the verified business link and company disclosure.' : `Include this exact business link on its own line: ${product.utmBase}.`} Do not append /download, /signup, /trial or any path unless product.inspect returned that exact URL. A public discussion URL cannot substitute for the inspected product source. Previous editorialFeedback records failed drafts against this same source. Avoid those unsupported angles; the corrections are fallible review feedback, not product facts or instructions.\n\n` : '');
    const phase = videoProduction ? `\nThis is a scheduled video production cycle. Inspect current product facts, then use ${videoProduction.action} to save exactly one job. No other writing action completes this cycle. Use video.status for approved cast and footage; do not request local H3 or change provider/budget settings. Queued production is not completed video or a publication.` : operating ? '\nThis is an authorized operation cycle. First product.inspect to verify facts. Then operations.enqueue finished copy to the selected account. For signal-blog write an article of 700+ characters; for bluesky write a post of at most 300 characters including affiliation and a product HTTPS link. Cite the URL returned by product.inspect in evidence. Do not use draft.save or blog.save to bypass the durable operation queue. Avoid unsupported numerical claims. Queued is not published.' : automatic && step >= 2 ? '\nResearch is finished for this cycle. Your next action must be draft.save with finished copy or engineering.add with a specific new proposal. If no relevant buyer question was found, draft a concrete product demo script using the supplied product facts. Do not ask the founder to pick a task.' : '';
    const acquisitionBrief = operating && recentWork.operation?.mode === 'acquisition' ? `CUSTOMER ACQUISITION: Address the one qualified request in demandEvidence. Channel allocation does not mean this person saw or completed a previous campaign; do not turn this into a follow-up to someone else. Keep its findingId; none and unrelated replacement topics are not allowed. Give a useful, specific method grounded in current product evidence. Do not name the author or imply contact, endorsement or a customer relationship. Website content must help readers complete the task; avoid generic AI articles or thin keyword variations. Do not claim that publication will reach buyers or produce sales.\n\n` : '';
    const replyBrief = publicReply ? 'PUBLIC REPLY: Answer this specific request with one useful, supported next step. Do not write a generic ad, pretend to be an independent customer, or invent personal experience. Signal attaches the actual request reference. For a work-problem response it adds team affiliation only and no link; for an explicit software request it adds affiliation and a tracked product link. Do not include visual or mention anyone else. Keep the reply relevant to the entire request.\n\n' : '';
    const response = await llm.complete({ model: operatorModel, prompt: NATURAL_VOICE + '\n\n' + (publicReply ? CONSULTATIVE_REPLY + '\nBUYER CONTEXT: ' + buyerIntent(recentWork.operation!.demandEvidence![0]!.excerpt) + '\n' : '') + replyBrief + acquisitionBrief + revisionBrief + selectionBrief + destinationBrief + loadPrompt(operating ? (xPost ? 'operation-x-agent' : shortPost ? 'operation-social-agent' : linkedInPost ? 'operation-linkedin-agent' : facebookPost ? 'operation-facebook-agent' : 'operation-agent') : 'marketing-agent', 1).render({ context: JSON.stringify(operating ? { product: { name: product.name, url: product.utmBase, targetBuyer: product.targetBuyer }, recentWork: currentWork } : { context, recentWork }), history: promptHistory, remaining: String(4 - step) }) + (operating ? '' : phase), maxTokens: 2400, temperature: 0.25, reasoningEffort: 'none', expectsJson: true, jsonSchema: campaignSchema, task: operating ? 'operations.compose' : 'marketing.operator' });
    stillOwned();
    let parsed: z.infer<typeof stepSchema>;
    try { parsed = stepSchema.parse(extractJson(response.text)); }
    catch (error) { history.push({ error: `Return the required JSON with message and actions. ${String(error).slice(0, 1000)}` }); if (step === 3) throw new Error('The local model could not produce a valid action. Retry or select a stronger local model.'); continue; }
    finalMessage = parsed.message;
    if (!parsed.actions.length) {
      if (automatic && step < 3) { history.push({ feedback: videoProduction ? `No video job was saved. Use ${videoProduction.action} with the approved assets now.` : 'No artifact was saved. Choose draft.save with finished copy or engineering.add with a concrete proposal now. Use product facts for a demo script if research was inconclusive.' }); continue; }
      break;
    }
    for (const action of parsed.actions) {
      stillOwned();
      let result: unknown; let status = 'done';
      try {
        if (videoProduction && !['product.inspect', 'web.read', 'web.search', 'memory.search', 'video.status', videoProduction.action].includes(action.tool)) throw new Error('This video cycle must save its required video job; other writing tools are unavailable.');
        if (operating && ['blog.save', 'draft.save', 'campaign.create', 'media.create', 'video.create', 'video.assemble'].includes(action.tool)) throw new Error('Use operations.enqueue for this operating cycle so delivery is durable and obeys its policy.');
        if (operating && action.tool === 'operations.enqueue') {
          app.operations!.preflight(productId, taskId, action.input);
          const review = await reviewOperationCopy(app, productId, taskId, action.input, llm, operatorModel);
          stillOwned();
          app.db.insert(marketingToolCalls).values({ id: newId(), productId, taskId, name: 'operations.review', status: 'done', result: JSON.stringify(review), createdAt: app.clock.now() }).run();
        }
        result = await executeMarketingTool(app, productId, action.tool, action.input, signal, taskId); completedTools++; if ((operating ? ['operations.enqueue'] : ['draft.save', 'engineering.add', 'campaign.create', 'video.create', 'video.assemble']).includes(action.tool)) finishAfterWrite = true;
        if (operating && action.tool === 'operations.enqueue') clearRecoveredFinding(app, productId, productEvidence, action.input);
      }
      catch (error) {
        signal.throwIfAborted(); result = { error: String(error) }; status = 'failed';
        if (operating && action.tool === 'operations.enqueue') {
          failedDrafts++; stillOwned();
          rememberCampaignRejection(app, productId, taskId, step, productEvidence, action.input, error);
        }
      }
      stillOwned();
      app.db.insert(marketingToolCalls).values({ id: newId(), productId, taskId, name: action.tool, status, result: JSON.stringify(result).slice(0, 16000), createdAt: app.clock.now() }).run();
      history.push({ tool: action.tool, ...(operating ? { input: action.input } : {}), result });
      if (status === 'done' && finishAfterWrite) {
        finalMessage = ['video.create', 'video.assemble'].includes(action.tool) ? 'I saved the video job. Follow its production status in Video production and review the full clip before publishing.' : action.tool === 'operations.enqueue' ? 'I queued the finished campaign for the authorized destination. Operations will show its delivery receipt or the problem that needs attention.' : action.tool === 'campaign.create' ? 'I saved the campaign brief and queued its materials. Follow production and review the results in Growth workspace → Campaign studio.' : action.tool === 'engineering.add'
          ? 'The request is ready for engineering. I saved the evidence, a smaller manual test, and acceptance criteria in Engineering requests.'
          : `I saved "${String(action.input.title)}" in Content & responses. It is ready for your review and has not been sent.`;
        break;
      }
      if (hasPendingMedia(app)) { finalMessage = 'I’ve queued the media job in ComfyUI. I’ll leave the GPU to it while it renders. You can follow it in Media.'; break; }
    }
    if (hasPendingMedia(app) || finishAfterWrite) break;
  }
  stillOwned();
  if (automatic && !finishAfterWrite && (operating || !hasPendingMedia(app))) throw new Error(operating ? 'The operating cycle could not queue a valid publication. Review its tool errors in Marketing agent; the next cycle will retry within the operating interval.' : 'The cycle reached its step limit without saving a draft, media job or engineering request. Review Tool activity and retry with a specific buyer question.');
  if (!finalMessage) throw new Error('The local model returned no usable message');
  // Finish with actual tool outcomes when a step budget interrupts a planned sequence.
  const body = `${finalMessage}\n\n${completedTools} tool action${completedTools === 1 ? '' : 's'} completed. Saved drafts, media jobs and engineering requests are shown in their tabs.`;
  app.db.insert(marketingMessages).values({ id: newId(), productId, role: 'assistant', body, taskId, createdAt: app.clock.now() }).run();
  return { summary: body, toolsCompleted: completedTools };
}
