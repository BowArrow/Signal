import { desc, eq, like } from 'drizzle-orm';
import type { App } from '../app.js';
import { growthTasks, opportunities, settings } from '../db/schema.js';
import { queueTask } from '../growth/store.js';
import { requireProduct } from '../marketing/store.js';
import { publicPage, type PublicPage } from '../marketing/web.js';
import { findBusinessPages } from '../sales/prospect-research.js';
import { brandProfile } from '../studio/store.js';
import { newId } from '../lib/id.js';
import { extractJson, type LlmClient } from '../llm/client.js';
import { loadPrompt } from '../prompts/loader.js';
import { adConceptsSchema, adDirectorBriefSchema, type AdDirectorPlan, type AdResearchSource } from '../../shared/ad-director.js';

const PREFIX = 'video.ad-director.';
function evidenceOptions(sources: AdResearchSource[], topic: string) {
  const terms = new Set(topic.toLowerCase().match(/[a-z]{5,}/g) ?? []);
  return sources.filter(s => s.kind === 'audience').flatMap(source => {
    const sentences = source.body.split(/(?<=[.!?])\s+|\n+/).map(value => value.trim()).filter(value => value.length >= 30 && value.length <= 350);
    const score = (value: string) => (value.toLowerCase().match(/[a-z]{5,}/g) ?? []).filter(word => terms.has(word)).length;
    const quotes = [...new Set(sentences)].sort((a, b) => score(b) - score(a)).slice(0, 4);
    if (!quotes.length) quotes.push(source.body.slice(0, 300));
    return quotes.map(quote => ({ sourceId: source.id, quote }));
  });
}
function outputContract(evidence: { sourceId: string; quote: string }[]) {
  const fields = { title: 100, buyerProblem: 400, insight: 500, hook: 90, scene: 650, productDemo: 650, narration: 250, headline: 60, callToAction: 40, hypothesis: 500, measure: 500 };
  const properties = { ...Object.fromEntries(Object.entries(fields).map(([key, maxLength]) => [key, { type: 'string', maxLength }])),
    approach: { type: 'string', enum: ['demonstration', 'visual-metaphor', 'relatable-scene'] },
    evidence: { type: 'array', minItems: 1, maxItems: 2, items: { anyOf: [...new Set(evidence.map(e => e.sourceId))].map(sourceId => ({
      type: 'object', additionalProperties: false, required: ['sourceId', 'quote'], properties: {
        sourceId: { type: 'string', enum: [sourceId] }, quote: { type: 'string', enum: evidence.filter(e => e.sourceId === sourceId).map(e => e.quote) },
      },
    })) } },
  };
  return { type: 'object', additionalProperties: false, required: ['concepts', 'recommendedIndex', 'reason'], properties: {
    concepts: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties } },
    recommendedIndex: { type: 'integer', minimum: 0, maximum: 2 }, reason: { type: 'string', maxLength: 600 },
  } };
}
function validatedConcepts(text: string, sources: AdResearchSource[]) {
  const result = adConceptsSchema.parse(extractJson(text));
  if (new Set(result.concepts.map(c => c.approach)).size !== 3) throw new Error('The concepts repeated the same approach.');
  for (const concept of result.concepts) {
    if (concept.narration.split(/\s+/).length > 38) throw new Error('The narration exceeds 38 words.');
    if (!concept.evidence.some(e => sources.find(s => s.id === e.sourceId)?.kind === 'audience')) throw new Error('Each concept needs audience evidence, not only the product page.');
    for (const evidence of concept.evidence) {
      const source = sources.find(s => s.id === evidence.sourceId);
      if (!source || !source.body.includes(evidence.quote)) throw new Error('A concept cited text that was not found in its research source.');
    }
  }
  return result;
}
function save(app: App, plan: AdDirectorPlan) {
  const value = { ...plan, updatedAt: app.clock.now() };
  app.db.insert(settings).values({ key: PREFIX + plan.id, value, updatedAt: value.updatedAt }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: value.updatedAt } }).run();
}
export function adDirectorPlans(app: App): AdDirectorPlan[] {
  return app.db.select().from(settings).where(like(settings.key, PREFIX + '%')).all().map(row => {
    const plan = row.value as AdDirectorPlan;
    const task = app.db.select().from(growthTasks).where(eq(growthTasks.id, plan.taskId)).get();
    if (!plan.result && task && ['failed', 'cancelled'].includes(task.status)) return { ...plan, status: 'attention' as const, detail: task.error || 'Planning stopped. Research a new concept set when ready.' };
    return plan;
  }).sort((a, b) => b.createdAt - a.createdAt);
}
function owned(app: App, productId: string, id: string) {
  requireProduct(app, productId);
  const plan = adDirectorPlans(app).find(p => p.id === id && p.productId === productId);
  if (!plan) throw new Error('Ad research was not found for this business.');
  return plan;
}
export function requestAdConcepts(app: App, productId: string, input: unknown) {
  requireProduct(app, productId);
  if (app.env.SIGNAL_OFFLINE === '1') throw new Error('Turn off offline mode to research ad concepts.');
  const brief = adDirectorBriefSchema.parse(input);
  const existing = adDirectorPlans(app).find(p => p.productId === productId && ['queued', 'researching'].includes(p.status));
  if (existing) return existing;
  return app.db.transaction(() => {
    const id = newId(), taskId = queueTask(app, productId, 'ad-concepts', id)!;
    const plan: AdDirectorPlan = { id, taskId, productId, brief, createdAt: app.clock.now(), updatedAt: app.clock.now(), status: 'queued', detail: 'Research queued. Signal will read product and audience sources, then propose three ad concepts.', sources: [], productions: [] };
    save(app, plan); return plan;
  });
}
export async function runAdDirector(app: App, productId: string, id: string, taskId: string, llm: LlmClient, model: string, signal: AbortSignal, read = publicPage, search = findBusinessPages) {
  let plan = owned(app, productId, id);
  if (plan.taskId !== taskId) throw new Error('Ad research task does not match.');
  if (plan.result) return { planId: plan.id, concepts: plan.result.concepts.length };
  const update = (value: Partial<AdDirectorPlan>) => { signal.throwIfAborted(); plan = { ...plan, ...value }; save(app, plan); };
  const product = requireProduct(app, productId), brand = brandProfile(app, productId);
  update({ status: 'researching', detail: 'Reading current product facts and audience problems.' });
  const sources: AdResearchSource[] = [];
  const add = (page: PublicPage, kind: AdResearchSource['kind']) => {
    if (page.body.length < 100 || sources.some(s => s.url === page.url)) return;
    sources.push({ id: 'S' + (sources.length + 1), kind, url: page.url, title: page.title, body: page.body.slice(0, 5000), observedAt: page.observedAt });
  };
  try {
    add(await read(app, product.utmBase, signal), 'product');
    if (!sources.length) throw new Error('The product page did not provide enough readable evidence.');
    const audience = plan.brief.audience || brand.audience;
    const urls = new Set<string>();
    // Search the stated buyer and pain. Search rankings are discovery, not proof of demand.
    for (const query of [`${audience.slice(0, 140)} ${brand.problem.slice(0, 120)} workflow problem`, `${audience.slice(0, 150)} software alternatives frustrations`]) {
      signal.throwIfAborted();
      try { for (const url of (await search(app, query, signal)).slice(0, 3)) urls.add(url); } catch { signal.throwIfAborted(); }
    }
    const recent = app.db.select().from(opportunities).where(eq(opportunities.matchedProductId, productId)).orderBy(desc(opportunities.discoveredAt)).limit(4).all();
    for (const row of recent) urls.add(row.url);
    for (const prior of adDirectorPlans(app).filter(p => p.productId === productId && p.id !== id).slice(0, 3)) {
      for (const source of prior.sources.filter(s => s.kind === 'audience')) urls.add(source.url);
    }
    for (const url of [...urls].slice(0, 8)) {
      signal.throwIfAborted();
      try {
        if (new URL(url).origin === new URL(product.utmBase).origin) continue;
        add(await read(app, url, signal), 'audience');
      } catch { signal.throwIfAborted(); }
      if (sources.filter(s => s.kind === 'audience').length >= 3) break;
    }
    update({ sources });
    if (!sources.some(s => s.kind === 'audience')) throw new Error('No audience source could be read. Check web research access and retry; Signal has not invented customer evidence.');
    update({ detail: 'Developing three distinct concepts and a product demonstration for each.' });
    const prompt = loadPrompt('ad-director', 1);
    const bible = app.video?.bibles().find(value => value.productId === productId);
    const cast = app.video?.characters().filter(value => value.productId === productId && value.approvedAt && value.reference).map(value => ({ name: value.name, description: value.description })) ?? [];
    const evidenceChoices = evidenceOptions(sources, audience + ' ' + brand.problem + ' ' + plan.brief.objective);
    const context = JSON.stringify({ product: { name: product.name, url: product.utmBase }, brand, bible, availableCast: cast, brief: plan.brief, sources, evidenceChoices });
    let result: ReturnType<typeof validatedConcepts> | undefined, validationError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      let text: string;
      try {
        text = (await llm.complete({ model, task: 'video.ad-director', prompt: prompt.render({ context }) + (attempt ? '\nCorrection required: ' + String(validationError).slice(0, 1500) + '\nReturn all three corrected concepts. Keep evidenceChoices sourceId and quote pairs exactly.' : ''), maxTokens: 3500, temperature: 0.4, expectsJson: true, jsonSchema: outputContract(evidenceChoices) })).text;
      } catch (error) { signal.throwIfAborted(); throw validationError ?? error; }
      signal.throwIfAborted();
      try { result = validatedConcepts(text, sources); break; }
      catch (error) { validationError = error; if (attempt === 0) update({ detail: 'Tightening the concepts and checking their citations. The original research is retained.' }); }
    }
    if (!result) throw validationError;
    update({ result, status: 'ready', detail: 'Three researched concepts are ready. Choose an approach, render its opening scene, then add the real product recording.' });
    return { planId: plan.id, concepts: result.concepts.length, sources: sources.length };
  } catch (error) {
    if (!signal.aborted) save(app, { ...plan, sources, status: 'attention', detail: error instanceof Error ? error.message : 'Ad research could not finish.' });
    throw error;
  }
}
export function produceAdConcept(app: App, productId: string, id: string, index: number, characterId: string) {
  const plan = owned(app, productId, id), concept = plan.result?.concepts[index];
  if (!concept || !app.video) throw new Error('Choose a finished concept first.');
  const previous = plan.productions.find(p => p.conceptIndex === index);
  if (previous) return app.video.job(productId, previous.shotId);
  const job = app.video.shot(productId, { title: concept.title, brief: `${concept.scene}\nThis is the opening scene only. The actual product will be shown in a separate screen recording. No generated interfaces, titles or dialogue.`, characterIds: [characterId], duration: 5, ratio: plan.brief.ratio });
  save(app, { ...plan, productions: [...plan.productions, { conceptIndex: index, shotId: job.id }] });
  return job;
}
export function assembleAdConcept(app: App, productId: string, id: string, index: number, productClipId: string) {
  const plan = owned(app, productId, id), concept = plan.result?.concepts[index];
  const production = plan.productions.find(p => p.conceptIndex === index);
  if (!concept || !production || !app.video) throw new Error('Create the opening scene first.');
  if (production.adId) return app.video.job(productId, production.adId);
  const hook = app.video.job(productId, production.shotId), demo = app.video.job(productId, productClipId);
  if (demo.renderer || demo.kind !== 'shot' || !demo.approvedAt || !hook.approvedAt || demo.id === hook.id) throw new Error('Approve the opening clip and an imported product recording before assembly.');
  if (demo.duration < 8) throw new Error('Use a product recording of at least eight seconds.');
  if (!app.video.view().narrationReady) throw new Error('Install local narration in Rendering setup before assembling this narrated ad.');
  const url = new URL(requireProduct(app, productId).utmBase);
  url.searchParams.set('utm_source', 'signal'); url.searchParams.set('utm_medium', 'video'); url.searchParams.set('utm_campaign', 'ad-' + plan.id.slice(0, 10) + '-' + index);
  const job = app.video.assemble(productId, { title: concept.title, ratio: plan.brief.ratio, clips: [{ jobId: hook.id, start: 0, duration: Math.min(5, hook.duration), caption: concept.hook }, { jobId: demo.id, start: 0, duration: 8, caption: '' }], headline: concept.headline, callToAction: concept.callToAction, destination: url.href, narration: { text: concept.narration, voice: 'af_heart', speed: 1, start: 0, captions: true }, keepSourceAudio: false });
  save(app, { ...plan, productions: plan.productions.map(p => p === production ? { ...p, adId: job.id } : p) });
  return job;
}
