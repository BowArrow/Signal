import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { dashboard } from '../../src/core/growth/store.js';
import { adDirectorPlans, requestAdConcepts, runAdDirector, produceAdConcept, assembleAdConcept } from '../../src/core/video/ad-director.js';
import { VideoService } from '../../src/core/video/service.js';
import { settings } from '../../src/core/db/schema.js';
import { videoConfigSchema, type VideoAsset } from '../../src/shared/video.js';
import { ScriptedLlmClient } from '../../src/core/llm/client.js';
import { requireProduct } from '../../src/core/marketing/store.js';
import type { PublicPage, publicPage } from '../../src/core/marketing/web.js';

let app: App;
let productId: string;
const quote = 'Finding the source paragraph across several client reports is the slow part of preparing a proposal.';
const result = () => ({ concepts: (['demonstration', 'visual-metaphor', 'relatable-scene'] as const).map(approach => ({ title: 'The missing paragraph: ' + approach, approach, buyerProblem: 'Find evidence in several client reports.', insight: 'This source describes a concrete report retrieval problem, not a general dislike of work.', evidence: [{ sourceId: 'S2', quote }], hook: 'Which report had that paragraph?', scene: 'A consultant scans two folders, stops on a matching page and relaxes their shoulders. The camera holds on the same person and desk for five seconds.', productDemo: 'Record the real app searching two sample client reports. Show the returned passage and its source file. Do not fabricate search results.', narration: 'Lemonade helps you work from your documents. See the source, then start your draft. Watch how it works.', headline: 'Work from your documents', callToAction: 'See how it works', hypothesis: 'A specific retrieval problem may attract consultants preparing proposals.', measure: 'Compare qualified visits and trials, then paid outcomes. No result has been observed yet.' })), recommendedIndex: 0, reason: 'The demonstration makes the workflow concrete. Its performance remains untested.' });
beforeEach(() => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null);
  app = createApp({ databaseUrl: ':memory:', logger: silentLogger });
  productId = dashboard(app).products[0]!.id;
});
afterEach(() => { app.close(); vi.unstubAllEnvs(); __setConfigForTests(null); });
const brief = { objective: 'Demonstrate finding evidence in reports and invite a trial.', audience: 'Independent consultants', ratio: '9:16' };
function reader(): typeof publicPage {
  return async (_app, url) => ({ url, title: 'Research fixture', body: (url === requireProduct(app, productId).utmBase ? 'Lemonade works with documents. Source-backed product information. ' : quote + ' ') .repeat(3), observedAt: app.clock.now(), trust: 'untrusted' } satisfies PublicPage);
}
it('queues one durable task per business and retains researched concepts with exact source quotes', async () => {
  const plan = requestAdConcepts(app, productId, brief);
  expect(requestAdConcepts(app, productId, brief).id).toBe(plan.id);
  await runAdDirector(app, productId, plan.id, plan.taskId, new ScriptedLlmClient([JSON.stringify(result())]), 'fixture', new AbortController().signal, reader(), async () => ['https://audience.example/report']);
  expect(adDirectorPlans(app)[0]).toMatchObject({ status: 'ready', result: { recommendedIndex: 0 }, productions: [] });
  expect(adDirectorPlans(app)[0]!.sources).toHaveLength(2);
});
it('rejects fabricated citations rather than presenting them as research', async () => {
  const plan = requestAdConcepts(app, productId, brief), invalid = result();
  invalid.concepts[0]!.evidence[0]!.quote = 'This sentence never appeared in the source.';
  await expect(runAdDirector(app, productId, plan.id, plan.taskId, new ScriptedLlmClient([JSON.stringify(invalid)]), 'fixture', new AbortController().signal, reader(), async () => ['https://audience.example/report'])).rejects.toThrow('not found');
  expect(adDirectorPlans(app)[0]!.status).toBe('attention');
  expect(adDirectorPlans(app)[0]!.result).toBeUndefined();
});
it('repairs invalid model output once without repeating web research', async () => {
  const plan = requestAdConcepts(app, productId, brief), invalid = result();
  invalid.concepts[0]!.evidence[0]!.sourceId = 'S1';
  const llm = new ScriptedLlmClient([JSON.stringify(invalid), JSON.stringify(result())]);
  const read = vi.fn(reader());
  await runAdDirector(app, productId, plan.id, plan.taskId, llm, 'fixture', new AbortController().signal, read, async () => ['https://audience.example/report']);
  expect(read).toHaveBeenCalledTimes(2);
  expect(llm.calls).toHaveLength(2);
  expect(llm.calls[0]!.jsonSchema).toBeDefined();
  expect(adDirectorPlans(app)[0]!.status).toBe('ready');
});
it('does not invent audience research when search and page access fail', async () => {
  const plan = requestAdConcepts(app, productId, brief), llm = new ScriptedLlmClient([]);
  await expect(runAdDirector(app, productId, plan.id, plan.taskId, llm, 'fixture', new AbortController().signal, reader(), async () => { throw new Error('Search unavailable'); })).rejects.toThrow('No audience source');
  expect(adDirectorPlans(app)[0]!.sources).toHaveLength(1);
});
it('enforces business ownership and cancellation before reading or rendering', async () => {
  const plan = requestAdConcepts(app, productId, brief), other = dashboard(app).products[1]!.id;
  expect(() => produceAdConcept(app, other, plan.id, 0, 'cast')).toThrow('not found');
  const controller = new AbortController(); controller.abort(); const read = vi.fn(reader());
  await expect(runAdDirector(app, productId, plan.id, plan.taskId, new ScriptedLlmClient([]), 'fixture', controller.signal, read, async () => [])).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});
