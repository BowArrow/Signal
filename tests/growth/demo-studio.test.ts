import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { demoStudioCommand } from '../../src/core/marketing/demo-studio.js';

const folders: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });
async function connection(url: string) {
  const folder = await mkdtemp(join(tmpdir(), 'signal-demo-')); folders.push(folder);
  const file = join(folder, 'connection.json'); await writeFile(file, JSON.stringify({ url, token: 'a'.repeat(64) }));
  return { SIGNAL_DEMO_STUDIO_CONNECTION: file };
}
describe('Signal demo studio adapter', () => {
  it('rejects other businesses and unknown operations before contacting a service', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(demoStudioCommand('cinegen', { action: 'status' }, new AbortController().signal)).rejects.toThrow('only Lemonade');
    await expect(demoStudioCommand('lemonade', { action: 'execute' }, new AbortController().signal)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects nonlocal endpoints', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(demoStudioCommand('lemonade', { action: 'status' }, new AbortController().signal, await connection('https://example.com'))).rejects.toThrow('this computer');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('forwards the command with authentication and returns the durable receipt', async () => {
    const receipt = { saved: true, sessionId: 'session', asset: { path: 'shot.png' } };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(receipt), { status: 200 })); vi.stubGlobal('fetch', fetch);
    const input = { action: 'screenshot', title: 'Real product' };
    const result = await demoStudioCommand('lemonade', input, new AbortController().signal, await connection('http://127.0.0.1:4319'));
    expect(result).toEqual(receipt);
    expect(fetch).toHaveBeenCalledWith(new URL('http://127.0.0.1:4319/api/command'), expect.objectContaining({ redirect: 'error', body: JSON.stringify(input), headers: expect.objectContaining({ Authorization: `Bearer ${'a'.repeat(64)}` }) }));
  });
});
