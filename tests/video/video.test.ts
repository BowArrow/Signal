import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { ConnectionService, type CredentialVault } from '../../src/core/connections/service.js';
import { settings, growthTasks, marketingMessages } from '../../src/core/db/schema.js';
import { executeMarketingTool, runMarketingAgent } from '../../src/core/marketing/agent.js';
import { ScriptedLlmClient } from '../../src/core/llm/client.js';
import { VideoService, type VideoHost } from '../../src/core/video/service.js';
import { VideoProviders, minimaxInput } from '../../src/core/video/providers.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { VideoCampaignService } from '../../src/core/video/campaigns.js';
import { h3Workflow, H3_MODELS, LocalVideoRenderer } from '../../src/core/video/comfy.js';
import { ltxWorkflow, LTX_MODEL_INPUTS } from '../../src/core/video/ltx.js';
import { videoConfigSchema, videoFrames, type VideoAsset, type VideoJob, type VideoShot } from '../../src/shared/video.js';

let app: App; let service: VideoService; let product: string; let other: string; let clock: ReturnType<typeof fixedClock>;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>; let host: VideoHost; let llm: ScriptedLlmClient; let secrets: Map<string, string>; let replies: string[];
const asset: VideoAsset = { file: 'a'.repeat(64) + '.jpg', sha256: 'a'.repeat(64), bytes: 200, mime: 'image/jpeg' };
const output: VideoAsset = { file: 'b'.repeat(64) + '.mp4', sha256: 'b'.repeat(64), bytes: 300, mime: 'video/mp4' };
const plan = (id: string): VideoShot => ({ description: 'The character walks toward a desk in a bright office.', openingAction: 'Already walking toward the desk.', geometry: 'Character foreground left, desk in the background right.', lensMm: 35, lighting: 'Warm daylight from a large left window.', acting: 'Focused gaze on the desk, shoulders relax on arrival.', beats: [{ start: 0, end: 2, action: 'Walk purposefully toward the desk.' }, { start: 2, end: 5, action: 'Pause beside the desk and look down.' }], environment: 'office', cameraStart: [0, -5, 2], cameraEnd: [1, -5, 2], lookAt: [0, 0, 1], actors: [{ characterId: id, start: [-1, 0, 0], end: [1, 1, 0] }] });
const review = { consistent: true, polished: true, followsBrief: true, issues: [], description: 'The same fictional character and wardrobe appear consistently in these sampled frames.' };
beforeEach(() => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); clock = fixedClock(1789700000000); app = createApp({ databaseUrl: ':memory:', logger: silentLogger, clock });
  secrets = new Map([['video.minimax', 'private-video-key'], ['video.higgsfield', 'private-id:private-secret']]); const vault: CredentialVault = { available: () => true, get: key => secrets.get(key), set: (key, value) => { secrets.set(key, value); }, delete: key => { secrets.delete(key); } };
  const products = new ConnectionService(app, vault).view().products; product = products[0]!.id; other = products[1]!.id;
  host = { toolReady: () => true, blockout: vi.fn(async () => output), download: vi.fn(async () => output), data: a => `data:${a.mime};base64,${Buffer.from('fixture').toString('base64')}`, frames: vi.fn(async () => Array(6).fill('data:image/jpeg;base64,Zml4dHVyZQ==') as string[]), saveImage: vi.fn(() => asset), saveVideo: vi.fn(() => output) };
  replies = []; llm = new ScriptedLlmClient(replies); fetcher = vi.fn(async () => { throw new Error('Unexpected network access'); });
  service = new VideoService(app, vault, host, fetcher, llm); app.video = service;
  service.configure(videoConfigSchema.parse({ blenderPath: 'blender.exe', ffmpegPath: 'ffmpeg.exe', dailyCloudLimit: 2, h3DailyBudgetUsd: 10, h3MaxShotUsd: 3, renderer: 'cloud' }));
});
afterEach(async () => { await service.stop(); app.close(); vi.unstubAllEnvs(); __setConfigForTests(null); });
async function cast() { const c = await service.character(product, 'Maya', 'A fictional adult with curly brown hair and a plain blue jacket.', asset); service.approveCharacter(product, c.id); return c; }
async function queued(renderer: 'local' | 'cloud' = 'cloud') { const c = await cast(); service.configure({ ...service.config(), renderer }); return service.shot(product, { title: 'Find the answer', brief: 'The character walks toward the desk and finds the document they need.', characterIds: [c.id], duration: 5, ratio: '16:9' }); }
function save(job: VideoJob) { app.db.update(settings).set({ value: job }).where(eq(settings.key, 'video.job.' + job.id)).run(); }

it('requires a cloud dollar budget and includes the equal-duration guide in the estimate', async () => {
  const c = await cast(); const brief = { title: 'Cloud test', brief: 'A character discovers the right document at their desk.', characterIds: [c.id], duration: 5, ratio: '16:9' };
  service.configure({ ...service.config(), h3DailyBudgetUsd: 0, h3MaxShotUsd: 0 });
  expect(() => service.shot(product, brief)).toThrow('per-shot');
  service.configure({ ...service.config(), h3DailyBudgetUsd: 1, h3MaxShotUsd: 0.79 });
  expect(() => service.shot(product, brief)).toThrow('per-shot');
  service.configure({ ...service.config(), h3DailyBudgetUsd: 1, h3MaxShotUsd: 0.8 });
  const job = service.shot(product, brief); save({ ...job, shot: plan(c.id), blockout: output });
  fetcher.mockResolvedValue(Response.json({ task_id: 'priced-cloud-shot' }));
  await service.tick();
  expect(service.job(product, job.id).cloudEstimate).toEqual({ cents: 80, priceRevision: '2026-09-19-h3-768p' });
  expect(service.cloudBudget().attemptedCents).toBe(80);
  expect(fetcher).toHaveBeenCalledOnce();
});

