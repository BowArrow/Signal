import { dialog, shell, type IpcMain } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { App } from '../../src/core/app.js';
import { IPC } from '../../src/shared/ipc.js';
import { videoActionSchema } from '../../src/shared/video.js';
import { VideoService } from '../../src/core/video/service.js';
import { VideoCampaignService } from '../../src/core/video/campaigns.js';
import { adDirectorPlans, requestAdConcepts, produceAdConcept, assembleAdConcept } from '../../src/core/video/ad-director.js';
import { VideoPublishingService } from '../../src/core/video/publishing.js';
import { requireProduct } from '../../src/core/marketing/store.js';
import { AccountVault } from './connection-handlers.js';
import { DesktopVideoHost } from './video-host.js';
import { trustedSignalFrame } from './runtime-handlers.js';
import type { LocalRuntime } from '../../src/core/runtime/manager.js';
import { runtimeSettings } from '../../src/core/runtime/settings.js';

export function registerVideoHandlers(ipc: IpcMain, app: App, userData: string, script: string, runtime: LocalRuntime) {
  const host = new DesktopVideoHost(join(userData, 'video-assets'), script, async () => { if (runtimeSettings(app).provider === 'local') await runtime.start(); });
  const service = new VideoService(app, new AccountVault(join(userData, 'account-credentials')), host);
  app.video = service;
  const campaigns = new VideoCampaignService(app); app.videoCampaigns = campaigns;
  const publisher = new VideoPublishingService(app, new AccountVault(join(userData, 'account-credentials')), asset => host.bytes(asset));
  app.videoPublishing = publisher;
  const view = () => ({ ...service.view(), publishing: publisher.view(), campaigns: campaigns.view(), adDirector: adDirectorPlans(app) });
  ipc.handle(IPC.video, event => { trustedSignalFrame(event); return view(); });
  ipc.handle(IPC.videoAction, async (event, input: unknown) => {
    trustedSignalFrame(event); const action = videoActionSchema.parse(input);
    if (action.type === 'ad-research') requestAdConcepts(app, action.productId, action.value);
    if (action.type === 'ad-produce') produceAdConcept(app, action.productId, action.id, action.index, action.characterId);
    if (action.type === 'ad-assemble') assembleAdConcept(app, action.productId, action.id, action.index, action.productClipId);
    if (action.type === 'campaign-configure') campaigns.configure(action.productId, action.value);
    if (action.type === 'check-local') return { view: view(), local: await service.checkLocal() };
    if (action.type === 'youtube-configure') await publisher.configure(action.productId, action.value);
    if (action.type === 'youtube-queue') publisher.enqueue(action.productId, action.id);
    if (action.type === 'youtube-retry') publisher.retry(action.productId, action.id);
    if (action.type === 'youtube-cancel') publisher.cancel(action.productId, action.id, action.acceptUncertain);
    if (action.type === 'install-narration') { if (app.env.SIGNAL_OFFLINE === '1') throw new Error('Turn off offline mode for the one-time voice download.'); if (service.agentBusy()) throw new Error('Wait for active video work to finish before changing voice setup.'); await host.installNarration(AbortSignal.timeout(8 * 60000)); }
    if (action.type === 'import-music') {
      requireProduct(app, action.productId);
      const result = await dialog.showOpenDialog({ title: 'Import music for this business', properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac'] }] });
      if (!result.canceled && result.filePaths[0]) { const track = await host.importMusic(result.filePaths[0], service.config(), AbortSignal.timeout(60000)); service.addMusic(action.productId, action.title, track.asset, track.duration); }
    }
    if (action.type === 'configure') service.configure(action.value, action.higgsfieldId, action.higgsfieldSecret, action.minimaxKey);
    if (action.type === 'bible') service.bible(action.productId, action.value);
    if (action.type === 'choose-tool') {
      const result = await dialog.showOpenDialog({ title: `Choose ${action.tool} executable`, properties: ['openFile'] });
      if (!result.canceled && result.filePaths[0]) service.configure({ ...service.config(), [`${action.tool}Path`]: result.filePaths[0] });
    }
    if (action.type === 'character') {
      requireProduct(app, action.productId);
      if (action.generate) await service.character(action.productId, action.name, action.description, undefined, action.source);
      else {
        const result = await dialog.showOpenDialog({ title: 'Import character reference', properties: ['openFile'], filters: [{ name: 'Character image', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
        if (!result.canceled && result.filePaths[0]) await service.character(action.productId, action.name, action.description, host.importImage(result.filePaths[0]));
      }
    }
    if (action.type === 'approve-character') service.approveCharacter(action.productId, action.id);
    if (action.type === 'shot') service.shot(action.productId, action.value);
    if (action.type === 'assemble') service.assemble(action.productId, action.value);
    if (action.type === 'approve-clip') service.approveClip(action.productId, action.id);
    if (action.type === 'import-clip') {
      requireProduct(app, action.productId);
      const result = await dialog.showOpenDialog({ title: 'Import footage for this business', properties: ['openFile'], filters: [{ name: 'MP4 video', extensions: ['mp4'] }] });
      if (!result.canceled && result.filePaths[0]) {
        const clip = await host.importClip(result.filePaths[0], service.config(), AbortSignal.timeout(30000));
        service.importClip(action.productId, action.title, clip.output, clip.duration, clip.ratio);
      }
    }
    if (action.type === 'pause') service.pause(action.productId, action.id);
    if (action.type === 'resume') service.resume(action.productId, action.id);
    if (action.type === 'open') {
      const job = service.job(action.productId, action.id);
      const asset = action.asset === 'blend' ? undefined : job[action.asset];
      const path = action.asset === 'blend' ? join(host.jobFolder(job.id), 'blockout.blend') : asset ? host.assetPath(asset) : '';
      if (!path || !existsSync(path)) throw new Error('This video asset is not ready.');
      const error = await shell.openPath(path); if (error) throw new Error('The saved video asset could not be opened.');
    }
    return { view: view() };
  });
  ipc.handle(IPC.videoPreview, (event, productId: unknown, id: unknown, kind: unknown) => {
    trustedSignalFrame(event); const value = z.object({ productId: z.string(), id: z.string(), kind: z.enum(['character', 'output', 'blockout', 'music']) }).parse({ productId, id, kind });
    requireProduct(app, value.productId);
    const asset = value.kind === 'music' ? service.music().find(track => track.productId === value.productId && track.id === value.id)?.asset : value.kind === 'character' ? service.characters().find(c => c.productId === value.productId && c.id === value.id)?.reference : service.job(value.productId, value.id)[value.kind];
    if (!asset) throw new Error('This video asset is not ready.');
    return { dataUrl: host.data(asset), mime: asset.mime };
  });
  const cycle = async () => { campaigns.schedule(); await service.tick(); };
  const timer = setInterval(() => { void cycle().catch(() => app.logger.warn('Video scheduler could not finish its current check.')); }, 3000);
  const publishingTimer = setInterval(() => { void publisher.tick().catch(() => app.logger.warn('YouTube delivery check needs attention.')); }, 3000);
  return { stop: async () => { clearInterval(timer); clearInterval(publishingTimer); await publisher.stop(); await service.stop(); } };
}
