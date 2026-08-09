import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, type App as SignalApp } from '../../src/core/app.js';
import { createScheduler, type Scheduler } from '../../src/core/jobs/scheduler.js';
import { registerHandlers } from './handlers.js';
import { buildMenu } from './menu.js';

/**
 * The Electron main process owns everything: the SQLite handle, the pollers,
 * the scheduler, and every credential. The renderer is a view. That split is
 * not decoration — it is what keeps a UI bug from being able to post anything.
 */

let signal: SignalApp | null = null;
let scheduler: Scheduler | null = null;

const dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Nocturne's ground and its neutral-400 step. Hard-coded here because this is
 * the one place the palette has to cross out of CSS — Chromium paints the
 * window controls itself and cannot read a custom property.
 */
const TITLEBAR_HEIGHT = 40;
const NOCTURNE_BG = '#161826';
const NOCTURNE_SYMBOL = '#b2b6ca';

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 560,
    show: false,
    // So the window does not flash white before React runs.
    backgroundColor: NOCTURNE_BG,
    // The native title bar and menu bar are both gone. On Windows and Linux
    // the overlay keeps the real minimise/maximise/close buttons — they are
    // system chrome and should stay system chrome — but paints them in the
    // app's own colors so the seam disappears.
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 16, y: 13 } }
      : {
          titleBarOverlay: {
            color: NOCTURNE_BG,
            symbolColor: NOCTURNE_SYMBOL,
            height: TITLEBAR_HEIGHT,
          },
        }),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    // A thread link opens in the real browser, where I am logged in.
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServer = process.env['ELECTRON_RENDERER_URL'];
  if (devServer) {
    void win.loadURL(devServer);
  } else {
    void win.loadFile(join(dirname, '../renderer/index.html'));
  }

  return win;
}

function boot(): void {
  try {
    signal = createApp();
  } catch (err) {
    // Config failures must be loud. Dying with a message beats a window that
    // opens and quietly does nothing.
    console.error('\nSignal failed to start.\n');
    console.error(err instanceof Error ? err.message : String(err));
    app.exit(1);
    return;
  }

  registerHandlers(ipcMain, signal);
  Menu.setApplicationMenu(buildMenu(() => BrowserWindow.getAllWindows()[0] ?? null));

  scheduler = createScheduler(signal);
  scheduler.start();

  createWindow();
}

void app.whenReady().then(() => {
  boot();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  scheduler?.stop();
  signal?.close();
  scheduler = null;
  signal = null;
});
