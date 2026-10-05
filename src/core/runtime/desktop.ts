import type { App } from '../app.js';
import { desktopSettingsSchema, type DesktopSettings, type DesktopView } from '../../shared/desktop.js';
import { desktopSettings, pauseAllOperations, runningBusinesses, saveDesktopSettings, type RuntimeSupervisor } from './continuity.js';

export interface DesktopHost {
  trayAvailable(): boolean; hidden(): boolean; loginSupported(): boolean; loginEnabled(): boolean;
  setLogin(enabled: boolean): void; setAwake(enabled: boolean): void; preventingSleep(): boolean;
  hide(): void; show(): void; quit(): void;
}
export class DesktopService {
  constructor(private readonly app: App, private readonly host: DesktopHost, readonly supervisor: RuntimeSupervisor) {}
  view(): DesktopView { return { settings: desktopSettings(this.app), trayAvailable: this.host.trayAvailable(), hidden: this.host.hidden(), loginSupported: this.host.loginSupported(), loginEnabled: this.host.loginEnabled(), preventingSleep: this.host.preventingSleep(), runningBusinesses: runningBusinesses(this.app).length, runtime: this.supervisor.view(), offline: this.app.env.SIGNAL_OFFLINE === '1' }; }
  configure(input: DesktopSettings) {
    const value = desktopSettingsSchema.parse(input); const before = desktopSettings(this.app);
    if (value.keepRunningOnClose && !this.host.trayAvailable()) throw new Error('The system tray is unavailable. Keep the Signal window open.');
    if (value.startAtLogin && !this.host.loginSupported()) throw new Error('Login startup is available in the packaged default-profile desktop app on Windows or macOS.');
    if (value.startAtLogin !== before.startAtLogin && this.host.loginSupported()) this.host.setLogin(value.startAtLogin);
    saveDesktopSettings(this.app, value); if (value.recoverRuntime !== before.recoverRuntime) this.supervisor.resume(); this.tickPower();
    if (!value.keepRunningOnClose && this.host.hidden()) this.host.show();
  }
  tickPower() { this.host.setAwake(this.app.env.SIGNAL_OFFLINE !== '1' && desktopSettings(this.app).preventSleep && runningBusinesses(this.app).length > 0); }
  canHide() { return desktopSettings(this.app).keepRunningOnClose && this.host.trayAvailable(); }
  hide() { if (!this.canHide()) throw new Error('Enable background operation in Settings first.'); this.host.hide(); }
  show() { this.host.show(); }
  pauseAll() { pauseAllOperations(this.app); this.tickPower(); }
  quit() { this.host.quit(); }
  async retry() { this.supervisor.resume(); await this.supervisor.tick(); }
  async stop() { this.host.setAwake(false); await this.supervisor.stop(); }
}
