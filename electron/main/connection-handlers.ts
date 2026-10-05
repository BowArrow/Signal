import { dialog, safeStorage, shell, type IpcMain } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { App } from '../../src/core/app.js';
import type { ConnectionService, CredentialVault } from '../../src/core/connections/service.js';
import { connectionActionSchema, type ConnectionResult } from '../../src/shared/connections.js';
import { IPC } from '../../src/shared/ipc.js';
import { trustedSignalFrame } from './runtime-handlers.js';

export class AccountVault implements CredentialVault {
  constructor(private readonly folder: string) { mkdirSync(folder, { recursive: true }); }
  available() { return safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'); }
  private path(key: string) { return join(this.folder, `${createHash('sha256').update(key).digest('hex')}.enc`); }
  get(key: string) { if (!this.available() || !existsSync(this.path(key))) return undefined; try { return safeStorage.decryptString(readFileSync(this.path(key))); } catch { return undefined; } }
  set(key: string, value: string) { if (!this.available()) throw new Error('OS encrypted storage is unavailable. Enable your operating system keychain before connecting accounts.'); const path = this.path(key); writeFileSync(`${path}.tmp`, safeStorage.encryptString(value), { mode: 0o600 }); renameSync(`${path}.tmp`, path); }
  delete(key: string) { rmSync(this.path(key), { force: true }); }
}
export function registerConnectionHandlers(ipc: IpcMain, app: App, service: ConnectionService) {
  app.connections = service;
  ipc.handle(IPC.connections, event => { trustedSignalFrame(event); return service.view(); });
  ipc.handle(IPC.connectionAction, async (event, input: unknown): Promise<ConnectionResult> => {
    trustedSignalFrame(event); const action = connectionActionSchema.parse(input);
    if (action.type === 'connect') await service.connect(action.value);
    if (action.type === 'rename') service.rename(action.productId, action.id, action.label);
    if (action.type === 'share') await service.shareAccount(action.productId, action.id, action.targetProductId);
    if (action.type === 'x-posting') await service.authorizeXPosting(action.productId, action.id);
    if (action.type === 'import-website') await service.importWebsite(action.productId);
    if (action.type === 'verify') await service.verify(action.productId, action.id);
    if (action.type === 'disconnect') service.disconnect(action.productId, action.id);
    if (action.type === 'oauth-config') service.configureOAuth(action.provider, action);
    if (action.type === 'oauth-start') await service.beginOAuth(action.provider, action.productId, action.label, action.access);
    if (action.type === 'oauth-cancel') service.cancelOAuth();
    if (action.type === 'google-import') {
      const selected = await dialog.showOpenDialog({ title: 'Import Google Desktop app credentials', properties: ['openFile'], filters: [{ name: 'Google credential JSON', extensions: ['json'] }] });
      if (!selected.canceled && selected.filePaths[0]) {
        const path = selected.filePaths[0];
        if (statSync(path).size > 32768) throw new Error('Choose a Google Desktop app credential file smaller than 32 KB.');
        let value: unknown;
        try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error('The selected file is not valid JSON. Download the Google Desktop app credential file again.'); }
        service.importGoogleClient(value);
      }
    }
    if (action.type === 'gmail-aliases') return { view: service.view(), preview: await service.gmailAliases(action.productId, action.id) };
    if (action.type === 'preview') return { view: service.view(), preview: await service.verify(action.productId, action.id, true) };
    return { view: service.view() };
  });
}
export const openAccountBrowser = (url: string) => shell.openExternal(url);