it('rechecks the shared dollar budget immediately before submitting queued shots', async () => {
  service.configure({ ...service.config(), dailyCloudLimit: 10, h3DailyBudgetUsd: 1.5 });
  const first = await queued();
  const foreign = await service.character(other, 'Alex', 'A fictional adult with short brown hair and a plain blue jacket.', asset); service.approveCharacter(other, foreign.id);
  const second = service.shot(other, { title: 'Other cloud shot', brief: first.brief, characterIds: [foreign.id], duration: 5, ratio: '16:9' });
  save({ ...first, shot: plan(first.characters[0]!.id), blockout: output });
  save({ ...second, shot: plan(second.characters[0]!.id), blockout: output });
  fetcher.mockResolvedValue(Response.json({ task_id: 'first-cloud-shot' }));
  await service.tick();
  service.pause(product, first.id);
  await service.tick();
  expect(fetcher).toHaveBeenCalledOnce();
  expect(service.job(other, second.id)).toMatchObject({ phase: 'attention' });
  expect(service.job(other, second.id).detail).toContain('budget');
  expect(service.job(other, second.id).submittedAt).toBeUndefined();
  expect(service.cloudBudget().attemptedCents).toBe(80);
});

it('retains uncertain cloud cost across service restart and never resubmits that job', async () => {
  const job = await queued(); save({ ...job, shot: plan(job.characters[0]!.id), blockout: output });
  await service.tick(); // The request throws after the durable submission marker.
  expect(service.job(product, job.id)).toMatchObject({ phase: 'attention', cloudEstimate: { cents: 80 } });
  const restarted = new VideoService(app, { available: () => true, get: key => secrets.get(key), set: () => {}, delete: () => {} }, host, fetcher, llm);
  expect(restarted.cloudBudget().attemptedCents).toBe(80);
  expect(() => restarted.resume(product, job.id)).toThrow('unknown');
  await restarted.tick(); expect(fetcher).toHaveBeenCalledOnce();
  clock.advance(86400001); expect(restarted.cloudBudget().attemptedCents).toBe(0);
});

it('holds queued H3 jobs before runtime startup and keeps CPU ad editing available', async () => {
  const job = await queued('local');
  const detail = 'Local H3 rendering is paused after an unexpected Windows restart.';
  host.localRenderHold = () => detail;
  app.ensureVideoRuntime = vi.fn(async () => {});
  expect(await service.checkLocal()).toEqual({ ready: false, missing: [], detail });
  expect(service.view().localRenderHold).toBe(detail);
  expect(service.context(product).localRenderHold).toBe(detail);
  await service.tick();
  expect(service.job(product, job.id)).toMatchObject({ phase: 'attention', detail });
  expect(app.ensureVideoRuntime).not.toHaveBeenCalled();
  expect(host.blockout).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  expect(() => service.resume(product, job.id)).toThrow('unexpected Windows restart');
  expect(() => service.shot(product, { title: job.title, brief: job.brief, characterIds: job.characters.map(c => c.id), duration: 5, ratio: '16:9' })).toThrow('unexpected Windows restart');
  const { source, edit } = editFixture(); service.approveClip(product, source.id);
  const ad = service.assemble(product, edit); await service.tick();
  expect(service.job(product, ad.id)).toMatchObject({ phase: 'attention', output });
  expect(host.assemble).toHaveBeenCalledOnce();
});

function marketingTask(id: string, productId = product) { app.db.insert(growthTasks).values({ id, productId, kind: 'marketing', targetId: 'video-request', status: 'running', createdAt: clock.now(), updatedAt: clock.now() }).run(); }
function runningBusiness() {
  app.operations ??= new OperationsService(app);
  app.db.insert(settings).values({ key: 'operations.policy.' + product, value: { ...app.operations.state(product), running: true }, updatedAt: clock.now() }).onConflictDoUpdate({ target: settings.key, set: { value: { ...app.operations.state(product), running: true } } }).run();
}

it('persists one automatic shot and ad cycle, waits for approvals and survives scheduler restart', async () => {
  const c = await cast(); host.assemble = vi.fn(async () => output);
  service.configure({ ...service.config(), agentCloudEnabled: true, agentDailyLimit: 4 });
  let campaigns = new VideoCampaignService(app); app.videoCampaigns = campaigns;
  campaigns.configure(product, { enabled: true, intervalHours: 24, objective: 'Show a clear problem and invite the viewer to try the product.' });
  campaigns.schedule(); expect(campaigns.cycles()).toHaveLength(0);
  runningBusiness(); campaigns.schedule(); campaigns.schedule();
  const cycle = campaigns.cycles()[0]!; expect(campaigns.cycles()).toHaveLength(1);
  expect(campaigns.taskContext(product, cycle.shotTaskId)?.action).toBe('video.create');
  expect(campaigns.taskContext(other, cycle.shotTaskId)).toBeUndefined();
  app.db.update(growthTasks).set({ status: 'running' }).where(eq(growthTasks.id, cycle.shotTaskId)).run();
  const created = service.agentShot(product, cycle.shotTaskId, { title: 'Campaign shot', brief: 'Maya finds the document she needs on the desk in front of her.', characterIds: [c.id], duration: 5, ratio: '16:9' });
  const shot = service.job(product, created.id); save({ ...shot, phase: 'attention', output });
  app.db.update(growthTasks).set({ status: 'done' }).where(eq(growthTasks.id, cycle.shotTaskId)).run();
  clock.advance(2 * 86400000); campaigns.schedule();
  expect(campaigns.status(product).detail).toContain('approve the generated clip');
  expect(campaigns.cycles()).toHaveLength(1); expect(campaigns.cycles()[0]!.adTaskId).toBeUndefined();
  service.approveClip(product, shot.id);
  campaigns = new VideoCampaignService(app); app.videoCampaigns = campaigns;
  campaigns.schedule(); campaigns.schedule(); const adTask = campaigns.cycles()[0]!.adTaskId!;
  expect(adTask).toBeTruthy(); expect(campaigns.taskContext(product, adTask)?.action).toBe('video.assemble');
  app.db.update(growthTasks).set({ status: 'running' }).where(eq(growthTasks.id, adTask)).run();
  const edit = service.agentAssemble(product, adTask, { title: 'Campaign ad', ratio: '9:16', clips: [{ jobId: shot.id, start: 0, duration: 5, caption: 'Find what you need.' }], headline: 'Less searching', callToAction: 'See how it works', destination: 'https://siplemona.de/get-started' });
  app.db.update(growthTasks).set({ status: 'done' }).where(eq(growthTasks.id, adTask)).run();
  await service.tick(); campaigns.schedule();
  expect(campaigns.status(product).detail).toContain('approve the finished ad');
  service.approveClip(product, edit.id); campaigns.schedule();
  expect(campaigns.cycles()[0]!.completedAt).toBe(clock.now());
  campaigns.schedule(); expect(campaigns.cycles()).toHaveLength(2);
  expect(fetcher).not.toHaveBeenCalled();
});

