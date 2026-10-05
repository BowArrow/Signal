import { BrowserWindow, shell, type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { App } from '../../src/core/app.js';
import { IPC } from '../../src/shared/ipc.js';
import { marketingAction } from '../../src/core/marketing/actions.js';
import { comfyStatus, cancelMedia, standardImageWorkflow } from '../../src/core/marketing/comfy.js';
import { marketingView, requireProduct, remember } from '../../src/core/marketing/store.js';
import { marketingMedia } from '../../src/core/db/schema.js';
import { newId } from '../../src/core/lib/id.js';

export function registerMarketingHandlers(ipc: IpcMain, app: App, userData: string): void {
  const windows = new Map<string, BrowserWindow>();
  const trusted = (event: IpcMainInvokeEvent) => {
    const url = event.senderFrame?.url ?? '';
    if (event.senderFrame !== event.sender.mainFrame || !(url.startsWith('file:') || (process.env['ELECTRON_RENDERER_URL'] && url.startsWith(process.env['ELECTRON_RENDERER_URL'])))) throw new Error('This operation is available only in Signal');
  };
  ipc.handle(IPC.marketing, (event) => { trusted(event); return marketingView(app); });
  ipc.handle(IPC.marketingReport, async (event) => { trusted(event); const error = await shell.openPath(join(dirname(fileURLToPath(import.meta.url)), 'marketing-report.pdf')); if (error) throw new Error(error); });
  ipc.handle(IPC.marketingAction, (event, input: unknown) => { trusted(event); return marketingAction(app, input); });
  ipc.handle(IPC.marketingComfy, async (event, productId: unknown, checkpoint?: unknown) => {
    trusted(event); const id = z.string().parse(productId); requireProduct(app, id);
    const status = await comfyStatus(app);
    if (typeof checkpoint === 'string') {
      if (!status.checkpoints.includes(checkpoint)) throw new Error('Choose an installed checkpoint');
      await marketingAction(app, { type: 'workflow', productId: id, name: `Local image: ${checkpoint}`, workflow: standardImageWorkflow(checkpoint) });
    }
    return status;
  });
  ipc.handle(IPC.marketingCancelMedia, async (event, id: unknown) => { trusted(event); await cancelMedia(app, z.string().parse(id)); });
  ipc.handle(IPC.marketingAsset, async (event, id: unknown, index: unknown) => {
    trusted(event);
    const job = app.db.select().from(marketingMedia).where(eq(marketingMedia.id, z.string().parse(id))).get();
    const asset = job?.outputs[z.number().int().min(0).max(100).parse(index)];
    if (!job || !asset || job.status !== 'done') throw new Error('Media output is not ready');
    if (!/\.(png|jpe?g|webp|gif|mp4|webm|mov|wav|mp3|flac|ogg)$/i.test(asset.filename)) throw new Error('Only supported image, video and audio outputs can be opened');
    const url = new URL(`${job.baseUrl.replace(/\/$/, '')}/view`);
    url.searchParams.set('filename', asset.filename); url.searchParams.set('subfolder', asset.subfolder); url.searchParams.set('type', asset.type);
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('ComfyUI media could not be read');
    if (Number(response.headers.get('content-length')) > 100000000) { await response.body?.cancel(); throw new Error('Open outputs over 100 MB directly in ComfyUI'); }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > 100000000) throw new Error('Media output exceeds 100 MB');
    const folder = join(userData, 'marketing-assets', job.id); mkdirSync(folder, { recursive: true });
    const filename = join(folder, `${index}-${basename(asset.filename).replace(/[^a-zA-Z0-9._-]/g, '_')}`);
    writeFileSync(filename, body);
    const error = await shell.openPath(filename); if (error) throw new Error(error);
  });
  ipc.handle(IPC.marketingProduct, async (event, productId: unknown, capture: unknown) => {
    trusted(event); const product = requireProduct(app, z.string().parse(productId));
    const origin = new URL(product.utmBase).origin;
    let window = windows.get(product.id);
    if (!window || window.isDestroyed()) {
      window = new BrowserWindow({ width: 1280, height: 900, title: `${product.name} — product session`, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: `persist:signal-product-${product.key}` } });
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      window.webContents.setWindowOpenHandler(({ url }) => {
        const host = new URL(url).hostname;
        return ['accounts.google.com', 'login.microsoftonline.com'].includes(host)
          ? { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: `persist:signal-product-${product.key}` } } }
          : { action: 'deny' };
      });
      window.webContents.on('will-navigate', (e, url) => { if (new URL(url).origin !== origin) e.preventDefault(); });
      windows.set(product.id, window); await window.loadURL(product.utmBase);
    }
    window.show(); window.focus();
    if (capture === true) {
      const id = newId(); const folder = join(userData, 'marketing-assets', 'product-captures'); mkdirSync(folder, { recursive: true });
      const path = join(folder, `${product.key}-${id}.png`); writeFileSync(path, (await window.webContents.capturePage()).toPNG());
      remember(app, product.id, { title: `${product.name} product capture`, body: `A real product-page screenshot was captured from ${window.webContents.getURL()}. Inspect the image before treating it as feature verification.`, kind: 'observation', source: `capture:${id}`, confidence: 0.8 });
      shell.showItemInFolder(path); return { detail: 'Real product screenshot saved locally.' };
    }
    return { detail: 'Product session opened. Sign in here if needed; credentials stay in this isolated browser session.' };
  });
}
