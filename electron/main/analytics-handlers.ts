import type { IpcMain } from 'electron';
import type { App } from '../../src/core/app.js';
import { AnalyticsService } from '../../src/core/analytics/service.js';
import { analyticsActionSchema } from '../../src/shared/analytics.js';
import { IPC } from '../../src/shared/ipc.js';
import { trustedSignalFrame } from './runtime-handlers.js';
import { SeoService } from '../../src/core/seo/service.js';
import { seoActionSchema } from '../../src/shared/seo.js';

export function registerAnalyticsHandlers(ipc: IpcMain, app: App) {
  const service = new AnalyticsService(app); app.analytics = service;
  const seo = new SeoService(app); app.seo = seo;
  ipc.handle(IPC.seo, event => { trustedSignalFrame(event); return seo.view(); });
  ipc.handle(IPC.seoAction, async (event, input: unknown) => {
    trustedSignalFrame(event); const action = seoActionSchema.parse(input);
    if (action.type === 'configure') seo.configure(action.productId, action.value);
    if (action.type === 'remove') seo.remove(action.productId);
    if (action.type === 'sync') await seo.sync(action.productId);
    return seo.view();
  });
  ipc.handle(IPC.analytics, event => { trustedSignalFrame(event); return service.view(); });
  ipc.handle(IPC.analyticsAction, async (event, input: unknown) => {
    trustedSignalFrame(event); const action = analyticsActionSchema.parse(input);
    if (action.type === 'configure') service.configure(action.productId, action.value);
    if (action.type === 'remove') service.remove(action.productId);
    if (action.type === 'sync') await service.sync(action.productId);
    return service.view();
  });
}
