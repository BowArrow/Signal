import type { IpcMain } from 'electron';
import type { App } from '../../src/core/app.js';
import { RevenueService } from '../../src/core/revenue/service.js';
import { revenueActionSchema, type RevenueResult } from '../../src/shared/revenue.js';
import { IPC } from '../../src/shared/ipc.js';
import { trustedSignalFrame } from './runtime-handlers.js';
import { configureFunding } from '../../src/core/revenue/funding.js';

export function registerRevenueHandlers(ipc: IpcMain, app: App) {
  const service = new RevenueService(app); app.revenue = service;
  ipc.handle(IPC.revenue, event => { trustedSignalFrame(event); return service.view(); });
  ipc.handle(IPC.revenueAction, async (event, input: unknown): Promise<RevenueResult> => {
    trustedSignalFrame(event); const action = revenueActionSchema.parse(input);
    if (action.type === 'catalog') return { view: service.view(), catalog: await service.catalog(action.productId, action.accountId) };
    if (action.type === 'configure') service.configure(action.productId, action.value);
    if (action.type === 'funding') configureFunding(app, action.productId, action.value);
    if (action.type === 'sync') await service.sync(action.productId);
    return { view: service.view() };
  });
}
