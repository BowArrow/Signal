import { app as electron, BrowserWindow, Menu, Tray, nativeImage, powerSaveBlocker, powerMonitor, type IpcMain } from 'electron';
import type { App } from '../../src/core/app.js';
import type { LocalRuntime } from '../../src/core/runtime/manager.js';
import { RuntimeSupervisor, desktopSettings, runningBusinesses } from '../../src/core/runtime/continuity.js';
import { DesktopService, type DesktopHost } from '../../src/core/runtime/desktop.js';
import { desktopActionSchema } from '../../src/shared/desktop.js';
import { IPC } from '../../src/shared/ipc.js';
import { trustedSignalFrame } from './runtime-handlers.js';
import { fileURLToPath } from 'node:url';

function trayImage() {
  if (process.platform !== 'darwin') return nativeImage.createFromPath(fileURLToPath(new URL('./brand/tray.png', import.meta.url)));
  const pixels = Buffer.alloc(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const dx = x - 15.5; const dy = y - 15.5; const radius = Math.hypot(dx, dy);
    const lit = radius < 2.5 || (Math.abs(dx) > Math.abs(dy) * 0.6 && ((radius > 6 && radius < 8) || (radius > 11 && radius < 13)));
    if (lit) { const i = (y * 32 + x) * 4; pixels[i] = 246; pixels[i + 1] = 179; pixels[i + 2] = 159; pixels[i + 3] = 255; }
  }
  const image = nativeImage.createFromBitmap(pixels, { width: 32, height: 32, scaleFactor: 2 }); if (process.platform === 'darwin') image.setTemplateImage(true); return image;
}
export function registerDesktopHandlers(ipc: IpcMain, app: App, runtime: LocalRuntime, showWindow: () => void, isQuitting: () => boolean) {
  const supervisor = new RuntimeSupervisor(app, runtime); app.runtimeSupervisor = supervisor;
  let tray: Tray | null = null; let blocker: number | null = null; let menuState = ''; let stopped = false; let powerError = false;
  try { tray = new Tray(trayImage()); tray.setToolTip('Signal'); tray.on('click', showWindow); tray.on('double-click', showWindow); }
  catch { app.logger.warn('System tray unavailable; close-to-background is disabled.'); }
  const loginSupported = () => electron.isPackaged && ['win32', 'darwin'].includes(process.platform) && app.env.SIGNAL_OFFLINE !== '1' && !process.env['SIGNAL_PROFILE_DIR'] && !process.env['SIGNAL_DATABASE_URL'];
  const loginOptions = { path: process.execPath, args: ['--signal-background'] };
  const loginEnabled = () => { if (!loginSupported()) return false; try { const value = electron.getLoginItemSettings(loginOptions); return value.openAtLogin && (process.platform !== 'win32' || value.executableWillLaunchAtLogin); } catch { return false; } };
  const host: DesktopHost = {
    trayAvailable: () => Boolean(tray && !tray.isDestroyed()), hidden: () => !BrowserWindow.getAllWindows().some(w => w.isVisible()), loginSupported, loginEnabled,
    setLogin: enabled => { electron.setLoginItemSettings({ ...loginOptions, openAtLogin: enabled, ...(process.platform === 'win32' ? { enabled, name: 'Signal' } : {}) }); if (loginEnabled() !== enabled) throw new Error('The OS did not confirm the login-startup change. Check startup applications in system settings.'); },
    setAwake: enabled => { if (enabled && (blocker === null || !powerSaveBlocker.isStarted(blocker))) blocker = powerSaveBlocker.start('prevent-app-suspension'); else if (!enabled && blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null; } },
    preventingSleep: () => blocker !== null && powerSaveBlocker.isStarted(blocker),
    hide: () => BrowserWindow.getAllWindows()[0]?.close(), show: showWindow,
    quit: () => { setTimeout(() => electron.quit(), 0); },
  };
  const service = new DesktopService(app, host, supervisor);
  const refresh = () => {
    if (stopped) return;
    try { service.tickPower(); powerError = false; } catch { if (!powerError) app.logger.warn('Idle sleep prevention could not be updated.'); powerError = true; }
    void supervisor.tick().catch(() => app.logger.warn('Runtime supervision could not complete.'));
    app.salesHandoffs?.sync();
    const due = (app.connections?.view().products ?? []).reduce((sum, p) => sum + (app.salesHandoffs?.summary(p.id).due ?? 0), 0);
    const count = runningBusinesses(app).length; const status = `${count}:${supervisor.view().status}:${due}`;
    if (tray && !tray.isDestroyed() && menuState !== status) { menuState = status; tray.setToolTip(`Signal - ${count} active operations${due ? ` - ${due} sales handoffs due` : ''}`); tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Signal', click: showWindow }, { label: `${count} active operations`, enabled: false },
      ...(due ? [{ label: `${due} sales handoffs due - open Signal`, click: showWindow }] : []),
      { label: 'Pause all operations', enabled: count > 0, click: () => service.pauseAll() }, { type: 'separator' },
      { label: 'Quit Signal', click: () => electron.quit() },
    ])); }
  };
  const onResume = () => { supervisor.recheck(); refresh(); }; powerMonitor.on('resume', onResume);
  const timer = setInterval(refresh, 3000); refresh();
  ipc.handle(IPC.desktop, event => { trustedSignalFrame(event); return service.view(); });
  ipc.handle(IPC.desktopAction, async (event, input: unknown) => {
    trustedSignalFrame(event); const action = desktopActionSchema.parse(input);
    if (action.type === 'settings') service.configure(action.value);
    if (action.type === 'hide') service.hide();
    if (action.type === 'show') service.show();
    if (action.type === 'pause-all') service.pauseAll();
    if (action.type === 'retry-runtime') await service.retry();
    if (action.type === 'quit') service.quit();
    refresh(); return service.view();
  });
  return {
    closeToBackground: (window: BrowserWindow, event: { preventDefault(): void }) => { if (!isQuitting() && service.canHide()) { event.preventDefault(); window.hide(); } },
    startHidden: () => process.argv.includes('--signal-background') && service.canHide(),
    stop: async () => { stopped = true; clearInterval(timer); powerMonitor.removeListener('resume', onResume); tray?.destroy(); tray = null; await service.stop(); },
    settings: () => desktopSettings(app),
  };
}
