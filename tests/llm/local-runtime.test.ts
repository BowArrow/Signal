import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { agentClient } from '../../src/core/runtime/client.js';
import { runtimeSettings, saveRuntimeSettings } from '../../src/core/runtime/settings.js';
import { runtimeSettingsSchema } from '../../src/shared/runtime.js';
afterEach(() => vi.unstubAllGlobals());

it('defaults older profiles to automatic and applies saved changes to existing agent and pipeline clients', async () => {
  expect(runtimeSettingsSchema.parse({ provider: 'local' }).localDevice).toBe('auto');
  const app = createApp({ databaseUrl: ':memory:', logger: silentLogger });
  try {
    const agent = agentClient(app);
    const fetcher = vi.fn(async () => Response.json({ message: { content: '{"ok":true}' } }));
    vi.stubGlobal('fetch', fetcher);
    saveRuntimeSettings(app, { ...runtimeSettings(app), localDevice: 'cpu' });
    expect(runtimeSettings(app).localDevice).toBe('cpu');
    const request = { model: 'local', prompt: 'Help', task: 'draft', maxTokens: 100 };
    await agent.complete(request);
    // The legacy pipeline is configured for a separate non-Ollama server.
    // It must hold rather than ignore the newly saved CPU requirement.
    await expect(app.llm.complete(request)).rejects.toThrow('CPU-only');
    expect(fetcher).toHaveBeenCalledOnce();
    for (const call of fetcher.mock.calls as unknown as [unknown, RequestInit][]) expect(JSON.parse(String(call[1].body)).options.num_gpu).toBe(0);
    saveRuntimeSettings(app, { ...runtimeSettings(app), localDevice: 'auto' });
    await agent.complete(request);
    expect(JSON.parse(String((fetcher.mock.calls as unknown as [unknown, RequestInit][])[1]![1].body)).options).not.toHaveProperty('num_gpu');
  } finally { app.close(); }
});
