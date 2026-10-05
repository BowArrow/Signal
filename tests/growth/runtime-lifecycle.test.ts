import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import type * as ChildProcesses from 'node:child_process';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { LocalRuntime } from '../../src/core/runtime/manager.js';
import type { RuntimeView } from '../../src/shared/runtime.js';

vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof ChildProcesses>(), spawn: vi.fn(() => ({ pid: 12345, exitCode: null, signalCode: null, once: vi.fn(), kill: vi.fn() })), spawnSync: vi.fn(() => ({ status: 0 })) }));
let app: App; let runtime: LocalRuntime;
const down: RuntimeView['local'] = { ok: false, managed: false, models: [], detail: 'Fixture unavailable' };
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); app = createApp({ databaseUrl: ':memory:', logger: silentLogger }); runtime = new LocalRuntime(app); });
afterEach(() => { runtime.stop(); app.close(); vi.unstubAllEnvs(); __setConfigForTests(null); });
it('does not spawn a local server after Stop during the first availability check', async () => {
  let release!: (value: RuntimeView['local']) => void; vi.spyOn(runtime, 'status').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const starting = runtime.start(); runtime.stop(); release(down); await expect(starting).rejects.toThrow('cancelled'); expect(spawn).not.toHaveBeenCalled();
});
it('terminates only its owned child and rejects late startup completion', async () => {
  let release!: (value: RuntimeView['local']) => void; const status = vi.spyOn(runtime, 'status').mockResolvedValueOnce(down).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const starting = runtime.start(); await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(2)); runtime.stop(); release({ ...down, ok: true }); await expect(starting).rejects.toThrow('cancelled');
  expect(spawn).toHaveBeenCalledTimes(1); const child = vi.mocked(spawn).mock.results[0]!.value as { kill: ReturnType<typeof vi.fn> };
  if (process.platform === 'win32') { expect(spawnSync).toHaveBeenCalledWith('taskkill', ['/PID', '12345', '/T', '/F'], expect.objectContaining({ windowsHide: true, shell: false, timeout: 10000 })); expect(child.kill).not.toHaveBeenCalled(); } else expect(child.kill).toHaveBeenCalledTimes(1);
});
it('leaves a healthy externally managed server running', async () => {
  vi.spyOn(runtime, 'status').mockResolvedValue({ ...down, ok: true }); await runtime.start(); runtime.stop(); expect(spawn).not.toHaveBeenCalled(); expect(spawnSync).not.toHaveBeenCalled();
});
it('does not terminate a PID after its tracked server has already exited', async () => {
  vi.spyOn(runtime, 'status').mockResolvedValueOnce(down).mockResolvedValue({ ...down, ok: true }); await runtime.start();
  const child = vi.mocked(spawn).mock.results[0]!.value as { exitCode: number | null; kill: ReturnType<typeof vi.fn> }; child.exitCode = 0; runtime.stop(); expect(spawnSync).not.toHaveBeenCalled(); expect(child.kill).not.toHaveBeenCalled();
});
