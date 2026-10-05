import { dialog, type IpcMain } from 'electron';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { App } from '../../src/core/app.js';
import { IPC } from '../../src/shared/ipc.js';
import { exportCampaign, studioAction, studioView } from '../../src/core/studio/store.js';
import { trustedSignalFrame } from './runtime-handlers.js';

export function registerStudioHandlers(ipc: IpcMain, app: App) {
  ipc.handle(IPC.studio, event => { trustedSignalFrame(event); return studioView(app); });
  ipc.handle(IPC.studioAction, (event, input: unknown) => { trustedSignalFrame(event); return studioAction(app, input); });
  ipc.handle(IPC.studioExport, async (event, productId: unknown, campaignId: unknown) => {
    trustedSignalFrame(event);
    const body = exportCampaign(app, z.string().parse(productId), z.string().parse(campaignId));
    const result = await dialog.showSaveDialog({ title: 'Export campaign materials', defaultPath: 'signal-campaign.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, body, 'utf8'); return true;
  });
}
