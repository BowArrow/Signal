import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import { externalBrowserUrl } from '../../src/shared/bluesky-url.js';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp, type App as SignalApp } from '../../src/core/app.js';
import { createScheduler, type Scheduler } from '../../src/core/jobs/scheduler.js';
import { registerHandlers } from './handlers.js';
import { registerReviewHandlers } from './review-handlers.js';
import { buildMenu } from './menu.js';
import { GrowthEngine } from '../../src/core/growth/engine.js';
import { registerGrowthHandlers } from './growth-handlers.js';
import { seed } from '../../src/core/db/seed.js';
import { sources } from '../../src/core/db/schema.js';
import { registerMarketingHandlers } from './marketing-handlers.js';
import { initializeMarketing } from '../../src/core/marketing/store.js';
import { registerRuntimeHandlers, SecretStore } from './runtime-handlers.js';
import type { LocalRuntime } from '../../src/core/runtime/manager.js';
import { registerStudioHandlers } from './studio-handlers.js';
import { registerCreativeHandlers } from './creative-handlers.js';
import { AccountVault, openAccountBrowser, registerConnectionHandlers } from './connection-handlers.js';
import { ConnectionService } from '../../src/core/connections/service.js';
import { readConnectionApps } from './connection-apps.js';
import { registerOperationsHandlers } from './operations-handlers.js';
import { registerRevenueHandlers } from './revenue-handlers.js';
import { registerAnalyticsHandlers } from './analytics-handlers.js';
import { registerSalesHandlers } from './sales-handlers.js';
import { registerDesktopHandlers } from './desktop-handlers.js';
import { registerVideoHandlers } from './video-handlers.js';

/**
 * The Electron main process owns everything: the SQLite handle, the pollers,
 * the scheduler, and every credential. The renderer is a view. That split is
 * where review requirements and owner-started operating policies are enforced.
 */

let signal: SignalApp | null = null;
let scheduler: Scheduler | null = null;
let growth: GrowthEngine | null = null;
let closing = false;
let runtime: LocalRuntime | null = null;
let secrets: SecretStore;
let creative: { stop: () => Promise<void> } | null = null;
let video: ReturnType<typeof registerVideoHandlers> | null = null;
let desktop: ReturnType<typeof registerDesktopHandlers> | null = null;