it('holds scheduled production without setup or budget and does not replace failed planning', async () => {
  const campaigns = new VideoCampaignService(app); app.videoCampaigns = campaigns;
  campaigns.configure(product, { enabled: true, intervalHours: 24, objective: 'Show the product solving a specific buyer problem.' });
  runningBusiness(); campaigns.schedule(); expect(campaigns.cycles()).toHaveLength(0);
  expect(campaigns.setup(product).ready).toBe(false);
  service.configure({ ...service.config(), agentCloudEnabled: true }); await cast();
  campaigns.schedule(); const cycle = campaigns.cycles()[0]!;
  app.db.update(growthTasks).set({ status: 'failed' }).where(eq(growthTasks.id, cycle.shotTaskId)).run();
  clock.advance(7 * 86400000); campaigns.schedule();
  expect(campaigns.cycles()).toHaveLength(1); expect(campaigns.status(product).detail).toContain('without the required video job');
  campaigns.configure(product, { enabled: false, intervalHours: 24, objective: 'Show the product solving a specific buyer problem.' });
  runningBusiness(); expect(() => campaigns.assertTaskMayRun(product, cycle.shotTaskId)).toThrow('paused');
  expect(fetcher).not.toHaveBeenCalled();
});

it('resumes only planning interrupted by Pause using the original task id', async () => {
  await cast(); service.configure({ ...service.config(), agentCloudEnabled: true });
  const campaigns = new VideoCampaignService(app); app.videoCampaigns = campaigns;
  campaigns.configure(product, { enabled: true, intervalHours: 24, objective: 'Show one concrete customer problem and invite a product trial.' });
  runningBusiness(); campaigns.schedule(); const cycle = campaigns.cycles()[0]!;
  app.operations!.pause(product);
  let message = ''; try { campaigns.assertTaskMayRun(product, cycle.shotTaskId); } catch (error) { message = (error as Error).message; }
  app.db.update(growthTasks).set({ status: 'failed', error: message }).where(eq(growthTasks.id, cycle.shotTaskId)).run();
  campaigns.schedule(); expect(campaigns.status(product).detail).toContain('Planning paused');
  runningBusiness(); campaigns.schedule();
  expect(app.db.select().from(growthTasks).where(eq(growthTasks.id, cycle.shotTaskId)).get()?.status).toBe('queued');
  expect(campaigns.cycles()).toHaveLength(1); expect(fetcher).not.toHaveBeenCalled();
});

it('requires explicit agent cloud settings and Run, then submits under the saved budget', async () => {
  const c = await cast(); marketingTask('cloud-agent');
  const brief = { title: 'Cloud agent scene', brief: 'Maya walks to the desk and finds the document she needs.', characterIds: [c.id], duration: 5, ratio: '16:9' };
  expect(() => service.agentShot(product, 'cloud-agent', brief)).toThrow('Enable budgeted');
  service.configure({ ...service.config(), agentCloudEnabled: true });
  expect(() => service.agentShot(product, 'cloud-agent', brief)).toThrow('Run this business');
  runningBusiness();
  const created = service.agentShot(product, 'cloud-agent', brief), job = service.job(product, created.id);
  save({ ...job, shot: plan(c.id), blockout: output });
  app.db.update(growthTasks).set({ status: 'done' }).where(eq(growthTasks.id, 'cloud-agent')).run();
  fetcher.mockResolvedValue(Response.json({ task_id: 'budgeted-agent-shot' }));
  app.operations!.pause(product); await service.tick(); expect(fetcher).not.toHaveBeenCalled();
  runningBusiness(); await service.tick();
  expect(service.job(product, job.id)).toMatchObject({ phase: 'remote', cloudEstimate: { cents: 80 }, remote: { id: 'budgeted-agent-shot' } });
  expect(fetcher).toHaveBeenCalledOnce();
});

it('Pause during cloud preparation prevents spending and Run resumes the saved job', async () => {
  const job = await queued(); marketingTask('cloud-agent');
  service.configure({ ...service.config(), agentCloudEnabled: true }); runningBusiness();
  save({ ...job, sourceTaskId: 'cloud-agent', shot: plan(job.characters[0]!.id) });
  app.db.update(growthTasks).set({ status: 'done' }).where(eq(growthTasks.id, 'cloud-agent')).run();
  host.blockout = vi.fn(async () => { app.operations!.pause(product); return output; });
  await service.tick();
  expect(fetcher).not.toHaveBeenCalled();
  expect(service.job(product, job.id)).toMatchObject({ phase: 'queued' });
  expect(service.cloudBudget().attemptedCents).toBe(0);
  host.blockout = vi.fn(async () => output); fetcher.mockResolvedValue(Response.json({ task_id: 'resumed-agent-shot' }));
  runningBusiness(); await service.tick();
  expect(service.job(product, job.id).remote?.id).toBe('resumed-agent-shot'); expect(fetcher).toHaveBeenCalledOnce();
});

