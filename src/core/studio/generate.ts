import { and, eq } from 'drizzle-orm';
import type { App } from '../app.js';
import type { LlmClient } from '../llm/client.js';
import { extractJson } from '../llm/client.js';
import { growthTasks, studioAssets } from '../db/schema.js';
import { brandProfile, campaignRow, copyWarnings, creativePromptNeedsRepair } from './store.js';
import { hasDisclosure } from '../guardrails/disclosure.js';
import { requireProduct, recall } from '../marketing/store.js';
import { studioCopySchema } from '../../shared/studio.js';
import { PLAYBOOKS } from '../../shared/playbooks.js';
import { newId } from '../lib/id.js';
import { loadPrompt } from '../prompts/loader.js';

const copyJsonSchema = { type: 'object', additionalProperties: false,
  required: ['title', 'body', 'rationale', 'evidence', 'reviewNotes'], properties: {
    title: { type: 'string' }, body: { type: 'string' }, rationale: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } }, reviewNotes: { type: 'array', items: { type: 'string' } },
  } };

export async function generateCampaign(app: App, productId: string, campaignId: string, taskId: string, llm: LlmClient, model: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const campaign = campaignRow(app, productId, campaignId); const product = requireProduct(app, productId);
  const brand = brandProfile(app, productId);
  const context = { product: { name: product.name, url: product.utmBase, currency: product.currency }, brand, brief: campaign.brief, trackedUrl: campaign.trackedUrl,
    playbook: PLAYBOOKS.find(p => p.channel === campaign.brief.channel), evidence: recall(app, productId, campaign.brief.objective).memories.map(m => ({ id: m.id, kind: m.kind, source: m.source, body: m.body.slice(0, 1000) })) };
  const owns = () => { signal.throwIfAborted(); if (!app.db.select().from(growthTasks).where(and(eq(growthTasks.id, taskId), eq(growthTasks.status, 'running'))).get()) throw new Error('Campaign generation was cancelled.'); };
  const ids: string[] = [];
  for (const kind of campaign.brief.formats) {
    owns(); const existing = app.db.select().from(studioAssets).where(and(eq(studioAssets.campaignId, campaignId), eq(studioAssets.kind, kind))).get();
    if (existing) { ids.push(existing.id); continue; }
    let feedback = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      owns(); app.db.update(growthTasks).set({ updatedAt: app.clock.now(), output: { progress: `Creating ${kind}`, assetsReady: ids.length, total: campaign.brief.formats.length } }).where(eq(growthTasks.id, taskId)).run();
      const response = await llm.complete({ model, task: 'studio.create', prompt: loadPrompt('studio', 1).render({ context: JSON.stringify(context), kind, feedback }), maxTokens: 3500, temperature: 0.2, expectsJson: true, jsonSchema: copyJsonSchema });
      owns();
      try {
        const copy = studioCopySchema.parse(extractJson(response.text));
        if (copyWarnings(copy.body).some(w => w.startsWith('Replace unfinished'))) throw new Error('Replace placeholders with finished, product-specific material.');
        if (copyWarnings(copy.body).some(w => w.startsWith('Qualify absolute'))) throw new Error('Remove absolute privacy language such as nothing leaves your computer, works entirely on your machine, or without sending files anywhere. State the narrower verified fact: model inference runs locally; setup, licensing and optional approved tools may use the network.');
        if (kind === 'image-prompt' && creativePromptNeedsRepair(copy.body)) throw new Error('Do not describe any software interface, screenshot, dashboard, prompt box, or file explorer. Return a single conceptual brand photograph of physical objects or an abstract illustration. No product screens or rendered text.');
        if (['social', 'sales-message', 'press-pitch'].includes(kind) && !hasDisclosure(copy.body)) copy.body = `Disclosure: I build ${product.name}.\n\n${copy.body}`;
        if (kind !== 'image-prompt' && !copy.body.includes(campaign.trackedUrl)) copy.body += `\n\nNext step: ${campaign.trackedUrl}`;
        const id = newId();
        app.db.insert(studioAssets).values({ id, productId, campaignId, kind, copy, warnings: copyWarnings(copy.body), createdAt: app.clock.now() }).run();
        ids.push(id); break;
      } catch (error) { if (attempt === 1) throw error; feedback = `Repair the previous response: ${String(error).slice(0, 2000)}. Return the complete JSON object.`; }
    }
  }
  return { summary: `${ids.length} campaign materials saved for review.`, assetIds: ids, campaignId };
}
