import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type MenuCommand, type SignalBridge } from '../../src/shared/ipc.js';

/**
 * The only surface the renderer gets. contextIsolation is on, so this is a
 * hard boundary rather than a convention — the renderer has no require, no
 * process, and no way to reach the database except through these calls.
 */
const bridge: SignalBridge = {
  platform: process.platform as SignalBridge['platform'],
  status: () => ipcRenderer.invoke(IPC.status),
  opportunities: (limit) => ipcRenderer.invoke(IPC.opportunities, limit),
  ingestNow: () => ipcRenderer.invoke(IPC.ingestNow),
  toggleSource: (sourceId, enabled) => ipcRenderer.invoke(IPC.toggleSource, sourceId, enabled),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  onMenuCommand: (handler) => {
    // The event object stays on this side of the bridge; only the command
    // string crosses. Handing the renderer an IpcRendererEvent would give it
    // a sender it could reply on.
    const listener = (_event: unknown, command: MenuCommand): void => handler(command);
    ipcRenderer.on(IPC.menu, listener);
    return () => ipcRenderer.removeListener(IPC.menu, listener);
  },
};

contextBridge.exposeInMainWorld('signal', bridge);