it('retains an accepted cloud task when operation Pause races with submission', async () => {
  const job = await queued(); service.configure({ ...service.config(), agentCloudEnabled: true }); runningBusiness();
  save({ ...job, sourceTaskId: 'cloud-agent', shot: plan(job.characters[0]!.id), blockout: output });
  fetcher.mockImplementation(async () => { app.operations!.pause(product); return Response.json({ task_id: 'accepted-before-operation-pause' }); });
  await service.tick();
  expect(service.job(product, job.id)).toMatchObject({ phase: 'remote', remote: { id: 'accepted-before-operation-pause' }, cloudEstimate: { cents: 80 } });
  await service.tick(); expect(fetcher).toHaveBeenCalledOnce();
});
function editFixture() {
  host.assemble = vi.fn(async () => output);
  const source = service.importClip(product, 'Product demonstration', output, 10, '16:9');
  return { source, edit: { title: 'Finished demo ad', ratio: '9:16', clips: [{ jobId: source.id, start: 1, duration: 5, caption: 'Find the document you need.' }], headline: 'Less searching', callToAction: 'See how it works', destination: 'https://siplemona.de/get-started' } };
}
it('freezes product-owned music and exposes only music metadata to the agent', () => {
  const { source, edit } = editFixture(); service.approveClip(product, source.id);
  const audio: VideoAsset = { file: 'd'.repeat(64) + '.wav', sha256: 'd'.repeat(64), bytes: 2000, mime: 'audio/wav' };
  const track = service.addMusic(product, 'Owned music', audio, 30);
  const foreign = service.addMusic(other, 'Other music', audio, 30);
  expect(() => service.assemble(product, { ...edit, music: { trackId: foreign.id, gainDb: -22 } })).toThrow('business');
  const job = service.assemble(product, { ...edit, music: { trackId: track.id, gainDb: -22 }, keepSourceAudio: false });
  expect(job.assembly).toMatchObject({ musicAsset: audio, music: { trackId: track.id, gainDb: -22 }, keepSourceAudio: false });
  expect(service.context(product).musicTracks).toEqual([{ id: track.id, title: 'Owned music', duration: 30 }]);
  expect(JSON.stringify(service.context(product))).not.toMatch(/\.wav|sha256/);
  expect(() => service.assemble(product, { ...edit, music: { trackId: track.id, gainDb: 12 } })).toThrow();
});
it('requires the local voice runtime and rejects unusable narration timing', async () => {
  const { source, edit } = editFixture(); service.approveClip(product, source.id);
  const narration = { text: 'Find the answer in your own files.', voice: 'af_heart', speed: 1, start: 0, captions: true };
  expect(() => service.assemble(product, { ...edit, narration })).toThrow('Set up local narration');
  host.narrationReady = () => true;
  expect(() => service.assemble(product, { ...edit, narration: { ...narration, start: 8 } })).toThrow('earlier');
  const job = service.assemble(product, { ...edit, narration }); app.env.SIGNAL_OFFLINE = '1'; await service.tick();
  expect(service.job(product, job.id)).toMatchObject({ assembly: { narration }, phase: 'attention' }); expect(fetcher).not.toHaveBeenCalled();
});
it('requires full-playback approval and rejects cross-business footage, destinations and invalid trims', () => {
  const { source, edit } = editFixture();
  expect(() => service.assemble(product, edit)).toThrow('Approve');
  expect(() => service.approveClip(other, source.id)).toThrow('business');
  service.approveClip(product, source.id);
  expect(() => service.assemble(other, { ...edit, destination: 'https://cinegenaimedia.com' })).toThrow('business');
  expect(() => service.assemble(product, { ...edit, destination: 'https://example.com' })).toThrow('website');
  expect(() => service.assemble(product, { ...edit, clips: [{ ...edit.clips[0], start: 9 }] })).toThrow('beyond');
  expect(() => service.assemble(product, { ...edit, clips: Array(6).fill({ ...edit.clips[0], duration: 15 }) })).toThrow('60 seconds');
});
it('assembles frozen approved assets offline without models or network and requires final review', async () => {
  const { source, edit } = editFixture(); service.approveClip(product, source.id);
  const ad = service.assemble(product, edit); save({ ...service.job(product, source.id), title: 'Changed later', output: { ...output, sha256: 'c'.repeat(64) } });
  expect(ad.assembly?.clips[0]?.asset.sha256).toBe(output.sha256);
  app.env.SIGNAL_OFFLINE = '1'; await service.tick();
  expect(host.assemble).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled(); expect(llm.calls).toHaveLength(0);
  expect(service.job(product, ad.id)).toMatchObject({ kind: 'ad', phase: 'attention', output });
  expect(service.job(product, ad.id).approvedAt).toBeUndefined();
  service.approveClip(product, ad.id); expect(service.job(product, ad.id).phase).toBe('ready');
});
it('bounds and deduplicates agent ad edits and does not expose filenames', async () => {
  const { source, edit } = editFixture(); service.approveClip(product, source.id); service.configure({ ...service.config(), agentDailyLimit: 1 });
  marketingTask('edit'); marketingTask('second'); marketingTask('foreign-edit', other);
  expect(() => service.agentAssemble(product, 'foreign-edit', edit)).toThrow('active marketing task');
  const first = await executeMarketingTool(app, product, 'video.assemble', edit, new AbortController().signal, 'edit') as { id: string };
  expect(service.agentAssemble(product, 'edit', { ...edit, title: 'Do not duplicate' }).id).toBe(first.id);
  expect(() => service.agentAssemble(product, 'second', edit)).toThrow('24 hours');
  expect(JSON.stringify(service.context(product))).not.toMatch(/\.mp4|sha256/);
  expect(service.context(product).jobs.find(job => job.id === source.id)?.approvedForEditing).toBe(true);
});
it('keeps a failed local edit for deliberate retry and never starts a renderer', async () => {
  const { source, edit } = editFixture(); service.approveClip(product, source.id); const ad = service.assemble(product, edit);
  host.assemble = vi.fn(async () => { throw new Error('Missing FFprobe'); }); await service.tick(); await service.tick();
  expect(host.assemble).toHaveBeenCalledOnce(); expect(service.job(product, ad.id)).toMatchObject({ phase: 'attention' });
  host.assemble = vi.fn(async () => output); service.resume(product, ad.id); await service.tick();
  expect(service.job(product, ad.id).output).toEqual(output); expect(fetcher).not.toHaveBeenCalled();
});
it('hands an agent edit to the CPU worker after saving one durable job', async () => {
  const { source, edit } = editFixture(); service.approveClip(product, source.id); marketingTask('edit-cycle');
  app.db.insert(marketingMessages).values({ id: 'video-request', productId: product, role: 'user', body: 'Make an ad from the approved footage.', createdAt: clock.now() }).run();
  replies.push(JSON.stringify({ message: 'I will assemble the approved clips.', actions: [{ tool: 'video.assemble', input: edit }] }));
  const result = await runMarketingAgent(app, product, 'edit-cycle', 'video-request', new AbortController().signal, llm);
  expect(result.summary).toContain('saved the video job'); expect(llm.calls).toHaveLength(1);
  expect(service.jobs().filter(job => job.kind === 'ad')).toHaveLength(1); expect(host.assemble).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});