it('requires distinct creative approaches and a short narration', async () => {
  const plan = requestAdConcepts(app, productId, brief), invalid = result();
  invalid.concepts[1]!.approach = 'demonstration';
  await expect(runAdDirector(app, productId, plan.id, plan.taskId, new ScriptedLlmClient([JSON.stringify(invalid)]), 'fixture', new AbortController().signal, reader(), async () => ['https://audience.example/report'])).rejects.toThrow('same approach');
});
it('retains one render per concept and requires approved real footage before narrated assembly', async () => {
  const asset: VideoAsset = { file: 'a'.repeat(64) + '.jpg', sha256: 'a'.repeat(64), bytes: 100, mime: 'image/jpeg' };
  const clip: VideoAsset = { file: 'b'.repeat(64) + '.mp4', sha256: 'b'.repeat(64), bytes: 300, mime: 'video/mp4' };
  const service = new VideoService(app, { available: () => true, get: () => undefined, set: () => {}, delete: () => {} }, {
    toolReady: () => true, narrationReady: () => true, data: () => 'data:image/jpeg;base64,Zml4dHVyZQ==',
    blockout: async () => clip, download: async () => clip, assemble: async () => clip, frames: async () => [], saveImage: () => asset, saveVideo: () => clip,
  });
  app.video = service;
  service.configure(videoConfigSchema.parse({ localModel: 'ltx25', renderer: 'local', ffmpegPath: 'ffmpeg.exe', blenderPath: '', dailyCloudLimit: 0 }));
  const character = await service.character(productId, 'Maya', 'A fictional consultant with curly brown hair and a green sweater.', asset);
  service.approveCharacter(productId, character.id);
  const plan = requestAdConcepts(app, productId, brief);
  await runAdDirector(app, productId, plan.id, plan.taskId, new ScriptedLlmClient([JSON.stringify(result())]), 'fixture', new AbortController().signal, reader(), async () => ['malformed source', 'https://audience.example/report']);
  const shot = produceAdConcept(app, productId, plan.id, 0, character.id);
  expect(produceAdConcept(app, productId, plan.id, 0, character.id).id).toBe(shot.id);
  expect(service.jobs()).toHaveLength(1);
  const demo = { ...shot, id: 'real-product', renderer: undefined, output: clip, duration: 10, phase: 'ready' as const };
  app.db.insert(settings).values({ key: 'video.job.' + demo.id, value: demo }).run();
  expect(() => assembleAdConcept(app, productId, plan.id, 0, demo.id)).toThrow('Approve');
  for (const job of [{ ...shot, output: clip, phase: 'ready' }, demo]) app.db.insert(settings).values({ key: 'video.job.' + job.id, value: { ...job, approvedAt: app.clock.now() } }).onConflictDoUpdate({ target: settings.key, set: { value: { ...job, approvedAt: app.clock.now() } } }).run();
  const ad = assembleAdConcept(app, productId, plan.id, 0, demo.id);
  expect(ad.kind).toBe('ad');
  expect(ad.approvedAt).toBeUndefined();
  expect(ad.assembly?.narration?.text).toContain('Lemonade');
  expect(ad.assembly?.destination).toContain('utm_campaign=ad-');
  expect(assembleAdConcept(app, productId, plan.id, 0, demo.id).id).toBe(ad.id);
  expect(service.jobs()).toHaveLength(3);
});
