import { safeStorage, type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { App } from '../../src/core/app.js';
import { IPC } from '../../src/shared/ipc.js';
import { runtimeActionSchema, type RuntimeView } from '../../src/shared/runtime.js';
import { cloudCallsToday, runtimeSettings, saveRuntimeSettings } from '../../src/core/runtime/settings.js';
import { LocalRuntime } from '../../src/core/runtime/manager.js';
import { growthTasks } from '../../src/core/db/schema.js';
import { eq } from 'drizzle-orm';
import { pauseAllOperations } from '../../src/core/runtime/continuity.js';

export class SecretStore {
  private readonly path: string;
  constructor(folder: string) { mkdirSync(folder, { recursive: true }); this.path = join(folder, 'openai-key.enc'); }
  available() { return safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'); }
  get(name: string): string | undefined {
    if (name !== 'OPENAI_API_KEY' || !existsSync(this.path) || !this.available()) return undefined;
    try { return safeStorage.decryptString(readFileSync(this.path)); } catch { return undefined; }
  }
  set(value: string) {
    if (!value) { if (existsSync(this.path)) rmSync(this.path); return; }
    if (!this.available()) throw new Error('OS encrypted storage is unavailable. Configure OPENAI_API_KEY in the process environment instead.');
    if (!/^sk-[A-Za-z0-9_-]+$/.test(value)) throw new Error('Enter a valid OpenAI API key.');
    writeFileSync(`${this.path}.tmp`, safeStorage.encryptString(value), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
  }
}
export function trustedSignalFrame(event: IpcMainInvokeEvent) {
  const url = event.senderFrame?.url ?? '';
  const dev = process.env['ELECTRON_RENDERER_URL'];
  if (event.senderFrame !== event.sender.mainFrame || !(url.startsWith('file:') || (dev && new URL(url).origin === new URL(dev).origin))) throw new Error('This action is only available inside Signal.');
}
export function registerRuntimeHandlers(ipc: IpcMain, app: App, secrets: SecretStore): LocalRuntime {
  const manager = new LocalRuntime(app);
  const view = async (): Promise<RuntimeView> => ({ settings: runtimeSettings(app), hasApiKey: Boolean(secrets.get('OPENAI_API_KEY') ?? app.env.OPENAI_API_KEY), secureStorage: secrets.available(), local: await manager.status(), download: manager.download, cloudCallsToday: cloudCallsToday(app) });
  ipc.handle(IPC.runtime, event => { trustedSignalFrame(event); return view(); });
  ipc.handle(IPC.runtimeAction, async (event, input: unknown) => {
    trustedSignalFrame(event); const action = runtimeActionSchema.parse(input);
    if (['settings', 'key', 'stop'].includes(action.type) && app.db.select().from(growthTasks).where(eq(growthTasks.status, 'running')).get()) throw new Error('Wait for the active agent or cancel it before changing its runtime.');
    if (['settings', 'key', 'stop'].includes(action.type)) pauseAllOperations(app);
    if (action.type === 'settings') saveRuntimeSettings(app, action.value);
    if (action.type === 'key') secrets.set(action.value);
    if (action.type === 'start') { app.runtimeSupervisor?.resume(); await manager.start(); }
    if (action.type === 'stop') { app.runtimeSupervisor?.hold(); manager.stop(); }
    if (action.type === 'pull') await manager.pull(action.model);
    if (action.type === 'cancelDownload') manager.cancelDownload();
    return view();
  });
  if (runtimeSettings(app).provider === 'local' && runtimeSettings(app).autoStart && app.env.SIGNAL_OFFLINE !== '1') void manager.start().catch(() => app.logger.warn('Local runtime startup failed. Check Settings.'));
  return manager;
}
