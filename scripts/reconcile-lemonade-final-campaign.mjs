/* global fetch, AbortSignal, URL */
// Reconcile one owner campaign with its completed media. No publication or generation.
// Run: node --import tsx scripts/reconcile-lemonade-final-campaign.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { briefSchema, studioCopySchema } from '../src/shared/studio.ts';
import { copyWarnings } from '../src/core/studio/store.ts';
import { hasDisclosure } from '../src/core/guardrails/disclosure.ts';

const campaignId = 'lemonade-ltd-video-20260921';
const media = resolve('output/openart-ads/final/lemonade-final.mp4');
const page = 'https://siplemona.de/ads/lemonade-ltd/';
const htmlResponse = await fetch(page, { signal: AbortSignal.timeout(20000) });
assert(htmlResponse.ok);
const html = await htmlResponse.text();
const source = html.match(/(?:src|srcset)="([^"]+\.mp4)"/);
assert(source, 'Public ad page must expose the finished video');
const videoUrl = new URL(source[1], page); assert.equal(videoUrl.origin, 'https://siplemona.de');
const response = await fetch(videoUrl, { signal: AbortSignal.timeout(30000) }); assert(response.ok);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sha256 = digest(readFileSync(media));
assert.equal(digest(Buffer.from(await response.arrayBuffer())), sha256, 'Public video must match the completed local file');
const homepage = await fetch('https://siplemona.de/', { signal: AbortSignal.timeout(20000) }); assert(homepage.ok);
const offer = await homepage.text(); assert(offer.includes('$49') && /14.day/i.test(offer));

const db = new DatabaseSync(join(process.env.APPDATA, 'signal', 'signal.db'));
db.exec('PRAGMA busy_timeout=5000');
let result;
try {
  db.exec('BEGIN IMMEDIATE');
  const campaign = db.prepare('SELECT * FROM studio_campaigns WHERE id=?').get(campaignId); assert(campaign);
  const product = db.prepare('SELECT key FROM products WHERE id=?').get(campaign.product_id); assert.equal(product.key, 'lemonade');
  const policyRow = db.prepare('SELECT value FROM settings WHERE key=?').get('operations.policy.' + campaign.product_id);
  assert(!JSON.parse(policyRow?.value || '{}').running, 'Preserve a running operation');
  const assets = db.prepare('SELECT * FROM studio_assets WHERE campaign_id=?').all(campaignId);
  assert(assets.every(asset => !['published', 'approved'].includes(asset.status)), 'Preserve reviewed or published materials');
  assert(!assets.some(asset => asset.kind === 'social'), 'Caption already exists; do not overwrite owner edits');
  const video = assets.find(asset => asset.kind === 'video-script');
  const image = assets.find(asset => asset.kind === 'image-prompt'); assert(video && image);
  const directory = resolve('output/campaign-reconciliation'); mkdirSync(directory, { recursive: true });
  const backup = join(directory, `before-${campaignId}-${Date.now()}.json`);
  writeFileSync(backup, JSON.stringify({ campaign, assets }, null, 2), { flag: 'wx' });
  const brief = briefSchema.parse({ ...JSON.parse(campaign.brief), objective: 'Distribute the completed narrated product ad to relevant buyers, support their first useful trial task, and measure tracked visits and Stripe purchases. Community placement remains pending.', formats: ['video-script', 'social'], offer: '$49 USD once for a personal license on up to 3 computers; 14-day trial with no credit card. Windows 11 and Linux.' });
  db.prepare('UPDATE studio_campaigns SET brief=? WHERE id=?').run(JSON.stringify(brief), campaignId);
  const details = studioCopySchema.parse({
    title: 'Finished Lemonade ad — video file and posting instructions',
    body: `The finished ad is ready to use. Do not generate another hook.\n\nVIDEO FILE\n${media}\n\nWATCH ONLINE\n${page}\n\nDELIVERY\n20 seconds; portrait 720 x 1280; H.264 video with narration, music and AAC stereo audio. Product footage uses example documents. The opening fictional actor is not a customer testimonial.\n\nPOSTING\nUse the separate social caption below. Attach lemonade-final.mp4 in the social platform's composer, check the caption and destination account, then publish when ready. Record the actual post URL on the social material after publication. Signal's Approve material button records a review; it does not upload this video.\n\nCAMPAIGN LINK\n${campaign.tracked_url}\n\nThis card is an internal handoff, not a public caption. Group placements are still pending; no social publication is claimed.`,
    rationale: 'The completed video replaces the obsolete six-second production plan.',
    evidence: [page, 'https://siplemona.de/', 'output/openart-ads/final/final-report.json', `SHA-256: ${sha256}`],
    reviewNotes: ['Public MP4 bytes match the local finished file. No new generation was run.', 'Use the separate social material for public copy. No upload or social publication was performed.'],
  });
  db.prepare('UPDATE studio_assets SET copy=?,warnings=?,destination=?,due_at=NULL WHERE id=?').run(JSON.stringify(details), JSON.stringify(copyWarnings(details.body)), 'Internal handoff: final video file', video.id);
  const previousImage = JSON.parse(image.copy);
  const retired = studioCopySchema.parse({ ...previousImage, title: 'Retired production reference — final video already completed', body: 'Retired from this launch. The finished video already contains the selected fictional character. No additional reference generation is needed. Original production instructions are preserved below for history.\n\n' + previousImage.body, reviewNotes: ['Superseded by the completed video. This image prompt is not a posting task.'] });
  db.prepare('UPDATE studio_assets SET copy=?,status=?,due_at=NULL,destination=? WHERE id=?').run(JSON.stringify(retired), 'rejected', 'Historical reference only', image.id);
  const caption = `Before you send that report, ask what doesn't add up.\n\nOur app, Lemonade, works with your files on your PC.\n\n14 days free. $49 once. Windows 11/Linux.\n\n${campaign.tracked_url}`;
  assert(caption.length <= 300 && hasDisclosure(caption));
  assert(caption.replace(/https:\/\/\S+/g, 'x'.repeat(23)).length <= 280);
  const social = studioCopySchema.parse({ title: 'Ready-to-post caption — X / Bluesky', body: caption, rationale: 'One practical document task, clear founder affiliation and the existing tracked trial link.', evidence: ['https://siplemona.de/', page], reviewNotes: ['Attach the finished lemonade-final.mp4 file when posting manually to your AIonX account.', 'Review claims, voice and the selected destination before approval. Approval does not publish.', 'Record the actual public post URL only after publication. The campaign link is the visitor destination, not the social post URL.'] });
  db.prepare('INSERT INTO studio_assets (id,product_id,campaign_id,kind,copy,status,warnings,destination,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(campaignId + '-social', campaign.product_id, campaignId, 'social', JSON.stringify(social), 'draft', JSON.stringify(copyWarnings(caption)), 'Choose AIonX X or AIonX Bluesky for the first placement', Date.now());
  assert.equal(db.prepare("SELECT count(*) n FROM studio_assets WHERE campaign_id=? AND kind='social' AND status='draft'").get(campaignId).n, 1);
  db.exec('COMMIT');
  result = { campaignId, backup, publicVideoMatches: true, videoSha256: sha256, newCaption: true, obsoleteImagePromptRetired: true, published: false, generationStarted: false };
  writeFileSync(join(directory, 'lemonade-final-result.json'), JSON.stringify(result, null, 2));
} catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
finally { db.close(); }
console.log(JSON.stringify(result));