async function agentBrief() { const c = await cast(); service.configure({ ...service.config(), renderer: 'local' }); return { title: 'Find the answer', brief: 'The character walks toward the desk and finds the document they need.', characterIds: [c.id], duration: 5, ratio: '16:9' }; }

it('queues only for an active owned task and preserves one frozen shot through retries', async () => {
  const brief = await agentBrief(); marketingTask('first'); marketingTask('foreign', other);
  expect(() => service.agentShot(product, 'missing', brief)).toThrow('active marketing task');
  expect(() => service.agentShot(product, 'foreign', brief)).toThrow('active marketing task');
  const first = service.agentShot(product, 'first', brief);
  expect(service.agentShot(product, 'first', { ...brief, title: 'Changed title' }).id).toBe(first.id);
  expect(service.job(product, first.id)).toMatchObject({ title: brief.title, sourceTaskId: 'first', phase: 'queued', renderer: 'local' });
  expect(service.jobs()).toHaveLength(1); expect(fetcher).not.toHaveBeenCalled();
  app.db.update(growthTasks).set({ status: 'cancelled' }).where(eq(growthTasks.id, 'first')).run();
  expect(() => service.agentShot(product, 'first', brief)).toThrow('active marketing task');
});
it('bounds agent rendering across businesses and counts failed jobs without permitting cloud spend', async () => {
  const brief = await agentBrief(); service.configure({ ...service.config(), agentDailyLimit: 1 }); marketingTask('first'); marketingTask('second', other);
  const first = service.agentShot(product, 'first', brief); save({ ...service.job(product, first.id), phase: 'attention' });
  expect(() => service.agentShot(other, 'second', brief)).toThrow('24 hours');
  expect(service.agentShot(product, 'first', brief).id).toBe(first.id);
  clock.advance(86400001); expect(service.context(other).agentSlotsRemaining).toBe(1);
  service.configure({ ...service.config(), renderer: 'cloud' });
  expect(() => service.agentShot(other, 'second', brief)).toThrow('budgeted cloud shots');
  service.configure({ ...service.config(), renderer: 'local', agentDailyLimit: 0 });
  expect(() => service.agentShot(other, 'second', brief)).toThrow('24 hours');
  expect(fetcher).not.toHaveBeenCalled();
});
it('exposes only the selected business cast and job metadata to agents', async () => {
  const brief = await agentBrief(); marketingTask('first'); service.agentShot(product, 'first', brief);
  await service.character(product, 'Unapproved', 'A different fictional adult in a neutral studio background.', asset);
  const state = await executeMarketingTool(app, product, 'video.status', {}, new AbortController().signal);
  expect(state).toMatchObject({ approvedCharacters: [{ id: brief.characterIds[0] }], jobs: [{ title: brief.title }] });
  expect(service.context(other)).toMatchObject({ approvedCharacters: [], jobs: [] });
  expect(JSON.stringify(state)).not.toMatch(/private-video-key|private-secret|blender.exe|ffmpeg.exe|sha256|\.jpg|\.mp4/);
});
it('ends the marketing cycle with a durable queued video and no claim of a rendered ad', async () => {
  const brief = await agentBrief(); marketingTask('first');
  app.db.insert(marketingMessages).values({ id: 'video-request', productId: product, role: 'user', body: 'Create a short video with the approved character.', createdAt: clock.now() }).run();
  replies.push(JSON.stringify({ message: 'I will create a shot.', actions: [{ tool: 'video.create', input: brief }] }));
  const result = await runMarketingAgent(app, product, 'first', 'video-request', new AbortController().signal, llm);
  expect(result.summary).toContain('saved the video job'); expect(llm.calls).toHaveLength(1);
  expect(service.jobs()).toHaveLength(1); expect(service.jobs()[0]).toMatchObject({ sourceTaskId: 'first', phase: 'queued' });
  expect(fetcher).not.toHaveBeenCalled(); expect(host.blockout).not.toHaveBeenCalled();
});

