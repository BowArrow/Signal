import type { IpcMain } from 'electron';
import type { App } from '../../src/core/app.js';
import type { GrowthEngine } from '../../src/core/growth/engine.js';
import { applyGrowthAction, dashboard } from '../../src/core/growth/store.js';
import { IPC } from '../../src/shared/ipc.js';

export function registerGrowthHandlers(
  ipc: IpcMain,
  app: App,
  engine: GrowthEngine,
): void {
  ipc.handle(IPC.growth, () => dashboard(app));
  ipc.handle(IPC.growthAction, (_event, input: unknown) => {
    const state = applyGrowthAction(app, input);
    if (
      typeof input === 'object' &&
      input &&
      'type' in input &&
      input.type === 'cancel' &&
      'taskId' in input &&
      typeof input.taskId === 'string'
    )
      engine.cancel(input.taskId);
    return state;
  });
  ipc.handle(IPC.growthRuntime, () => engine.checkRuntime());
}