const dirname = fileURLToPath(new URL('.', import.meta.url));
// Explicit profile isolation for development and desktop validation, including
// encrypted keys and private publishing config as well as Chromium storage.
if (process.env['SIGNAL_PROFILE_DIR']) {
  const profile = resolve(process.env['SIGNAL_PROFILE_DIR']); mkdirSync(profile, { recursive: true }); app.setPath('userData', profile);
}

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
    icon: join(dirname, 'brand', 'icon.png'),
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
      offscreen: process.env['SIGNAL_UI_TEST_HIDDEN'] === '1' && process.env['SIGNAL_OFFLINE'] === '1' && Boolean(process.env['SIGNAL_PROFILE_DIR']),
    },
  });

  win.once('ready-to-show', () => { if (!(process.env['SIGNAL_UI_TEST_HIDDEN'] === '1' && process.env['SIGNAL_OFFLINE'] === '1' && process.env['SIGNAL_PROFILE_DIR']) && !desktop?.startHidden()) win.show(); });
  win.on('close', event => desktop?.closeToBackground(win, event));

  win.webContents.setWindowOpenHandler(({ url }) => {
    // A thread link opens in the real browser, where I am logged in.
    try { void shell.openExternal(externalBrowserUrl(url)).catch(() => console.warn('Could not open external browser.')); }
    catch { console.warn('Blocked an unsupported external URL.'); }
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
function showWindow() {
  const window = BrowserWindow.getAllWindows()[0] ?? createWindow(); if (window.isMinimized()) window.restore(); window.show();
  // Windows may apply the launcher's hidden STARTUPINFO to the first ShowWindow
  // call. An explicit tray/shortcut request must reveal the window afterward.
  if (process.platform === 'win32' && !window.isVisible()) window.show();
  window.focus();
}

function boot(): void {
  try {
    secrets = new SecretStore(app.getPath('userData'));
    const publishingConfig = join(app.getPath('userData'), 'website-publishing.json');
    if (existsSync(publishingConfig)) {
      const values = JSON.parse(readFileSync(publishingConfig, 'utf8')) as Record<string, unknown>;
      for (const product of ['LEMONADE', 'CINEGEN']) {
        for (const suffix of ['PUBLISH_KEY', 'AUTO_PUBLISH']) {
          const key = `SIGNAL_${product}_${suffix}`;
          if (typeof values[key] === 'string' && process.env[key] === undefined) process.env[key] = values[key];
        }
      }
    }
    signal = createApp({ getSecret: name => secrets.get(name), ...(app.isPackaged && !process.env['SIGNAL_DATABASE_URL']
      ? { databaseUrl: join(app.getPath('userData'), 'signal.db') }
      : {}) });
    if (!signal.db.select({ id: sources.id }).from(sources).limit(1).get()) {
      seed(signal.db, signal.config, signal.logger);
    }
  } catch (err) {
    // Config failures must be loud. Dying with a message beats a window that
    // opens and quietly does nothing.
    console.error('\nSignal failed to start.\n');
    console.error(err instanceof Error ? err.message : String(err));
    app.exit(1);
    return;
  }

  registerHandlers(ipcMain, signal);
  registerReviewHandlers(ipcMain, signal);
  initializeMarketing(signal);
  const connectionApps = readConnectionApps(join(dirname, 'connection-apps.json'));
  const accounts = new ConnectionService(signal, new AccountVault(join(app.getPath('userData'), 'account-credentials')), openAccountBrowser, undefined, connectionApps);
  registerConnectionHandlers(ipcMain, signal, accounts);
  runtime = registerRuntimeHandlers(ipcMain, signal, secrets);
  registerStudioHandlers(ipcMain, signal);
  creative = registerCreativeHandlers(ipcMain, signal, app.getPath('userData'), join(dirname, 'video', 'limited_runtime.py'), app.isPackaged ? join(process.resourcesPath, 'tools', '7za.exe') : join(app.getAppPath(), 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'));
  video = registerVideoHandlers(ipcMain, signal, app.getPath('userData'), join(dirname, 'video', 'blockout.py'), runtime);
  registerMarketingHandlers(ipcMain, signal, app.getPath('userData'));
  growth = new GrowthEngine(signal);
  registerOperationsHandlers(ipcMain, signal, growth, runtime);
  registerRevenueHandlers(ipcMain, signal);
  registerAnalyticsHandlers(ipcMain, signal);
  registerSalesHandlers(ipcMain, signal);
  registerGrowthHandlers(ipcMain, signal, growth);
  desktop = registerDesktopHandlers(ipcMain, signal, runtime, showWindow, () => closing);
  growth.start();
  Menu.setApplicationMenu(buildMenu(() => BrowserWindow.getAllWindows()[0] ?? null));

  scheduler = createScheduler(signal);
  scheduler.start();

  createWindow();
}

// Opening the desktop shortcut again should bring back the existing window,
// not start a second ingestion scheduler and renderer against the same profile.
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
else void app.whenReady().then(() => {
  boot();

  app.on('activate', () => {
    showWindow();
  });
});

app.on('second-instance', () => {
  showWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (closing) return;
  event.preventDefault();
  closing = true;
  signal?.connections?.cancelOAuth();
  scheduler?.stop();
  void Promise.all([growth?.stop(), desktop?.stop(), video?.stop()]).finally(async () => {
    runtime?.stop();
    try { await creative?.stop(); } catch { signal?.logger.warn('Creative engine shutdown could not be confirmed.'); }
    // The ingestion scheduler can still be finishing a fetch. Electron exit
    // releases SQLite after its process stops, avoiding writes to a closed DB.
    app.quit();
  });
});