it('locks approved cast and bible to a business and keeps keys out of views', async () => {
  const c = await cast(); service.bible(product, { premise: 'Find a useful answer.', audience: 'Busy teams', visualStyle: 'Natural everyday photography.', world: 'A modest office with daylight.', rules: 'Plain blue wardrobe.' });
  expect(() => service.shot(other, { title: 'Wrong business', brief: 'A complete shot brief for another business.', characterIds: [c.id], duration: 5, ratio: '16:9' })).toThrow('Approve');
  const job = service.shot(product, { title: 'Correct cast', brief: 'The character walks toward the desk in the office.', characterIds: [c.id], duration: 5, ratio: '16:9' });
  service.bible(product, { premise: 'A revised premise.', audience: 'New audience', visualStyle: 'A different visual style.', world: 'A different world and setting.', rules: '' });
  expect(service.job(product, job.id).bible?.revision).toBe(1); expect(() => service.job(other, job.id)).toThrow();
  expect(JSON.stringify(service.view())).not.toMatch(/private-video-key|private-secret/);
});
it('rejects unapproved characters and duplicate cast IDs', async () => {
  const c = await service.character(product, 'New cast', 'A fictional adult in a plain neutral studio background.', asset);
  const value = { title: 'New shot', brief: 'A complete visual brief with the same character.', characterIds: [c.id], duration: 5, ratio: '16:9' };
  expect(() => service.shot(product, value)).toThrow('Approve'); service.approveCharacter(product, c.id);
  expect(() => service.shot(product, { ...value, characterIds: [c.id, c.id] })).toThrow();
});
it('persists an uncertain submission and never retries a possibly charged POST', async () => {
  const job = await queued(); save({ ...job, shot: plan(job.characters[0]!.id), blockout: output });
  await service.tick(); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(service.job(product, job.id)).toMatchObject({ phase: 'attention', submittedAt: clock.now() });
  expect(() => service.resume(product, job.id)).toThrow('unknown'); await service.tick(); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('retains accepted cloud job IDs across a pause during submission', async () => {
  const job = await queued(); save({ ...job, shot: plan(job.characters[0]!.id), blockout: output });
  fetcher.mockImplementation(async () => { service.pause(product, job.id); return Response.json({ task_id: 'accepted-before-pause' }); });
  await service.tick(); expect(service.job(product, job.id)).toMatchObject({ phase: 'paused', remote: { id: 'accepted-before-pause' } });
  service.resume(product, job.id); expect(service.job(product, job.id).phase).toBe('remote'); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('resumes polling a saved cloud task and reviews actual frames without resubmitting', async () => {
  const job = await queued(); save({ ...job, shot: plan(job.characters[0]!.id), blockout: output, submittedAt: clock.now(), remote: { provider: 'minimax', id: 'saved-task' }, phase: 'remote' });
  replies.push(JSON.stringify(review)); fetcher.mockResolvedValue(Response.json({ task: { id: 'saved-task', status: 'succeeded', content: { url: 'https://media.example/video.mp4' } } }));
  await service.tick(); expect(service.job(product, job.id).phase).toBe('ready'); expect(fetcher.mock.calls[0]?.[1]?.method).toBe('GET');
  expect(llm.calls[0]?.images).toHaveLength(7); expect(host.frames).toHaveBeenCalledWith(output, service.config(), expect.any(AbortSignal), 5);
});
it('blocks a shot plan that changes the cast or leaves the ending uncovered', async () => {
  const job = await queued(); const p = plan(job.characters[0]!.id); p.beats[1]!.end = 4; replies.push(JSON.stringify(p));
  await service.tick(); expect(service.job(product, job.id).phase).toBe('attention'); expect(host.blockout).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});
it('keeps local rendering independent of cloud keys and detects missing local models first', async () => {
  const job = await queued('local'); secrets.clear(); fetcher.mockResolvedValue(Response.json({})); await service.tick();
  const result = service.job(product, job.id); expect(result.phase).toBe('attention'); expect(result.detail).toContain(H3_MODELS.smaller); expect(result.submittedAt).toBeUndefined();
  expect(fetcher.mock.calls.every(([url]) => String(url).startsWith('http://127.0.0.1:8188/'))).toBe(true);
});
it('holds a local shot when the desktop cannot confirm its capped renderer', async () => {
  const job = await queued('local');
  app.ensureVideoRuntime = vi.fn(async () => { throw new Error('Video requires Signal\'s capped renderer.'); });
  await service.tick();
  expect(service.job(product, job.id)).toMatchObject({ phase: 'attention', detail: expect.stringContaining('capped renderer') });
  expect(fetcher).not.toHaveBeenCalled(); expect(host.blockout).not.toHaveBeenCalled();
});
it('releases the video reservation when its managed renderer stops without retrying the render', async () => {
  const job = await queued('local');
  save({ ...job, phase: 'remote', remote: { provider: 'comfy', id: 'stopped-render', statusUrl: 'http://127.0.0.1:8188' }, submittedAt: clock.now() });
  expect(service.agentBusy()).toBe(true);
  service.runtimeStopped('http://127.0.0.1:8200'); expect(service.agentBusy()).toBe(true);
  service.runtimeStopped('http://127.0.0.1:8188'); expect(service.agentBusy()).toBe(false);
  expect(service.job(product, job.id)).toMatchObject({ phase: 'attention', remoteFinished: true });
  expect(() => service.resume(product, job.id)).toThrow('ended without an output');
  await service.tick(); expect(fetcher).not.toHaveBeenCalled();
});
it('submits and recovers a local render with no cloud key or cloud request', async () => {
  const job = await queued('local'); save({ ...job, shot: plan(job.characters[0]!.id), blockout: output }); secrets.clear();
  const types = ['UNETLoader', 'CLIPLoader', 'VAELoader', 'MiniMaxH3SigmaShift', 'LoadVideo', 'GetVideoComponents', 'MiniMaxH3ReferenceToVideo', 'RandomNoise', 'BasicGuider', 'KSamplerSelect', 'BasicScheduler', 'SamplerCustomAdvanced', 'VAEDecode', 'VAEDecodeAudio', 'CreateVideo', 'SaveVideo', 'LoadImage', 'LoraLoaderModelOnly'];
  const nodes = Object.fromEntries(types.map(type => [type, { python_module: 'comfy_extras.fixture', input: { required: { unet_name: [[H3_MODELS.smaller]], clip_name: [[H3_MODELS.encoder]], vae_name: [[H3_MODELS.videoVae, H3_MODELS.audioVae]], lora_name: [[H3_MODELS.mickTurbo]] } } }]));
  nodes['AudioAdjustVolume'] = { ...nodes['VAELoader']!, python_module: 'comfy_extras.nodes_audio' };
  fetcher.mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/object_info') return Response.json(nodes);
    if (path === '/upload/image') { const file = (init!.body as FormData).get('image') as File; return Response.json({ name: file.name, subfolder: '', type: 'input' }); }
    if (path === '/prompt') return Response.json({ prompt_id: 'local-render' });
    if (path === '/history/local-render') return Response.json({ 'local-render': { status: { completed: true, status_str: 'success' }, outputs: { '17': { images: [{ filename: 'shot.mp4', subfolder: 'Signal/video', type: 'output' }] } } } });
    if (path === '/view') return new Response(new Uint8Array([1, 2, 3]));
    if (path === '/queue') return Response.json({ queue_running: [], queue_pending: [] });
    if (path === '/free') return new Response(null, { status: 200 });
    throw new Error('Unexpected route');
  });
  await service.tick(); expect(service.job(product, job.id).remote).toMatchObject({ provider: 'comfy', id: 'local-render' }); expect(service.agentBusy()).toBe(true);
  expect(() => service.pause(product, job.id)).toThrow('already queued'); replies.push(JSON.stringify(review)); clock.advance(16000); await service.tick();
  expect(service.job(product, job.id).phase).toBe('ready'); expect(service.agentBusy()).toBe(false); expect(host.saveVideo).toHaveBeenCalled();
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/prompt'))).toHaveLength(1);
  expect(fetcher.mock.calls.every(([url]) => new URL(String(url)).hostname === '127.0.0.1')).toBe(true);
});
it('submits LTX image-to-video using the frozen model, no Blender guide and no cloud request', async () => {
  const c = await cast(); secrets.clear();
  service.configure({ ...service.config(), renderer: 'local', localModel: 'ltx25' });
  const job = service.shot(product, { title: 'Directed preview', brief: 'The same person glances at their folder and gently turns toward the camera.', characterIds: [c.id], duration: 5, ratio: '9:16' });
  save({ ...job, shot: plan(c.id) });
  // Later changes must not silently reinterpret this saved job as H3.
  service.configure({ ...service.config(), localModel: 'h3' });
  host.localRenderHold = model => model === 'h3' ? 'H3 held' : undefined;
  const graph = ltxWorkflow({ ...job, shot: plan(c.id) }, 'signal-video-' + asset.file);
  const nodes = Object.fromEntries(Object.values(graph).map(n => [n.class_type, { python_module: 'comfy_extras.fixture', input: { required: {} as Record<string, unknown> } }]));
  for (const [type, input, file] of LTX_MODEL_INPUTS) {
    const values = nodes[type]!.input.required[input] as string[][] | undefined;
    nodes[type]!.input.required[input] = [[...(values?.[0] ?? []), file]];
  }
  // Native V3 nodes expose combo options differently from legacy loaders.
  nodes['LatentUpscaleModelLoader']!.input.required['model_name'] = ['COMBO', { options: [LTX_MODEL_INPUTS[4][2]] }];
  fetcher.mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/object_info') return Response.json(nodes);
    if (path === '/upload/image') { const file = (init!.body as FormData).get('image') as File; return Response.json({ name: file.name, subfolder: '', type: 'input' }); }
    if (path === '/prompt') {
      const submitted = JSON.parse(String(init!.body)).prompt;
      expect(submitted['2'].inputs.device).toBe('default');
      expect(submitted['29'].class_type).toBe('VAEDecodeTiled');
      expect(submitted['30'].inputs.audio).toBeUndefined();
      return Response.json({ prompt_id: 'ltx-preview' });
    }
    throw new Error('Unexpected request');
  });
  await service.tick();
  expect(service.job(product, job.id)).toMatchObject({ localModel: 'ltx25', phase: 'remote', remote: { id: 'ltx-preview' } });
  expect(host.blockout).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/upload/image'))).toHaveLength(1);
  expect(fetcher.mock.calls.every(([url]) => new URL(String(url)).hostname === '127.0.0.1')).toBe(true);
});
it('blocks unsupported LTX cast sizes and long previews before rendering', async () => {
  const c = await cast(); service.configure({ ...service.config(), renderer: 'local', localModel: 'ltx25' });
  expect(() => service.shot(product, { title: 'Long preview', brief: 'A continuous shot of the same person in their original surroundings.', characterIds: [c.id], duration: 10, ratio: '16:9' })).toThrow('at most five seconds');
});
it('uses one motion reference, stable cast ordering and full-duration prompts in local H3', async () => {
  const job = await queued('local'); job.shot = plan(job.characters[0]!.id);
  const graph = h3Workflow(job, ['signal-video-' + asset.file], 'signal-video-' + output.file);
  expect(graph['1']?.inputs['unet_name']).toBe(H3_MODELS.smaller); expect(graph['18']?.inputs['lora_name']).toBe(H3_MODELS.mickTurbo);
  expect(graph['5']?.inputs['shift_audio']).toBe(5); expect(graph['8']?.inputs['ref_videos.ref_video_0']).toEqual(['7', 0]);
  expect(graph['20']?.inputs['volume']).toBe(-12); expect(graph['16']?.inputs['audio']).toEqual(['20', 0]);
  expect(graph['8']?.inputs['ref_images.ref_image_0']).toEqual(['30', 0]); expect(graph['8']?.inputs['length']).toBe(videoFrames(job));
  expect(graph['8']?.inputs['prompt']).toContain('5.167s:'); expect(graph['17']?.inputs['format.codec']).toBe('h264');
  expect(() => h3Workflow(job, ['../../private.jpg'], 'signal-video-' + output.file)).toThrow();
});
it('generates a local character without cloud keys or H3 weights and requires explicit cast approval', async () => {
  secrets.clear();
  const character = await service.character(product, 'Local cast', 'A fictional adult with curly brown hair and a plain blue jacket.', undefined, 'local');
  const nodes = Object.fromEntries(['UNETLoader', 'CLIPLoader', 'VAELoader', 'CLIPTextEncode', 'ConditioningZeroOut', 'EmptyLatentImage', 'KSampler', 'VAEDecode', 'SaveImage', 'ModelSamplingAuraFlow'].map(type => [type, { python_module: 'nodes' }]));
  fetcher.mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/object_info') return Response.json(nodes);
    if (path === '/prompt') {
      const payload = JSON.parse(String(init!.body));
      expect(payload.prompt['1'].inputs.unet_name).toContain('krea2');
      expect(JSON.stringify(payload)).not.toContain('minimax');
      expect(payload.prompt['6'].inputs).toMatchObject({ width: 768, height: 1024 });
      return Response.json({ prompt_id: 'local-cast' });
    }
    if (path === '/history/local-cast') return Response.json({ 'local-cast': { status: { completed: true, status_str: 'success' }, outputs: { '9': { images: [{ filename: 'cast.png', subfolder: 'Signal\\video', type: 'output' }] } } } });
    if (path === '/view') return new Response(new Uint8Array([1, 2, 3]));
    if (path === '/queue') return Response.json({ queue_running: [], queue_pending: [] });
    if (path === '/free') return new Response(null, { status: 200 });
    throw new Error('Unexpected route');
  });
  await service.tick(); clock.advance(16000); await service.tick();
  const result = service.characters().find(c => c.id === character.id)!;
  expect(result.reference).toEqual(asset); expect(result.approvedAt).toBeUndefined();
  expect(service.jobs()[0]?.phase).toBe('ready'); expect(service.agentBusy()).toBe(false);
  expect(host.saveImage).toHaveBeenCalled(); expect(host.saveVideo).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/free'))).toBe(true);
  expect(fetcher.mock.calls.every(([url]) => new URL(String(url)).hostname === '127.0.0.1')).toBe(true);
  service.approveCharacter(product, character.id);
  expect(service.characters().find(c => c.id === character.id)?.approvedAt).toBe(clock.now());
});
it('keeps the separate LightX2V preset and quality mode settings distinct', async () => {
  const job = await queued('local'); job.shot = plan(job.characters[0]!.id); job.localProfile = 'preview4'; job.sparseAttention = true;
  const graph = h3Workflow(job, ['signal-video-' + asset.file], 'signal-video-' + output.file);
  expect(graph['5']?.inputs['shift_audio']).toBe(3); expect(graph['18']?.inputs['lora_name']).toBe(H3_MODELS.turbo);
  expect(graph['10']?.inputs['model']).toEqual(['19', 0]); expect(graph['12']?.inputs['model']).toEqual(['19', 0]);
  job.localProfile = 'quality20'; const quality = h3Workflow(job, ['signal-video-' + asset.file], 'signal-video-' + output.file);
  expect(quality['18']).toBeUndefined(); expect(quality['12']?.inputs['steps']).toBe(20); expect(quality['11']?.inputs['sampler_name']).toBe('res_multistep');
});
it('downloads only the named local saved output, accepting Windows subfolders', async () => {
  fetcher.mockImplementation(async url => String(url).includes('/history/') ? Response.json({ task: { status: { completed: true, status_str: 'success' }, outputs: { '17': { images: [{ filename: 'saved.mp4', subfolder: 'Signal\\video', type: 'output' }] } } } }) : new Response(new Uint8Array([1, 2, 3])));
  const local = new LocalVideoRenderer(fetcher); const result = await local.poll({ provider: 'comfy', id: 'task', statusUrl: 'http://127.0.0.1:8199' }, new AbortController().signal);
  expect(result.state).toBe('done'); expect(fetcher.mock.calls[1]?.[0]).toContain('/view?filename=saved.mp4');
  await expect(local.poll({ provider: 'comfy', id: 'task', statusUrl: 'https://untrusted.example' }, new AbortController().signal)).rejects.toThrow();
});
it('does not forward Higgsfield credentials to a returned arbitrary status host', async () => {
  fetcher.mockResolvedValue(Response.json({ request_id: 'task', status_url: 'https://untrusted.example/requests/task/status' }));
  const providers = new VideoProviders(() => 'credential', fetcher);
  await expect(providers.character('Fictional studio character', new AbortController().signal)).rejects.toThrow('Invalid'); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('does not mix first-frame and reference modes in cloud requests', async () => {
  const job = await queued(); job.shot = plan(job.characters[0]!.id); const input = minimaxInput(job, ['image-data'], 'video-data');
  expect(input.content.map(c => 'role' in c ? c.role : null)).toEqual([null, 'reference_image', 'reference_video']); expect(JSON.stringify(input)).not.toContain('first_frame');
});
it('keeps the Blender reference script packaged as fixed code rather than accepting generated Python', () => {
  const source = readFileSync('src/core/video/blockout.py', 'utf8'); expect(source).not.toContain('exec('); expect(source).toContain("scene.cycles.device = 'CPU'");
});
