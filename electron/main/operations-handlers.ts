import { app as electron, type IpcMain } from 'electron';
import { join } from 'node:path';
import { OperationImages } from '../../src/core/operations/images.js';
import { normalizeCampaignImage } from './campaign-images.js';
import { z } from 'zod';
import type { App } from '../../src/core/app.js';
import type { GrowthEngine } from '../../src/core/growth/engine.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { operationActionSchema } from '../../src/shared/operations.js';
import { IPC } from '../../src/shared/ipc.js';
import { trustedSignalFrame } from './runtime-handlers.js';
import type { LocalRuntime } from '../../src/core/runtime/manager.js';
import { runtimeSettings } from '../../src/core/runtime/settings.js';
import { renderBrandCard } from './brand-card.js';

export function registerOperationsHandlers(ipc: IpcMain, app: App, growth: GrowthEngine, local: LocalRuntime) {
  const service = new OperationsService(app); app.operations = service;
  app.operationImages = new OperationImages(app, join(electron.getPath('userData'), 'campaign-images'), normalizeCampaignImage, undefined, renderBrandCard);
  ipc.handle(IPC.operations, event => { trustedSignalFrame(event); return service.view(); });
  ipc.handle(IPC.operationImage, (event, productId: unknown, id: unknown) => { trustedSignalFrame(event); return service.imagePreview(z.string().parse(productId), z.string().parse(id)); });
  ipc.handle(IPC.operationAction, async (event, input: unknown) => {
    trustedSignalFrame(event); const action = operationActionSchema.parse(input);
    if (action.type === 'configure') service.configure(action.productId, action.value);
    if (action.type === 'run') {
      await service.start(action.productId, async models => {
        app.runtimeSupervisor?.resume();
        if (runtimeSettings(app).provider === 'local') await local.start();
        const runtime = await growth.checkRuntime(models);
        if (!runtime.ok) throw new Error(`Agent runtime is not ready: ${runtime.detail}. Configure it in Settings.`);
      });
      service.schedule();
    }
    if (action.type === 'pause') service.pause(action.productId);
    if (action.type === 'research') await service.discovery.refresh(action.productId);
    if (action.type === 'refresh-conversation') await service.conversations.refresh(action.productId, action.id);
    if (action.type === 'track-conversation') service.conversations.track(action.productId, action.id, action.tracking);
    if (action.type === 'review-conversation') service.conversations.reviewed(action.productId, action.id, action.uris);
    if (action.type === 'cancel') service.cancel(action.productId, action.id, action.acceptUncertain);
    if (action.type === 'retry') service.retry(action.productId, action.id);
    return service.view();
  });
}
