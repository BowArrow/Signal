import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { App } from '../src/core/app.js';
import { settings, products, studioCampaigns, studioAssets } from '../src/core/db/schema.js';
import { storyBibleSchema, videoActionSchema, type VideoCharacter } from '../src/shared/video.js';
import { briefSchema, studioCopySchema } from '../src/shared/studio.js';
import { copyWarnings } from '../src/core/studio/store.js';
import { DesktopVideoHost } from '../electron/main/video-host.js';

export function prepareOwnerAdDrafts(app: App, owner: string) {
  const folder = resolve('output/ad-drafts');
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')) as {
    drafts: { key: string; name: string; image: string; description: string; bible: unknown; title: string; audience: string; offer: string; objective: string; script: string; prompt: string; evidence: string[] }[];
  };
  const host = new DesktopVideoHost(join(owner, 'video-assets'), '');
  const report: { business: string; characterId: string; campaignId: string; approved: false; queuedJobs: 0 }[] = [];
  for (const draft of manifest.drafts) {
    if (!['lemonade', 'cinegen'].includes(draft.key)) throw Error('Unexpected draft business');
    const product = app.db.select().from(products).where(eq(products.key, draft.key)).get();
    if (!product || app.operations?.state(product.id).running) throw Error('Expected paused business');
    const marker = 'owner.ad-draft.v1.' + product.id;
    const saved = app.db.select().from(settings).where(eq(settings.key, marker)).get();
    if (saved) { report.push(saved.value as typeof report[number]); continue; }
    const imagePath = resolve(folder, draft.image);
    if (!imagePath.startsWith(folder + '\\') || !draft.image.endsWith('.png')) throw Error('Unexpected reference image path');
    const reference = host.importImage(imagePath); host.data(reference);
    videoActionSchema.parse({ type: 'character', productId: product.id, name: draft.name, description: draft.description, generate: false });
    const bible = storyBibleSchema.parse(draft.bible);
    const brief = briefSchema.parse({ title: draft.title, channel: 'content', objective: draft.objective, audience: draft.audience, offer: draft.offer, formats: ['video-script', 'image-prompt'] });
    const characterId = 'starter-' + draft.key + '-' + draft.name.toLowerCase(), campaignId = 'starter-ad-' + draft.key + '-20260919';
    const character: VideoCharacter = { id: characterId, productId: product.id, name: draft.name, description: draft.description, reference, createdAt: app.clock.now() };
    const url = new URL(product.utmBase); url.searchParams.set('utm_source', 'signal'); url.searchParams.set('utm_medium', 'video'); url.searchParams.set('utm_campaign', campaignId);
    const result = { business: product.name, characterId, campaignId, approved: false as const, queuedJobs: 0 as const };
    app.db.transaction(() => {
      if (app.db.select().from(settings).where(eq(settings.key, 'video.bible.' + product.id)).get()) throw Error('Preserve the existing story bible; reconcile this draft manually.');
      app.db.insert(settings).values({ key: 'video.character.' + characterId, value: character }).run();
      app.db.insert(settings).values({ key: 'video.bible.' + product.id, value: { ...bible, productId: product.id, revision: 1 } }).run();
      app.db.insert(studioCampaigns).values({ id: campaignId, productId: product.id, brief, trackedUrl: url.toString(), createdAt: app.clock.now() }).run();
      for (const kind of ['video-script', 'image-prompt'] as const) {
        const copy = studioCopySchema.parse({ title: kind === 'video-script' ? draft.title : draft.name + ' — fictional character reference', body: kind === 'video-script' ? draft.script : draft.prompt,
          rationale: 'A recurring fictional actor illustrates a specific buyer problem. This is a proposed creative direction, not a real customer story.', evidence: draft.evidence,
          reviewNotes: ['Owner review is required for the character and creative direction.', 'No video was generated. Approve the identity before producing further wardrobe or shot references.', 'Recheck product claims and destination before publication; a saved campaign is not a delivery receipt.'] });
        app.db.insert(studioAssets).values({ id: campaignId + '-' + kind, productId: product.id, campaignId, kind, copy, status: 'draft', warnings: copyWarnings(copy.body), destination: url.toString(), createdAt: app.clock.now() }).run();
      }
      app.db.insert(settings).values({ key: marker, value: result }).run();
    });
    report.push(result);
  }
  writeFileSync(join(folder, 'import-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ drafts: report, published: false, modelStarted: false }));
}
