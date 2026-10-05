import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock } from '../../src/core/lib/clock.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { ConnectionService, type CredentialVault } from '../../src/core/connections/service.js';
import { OperationsService } from '../../src/core/operations/service.js';
import { RuntimeSupervisor, desktopSettings, saveDesktopSettings, type ManagedRuntime } from '../../src/core/runtime/continuity.js';
import { DesktopService, type DesktopHost } from '../../src/core/runtime/desktop.js';
import { runtimeSettings, saveRuntimeSettings } from '../../src/core/runtime/settings.js';
import { growthSettings } from '../../src/core/growth/store.js';
import { marketingSettings } from '../../src/core/marketing/store.js';
import type { RuntimeView } from '../../src/shared/runtime.js';

let app: App; let clock: ReturnType<typeof fixedClock>; let productId: string;
let supervisor: RuntimeSupervisor; let status: ReturnType<typeof vi.fn<ManagedRuntime['status']>>; let start: ReturnType<typeof vi.fn<ManagedRuntime['start']>>; let stop: ReturnType<typeof vi.fn<ManagedRuntime['stop']>>;
let healthy: RuntimeView['local']; let host: DesktopHost; let desktop: DesktopService; let hidden: boolean; let awake: boolean; let login: boolean;
beforeEach(async () => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); clock = fixedClock(Date.now()); app = createApp({ databaseUrl: ':memory:', logger: silentLogger, clock });
  const secrets = new Map<string, string>(); const vault: CredentialVault = { available: () => true, get: key => secrets.get(key), set: (key, value) => { secrets.set(key, value); }, delete: key => { secrets.delete(key); } };
  const connection = new ConnectionService(app, vault, undefined, async () => Response.json({ error: 'Post not found' }, { status: 404 })); app.connections = connection; productId = connection.view().products[0]!.id;
  await connection.connect({ productId, provider: 'signal-blog', credential: 'fixture-only', label: 'Website fixture' }); app.operations = new OperationsService(app); app.operations.configure(productId, { accountIds: [connection.accounts()[0]!.id], objective: 'Help interested buyers understand the product.', dailyLimit: 1, intervalHours: 24 });
  healthy = { ok: true, managed: false, detail: 'Fixture healthy', models: [...new Set([growthSettings(app).model, growthSettings(app).pipelineModel, marketingSettings(app).model])] };
  status = vi.fn(async () => healthy); start = vi.fn(async () => {}); stop = vi.fn(); supervisor = new RuntimeSupervisor(app, { status, start, stop }); app.runtimeSupervisor = supervisor;
  hidden = false; awake = false; login = false; host = { trayAvailable: () => true, hidden: () => hidden, loginSupported: () => true, loginEnabled: () => login, setLogin: vi.fn(value => { login = value; }), setAwake: value => { awake = value; }, preventingSleep: () => awake, hide: () => { hidden = true; }, show: () => { hidden = false; }, quit: vi.fn() }; desktop = new DesktopService(app, host, supervisor);
});
afterEach(async () => { await supervisor.stop(); app.close(); vi.unstubAllEnvs(); __setConfigForTests(null); });
it('restores a saved running operation by recovering its installed local runtime', async () => {
  app.operations!.run(productId); status.mockResolvedValueOnce({ ...healthy, ok: false }); await supervisor.tick(); expect(start).toHaveBeenCalledTimes(1); expect(supervisor.view().status).toBe('ready'); expect(await supervisor.readyForAgents()).toBe(true); expect(status).toHaveBeenCalledTimes(2);
  const restored = new RuntimeSupervisor(app, { status, start, stop }); await restored.tick(); expect(restored.view().status).toBe('ready'); expect(start).toHaveBeenCalledTimes(1);
});
it('does not start models for paused operations or GPT', async () => {
  await supervisor.tick(); expect(status).not.toHaveBeenCalled(); app.operations!.run(productId); saveRuntimeSettings(app, { ...runtimeSettings(app), provider: 'openai' }); await supervisor.tick(); expect(status).not.toHaveBeenCalled(); expect(await supervisor.readyForAgents()).toBe(true);
});
it('holds generation when the running operation requires a missing image reviewer', async () => {
  saveRuntimeSettings(app, { ...runtimeSettings(app), localVisionModel: 'missing-vision-model' }); app.operations!.run(productId);
  vi.spyOn(app.operations!, 'agentModels').mockReturnValue([...healthy.models, 'missing-vision-model']);
  await supervisor.tick(); expect(supervisor.view().status).toBe('attention'); expect(supervisor.view().detail).toContain('missing-vision-model'); expect(await supervisor.readyForAgents()).toBe(false); expect(start).not.toHaveBeenCalled();
});
it('backs off failed recovery and leaves models and provider unchanged', async () => {
  app.operations!.run(productId); status.mockResolvedValue({ ...healthy, ok: false }); start.mockRejectedValue(new Error('Fixture failure with private information'));
  await supervisor.tick(); expect(supervisor.view()).toMatchObject({ status: 'attention', failures: 1, nextCheckAt: clock.now() + 30000 }); await supervisor.tick(); expect(start).toHaveBeenCalledTimes(1);
  clock.advance(30000); await supervisor.tick(); expect(supervisor.view()).toMatchObject({ failures: 2, nextCheckAt: clock.now() + 60000 }); expect(JSON.stringify(supervisor.view())).not.toContain('private information'); expect(runtimeSettings(app).provider).toBe('local');
});
it('holds generation when configured models are missing without downloading or restarting', async () => {
  app.operations!.run(productId); status.mockResolvedValue({ ...healthy, models: [] }); await supervisor.tick(); expect(supervisor.readyForAgents()).toBe(false); expect(supervisor.view().detail).toContain('No model was downloaded'); expect(start).not.toHaveBeenCalled();
});
it('serializes recovery and honors a manual hold after an awaited status check', async () => {
  app.operations!.run(productId); let release!: (value: RuntimeView['local']) => void; status.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const one = supervisor.tick(); const two = supervisor.tick(); supervisor.hold(); release({ ...healthy, ok: false }); await Promise.all([one, two]); expect(start).not.toHaveBeenCalled(); expect(supervisor.view().status).toBe('stopped'); expect(await supervisor.readyForAgents()).toBe(false);
  supervisor.recheck(); expect(supervisor.view().status).toBe('stopped'); supervisor.resume(); await supervisor.tick(); expect(supervisor.view().status).toBe('ready');
});
it('does not launch recovery after shutdown begins', async () => {
  app.operations!.run(productId); let release!: (value: RuntimeView['local']) => void; status.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); const pending = supervisor.tick(); const stopping = supervisor.stop(); release({ ...healthy, ok: false }); await Promise.all([pending, stopping]); expect(start).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledTimes(1);
});
it('uses existing healthy servers without claiming ownership or starting another server', async () => {
  app.operations!.run(productId); await supervisor.tick(); expect(supervisor.view().status).toBe('ready'); expect(start).not.toHaveBeenCalled(); clock.advance(30000); await supervisor.tick(); expect(status).toHaveBeenCalledTimes(2);
});
it('persists background choices, shows the window when disabled and does not rewrite OS startup on every save', () => {
  const value = { ...desktopSettings(app), keepRunningOnClose: true, startAtLogin: true }; desktop.configure(value); expect(host.setLogin).toHaveBeenCalledTimes(1); desktop.hide(); expect(hidden).toBe(true); desktop.configure({ ...value, keepRunningOnClose: false }); expect(hidden).toBe(false); expect(host.setLogin).toHaveBeenCalledTimes(1); expect(desktopSettings(app).startAtLogin).toBe(true);
});
it('prevents idle sleep only for active operations and releases it on pause or shutdown', async () => {
  desktop.configure({ ...desktopSettings(app), preventSleep: true }); expect(awake).toBe(false); app.operations!.run(productId); desktop.tickPower(); expect(awake).toBe(true); desktop.pauseAll(); expect(awake).toBe(false); app.operations!.run(productId); desktop.tickPower(); await desktop.stop(); expect(awake).toBe(false);
});
it('rejects background hiding without a tray and login changes in isolated profiles', () => {
  host.trayAvailable = () => false; expect(() => desktop.configure({ ...desktopSettings(app), keepRunningOnClose: true })).toThrow('tray'); expect(() => desktop.hide()).toThrow('background'); host.loginSupported = () => false; expect(() => desktop.configure({ ...desktopSettings(app), startAtLogin: true })).toThrow('default-profile'); expect(host.setLogin).not.toHaveBeenCalled();
});
it('does not persist a login-startup claim when the OS rejects the change', () => {
  host.setLogin = () => { throw new Error('OS denied startup'); }; expect(() => desktop.configure({ ...desktopSettings(app), startAtLogin: true })).toThrow('OS denied'); expect(desktopSettings(app).startAtLogin).toBe(false);
});
it('respects disabled recovery settings', async () => {
  app.operations!.run(productId); saveDesktopSettings(app, { ...desktopSettings(app), recoverRuntime: false }); await supervisor.tick(); expect(status).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
});
it('makes no runtime or power changes in an offline validation profile', async () => {
  app.operations!.run(productId); saveDesktopSettings(app, { ...desktopSettings(app), preventSleep: true });
  const offline: App = { ...app, env: { ...app.env, SIGNAL_OFFLINE: '1' } }; const monitor = new RuntimeSupervisor(offline, { status, start, stop }); const service = new DesktopService(offline, host, monitor);
  await monitor.tick(); service.tickPower(); expect(status).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled(); expect(awake).toBe(false);
});
it('lets the worker continue non-model work while a runtime check is pending', async () => {
  app.operations!.run(productId); let release!: (value: RuntimeView['local']) => void; status.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  expect(supervisor.readyForAgents()).toBe(false); expect(supervisor.view().status).toBe('checking'); release(healthy); await supervisor.tick(); expect(supervisor.readyForAgents()).toBe(true);
});
