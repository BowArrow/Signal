import { and, desc, eq } from 'drizzle-orm';
import type { App } from '../app.js';
import { growthExperiments, growthTasks, settings, studioAssets, studioCampaigns, studioLeads, studioOutcomes } from '../db/schema.js';
import { initializeMarketing, marketingSettings, requireProduct } from '../marketing/store.js';
import { dashboard, queueTask } from '../growth/store.js';
import { newId } from '../lib/id.js';
import { hasDisclosure } from '../guardrails/disclosure.js';
import { brandSchema, studioActionSchema, type BrandProfile, type StudioCampaignView, type StudioView } from '../../shared/studio.js';
import { isSalesSuppressed } from '../sales/suppression.js';

export function brandProfile(app: App, productId: string): BrandProfile {
  const product = requireProduct(app, productId);
  const row = app.db.select().from(settings).where(eq(settings.key, `studio.brand.${productId}`)).get();
  return row ? brandSchema.parse(row.value) : {
    audience: product.targetBuyer, problem: product.positioning,
    offer: `Try ${product.name} at ${product.utmBase}. Confirm current pricing before mentioning it.`,
    proof: product.proofPoints.join('\n') || 'No verified proof supplied yet. Do not invent results.',
    voice: marketingSettings(app).voice,
    constraints: 'No invented testimonials, revenue, benchmarks, discounts or product features. Disclose our affiliation when relevant.',
    visualStyle: 'Clear product demonstrations, legible typography, restrained color, real screenshots for product claims.',
  };
}
export function campaignRow(app: App, productId: string, id: string) {
  const row = app.db.select().from(studioCampaigns).where(and(eq(studioCampaigns.id, id), eq(studioCampaigns.productId, productId))).get();
  if (!row) throw new Error('Campaign not found for this product');
  return row;
}
export function copyWarnings(body: string): string[] {
  const warnings: string[] = [];
  if (/\b(?:keeps?|keeping)\s+(?:your\s+)?(?:analysis|processing|workflow)\s+(?:entirely|completely|always)\s+(?:local|on\s+(?:your|the)\s+(?:machine|computer|device))\b/i.test(body)) warnings.push('Qualify the local-processing claim. Local model inference does not mean the entire analysis or workflow stays on the machine.');
  if (/\{\{|\[insert\b|example\.(?:com|invalid)|\bTODO\b/i.test(body)) warnings.push('Replace unfinished placeholders before approval.');
  if (/guaranteed|best in the world|100% accurate|risk.free|\d+\s*%|\$\s*\d/i.test(body)) warnings.push('Verify every numerical, pricing, comparison and guarantee claim against current evidence.');
  if (/testimonial|customer said|"I (?:used|tried)/i.test(body)) warnings.push('Confirm quoted people and firsthand claims are real and authorized.');
  if (/\b(?:nothing|no (?:data|files)) (?:ever )?leaves\b|\b100% offline\b|without sending (?:your |any )?(?:data|files) anywhere|works entirely on your machine/i.test(body)) warnings.push('Qualify absolute privacy claims. Distinguish local inference from setup, licensing, and optional network tools.');
  return warnings;
}
export function creativePromptNeedsRepair(body: string): boolean {
  const positive = body.split(/\n|(?<=[.!?])\s+/).filter(line => !/^\s*(?:[-*]\s*)?(?:negative|avoid|no\b|do not|never|exclude)/i.test(line));
  return positive.some(line => /\b(?:screenshot|interface|dashboard|UI|file explorer|prompt box)\b/i.test(line));
}
export function studioView(app: App): StudioView {
  initializeMarketing(app);
  const products = dashboard(app).products.map(p => { const product = requireProduct(app, p.id); return { id: p.id, name: p.name, currency: p.currency, url: product.utmBase, brand: brandProfile(app, p.id) }; });
  const ids = new Set(products.map(p => p.id));
  const outcomes = app.db.select().from(studioOutcomes).orderBy(desc(studioOutcomes.createdAt)).all().filter(row => ids.has(row.productId));
  const campaigns = app.db.select().from(studioCampaigns).orderBy(desc(studioCampaigns.createdAt)).all().filter(row => ids.has(row.productId)).map(row => {
    const task = app.db.select().from(growthTasks).where(and(eq(growthTasks.targetId, row.id), eq(growthTasks.kind, 'studio'))).orderBy(desc(growthTasks.createdAt)).get();
    const totals: StudioCampaignView['totals'] = { visits: 0, leads: 0, activations: 0, sales: 0, retained: 0, revenueCents: 0, refundCents: 0, spendCents: 0 };
    for (const { value } of outcomes.filter(o => o.productId === row.productId && o.value.campaignId === row.id)) {
      if (value.kind === 'sale') { totals.sales += value.count; totals.revenueCents += value.amountCents; }
      else if (value.kind === 'refund') totals.refundCents += value.amountCents;
      else if (value.kind === 'spend') totals.spendCents += value.amountCents;
      else totals[value.kind] += value.count;
    }
    return { ...row, totals, task: task ? { id: task.id, status: task.status, error: task.error } : null };
  });
  return { products, campaigns, outcomes, assets: app.db.select().from(studioAssets).all().filter(row => ids.has(row.productId)), leads: app.db.select().from(studioLeads).orderBy(desc(studioLeads.createdAt)).all().filter(row => ids.has(row.productId)) };
}
export function studioAction(app: App, input: unknown): StudioView {
  initializeMarketing(app); const action = studioActionSchema.parse(input); const product = requireProduct(app, action.productId);
  app.db.transaction(() => {
    if (action.type === 'brand') {
      app.db.insert(settings).values({ key: `studio.brand.${product.id}`, value: action.value, updatedAt: app.clock.now() }).onConflictDoUpdate({ target: settings.key, set: { value: action.value, updatedAt: app.clock.now() } }).run();
    } else if (action.type === 'campaign') {
      const id = newId(); const url = new URL(product.utmBase);
      url.searchParams.set('utm_source', 'signal'); url.searchParams.set('utm_medium', action.value.channel); url.searchParams.set('utm_campaign', id);
      if (action.value.experimentId) {
        const experiment = app.db.select().from(growthExperiments).where(and(eq(growthExperiments.id, action.value.experimentId), eq(growthExperiments.productId, product.id))).get();
        if (!experiment) throw new Error('Choose an experiment belonging to this product.');
        // Preserve the experiment attribution contract when linking existing work.
        app.db.insert(studioCampaigns).values({ id, productId: product.id, brief: action.value, trackedUrl: experiment.trackedUrl, createdAt: app.clock.now() }).run();
      } else app.db.insert(studioCampaigns).values({ id, productId: product.id, brief: action.value, trackedUrl: url.toString(), createdAt: app.clock.now() }).run();
    } else if (action.type === 'generate') {
      const campaign = campaignRow(app, product.id, action.id);
      const assets = app.db.select().from(studioAssets).where(eq(studioAssets.campaignId, campaign.id)).all();
      if (campaign.brief.formats.every(kind => assets.some(a => a.kind === kind))) throw new Error('All requested formats are ready. Edit them or create a new campaign for another angle.');
      queueTask(app, product.id, 'studio', campaign.id);
    } else if (action.type === 'lead') {
      if (isSalesSuppressed(app, product.id, action.value.contact) && (action.value.permission !== 'do-not-contact' || action.value.followUpAt !== null)) throw new Error('This email is suppressed in Sales. Keep do-not-contact and no scheduled follow-up.');
      if (action.value.campaignId) campaignRow(app, product.id, action.value.campaignId);
      if (action.id) {
        const row = app.db.select().from(studioLeads).where(and(eq(studioLeads.id, action.id), eq(studioLeads.productId, product.id))).get();
        if (!row) throw new Error('Lead not found for this product');
        app.db.update(studioLeads).set({ value: action.value }).where(eq(studioLeads.id, row.id)).run();
      } else app.db.insert(studioLeads).values({ id: newId(), productId: product.id, value: action.value, createdAt: app.clock.now() }).run();
    } else if (action.type === 'outcomes') {
      for (const value of action.values) {
        campaignRow(app, product.id, value.campaignId);
        if (value.occurredAt > app.clock.now() + 60000) throw new Error('An observed outcome cannot be in the future.');
        const existing = app.db.select().from(studioOutcomes).where(and(eq(studioOutcomes.productId, product.id), eq(studioOutcomes.reference, value.reference))).get();
        if (existing) { if (JSON.stringify(existing.value) !== JSON.stringify(value)) throw new Error(`Reference ${value.reference} already has different data. Use a new correction reference.`); continue; }
        app.db.insert(studioOutcomes).values({ id: newId(), productId: product.id, reference: value.reference, value, createdAt: app.clock.now() }).run();
      }
    } else {
      const asset = app.db.select().from(studioAssets).where(and(eq(studioAssets.id, action.id), eq(studioAssets.productId, product.id))).get();
      if (!asset) throw new Error('Asset not found for this product');
      if (asset.status === 'published') throw new Error('Published copy is preserved. Create a new campaign for revisions.');
      if (action.type === 'edit') app.db.update(studioAssets).set({ copy: { ...asset.copy, body: action.body }, warnings: copyWarnings(action.body), status: 'draft' }).where(eq(studioAssets.id, asset.id)).run();
      if (action.type === 'review') {
        if (action.approved && (new Set(action.checks).size !== 3 || copyWarnings(asset.copy.body).some(w => /^(Replace unfinished|Qualify absolute)/.test(w)))) throw new Error('Verify claims, voice, and destination, remove placeholders, and qualify absolute privacy claims before approval.');
        if (action.approved && ['social', 'sales-message', 'press-pitch'].includes(asset.kind) && !hasDisclosure(asset.copy.body)) throw new Error('Include a clear founder affiliation disclosure before approving this material.');
        if (action.approved && asset.kind === 'image-prompt' && creativePromptNeedsRepair(asset.copy.body)) throw new Error('Use real captures for product interfaces. Make this render prompt a conceptual image without invented software screens.');
        app.db.update(studioAssets).set({ status: action.approved ? 'approved' : 'rejected' }).where(eq(studioAssets.id, asset.id)).run();
      }
      if (action.type === 'schedule') app.db.update(studioAssets).set({ dueAt: action.dueAt, destination: action.destination }).where(eq(studioAssets.id, asset.id)).run();
      if (action.type === 'published') {
        if (asset.status !== 'approved') throw new Error('Approve this material before recording publication.');
        if (!['https:', 'http:'].includes(new URL(action.url).protocol)) throw new Error('Use the real public HTTP(S) URL.');
        app.db.update(studioAssets).set({ status: 'published', publishedUrl: action.url, publicationNote: action.note }).where(eq(studioAssets.id, asset.id)).run();
      }
    }
  });
  return studioView(app);
}
export function exportCampaign(app: App, productId: string, campaignId: string): string {
  const campaign = campaignRow(app, productId, campaignId); const product = requireProduct(app, productId);
  const assets = app.db.select().from(studioAssets).where(eq(studioAssets.campaignId, campaignId)).all();
  return `# ${campaign.brief.title}\n\nBusiness: ${product.name}\nChannel: ${campaign.brief.channel}\nObjective: ${campaign.brief.objective}\nAudience: ${campaign.brief.audience}\nOffer: ${campaign.brief.offer}\nTracked destination: ${campaign.trackedUrl}\n\n` + assets.map(asset => `## ${asset.kind}: ${asset.copy.title}\n\nStatus: ${asset.status}\n\n${asset.copy.body}\n\n### Evidence\n${asset.copy.evidence.map(e => `- ${e}`).join('\n')}\n\n### Review notes\n${[...asset.copy.reviewNotes, ...asset.warnings].map(e => `- ${e}`).join('\n')}\n`).join('\n');
}
