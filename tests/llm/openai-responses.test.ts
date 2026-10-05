import { afterEach, expect, it, vi } from 'vitest';
import { OpenAiResponsesClient } from '../../src/core/llm/openai-responses.js';
import { createApp } from '../../src/core/app.js';
import { agentClient, agentModel } from '../../src/core/runtime/client.js';
import { cloudCallsToday, reserveCloudCall, saveRuntimeSettings } from '../../src/core/runtime/settings.js';
import { runtimeSettingsSchema } from '../../src/shared/runtime.js';
afterEach(() => vi.unstubAllGlobals());
const client = (reserve = vi.fn()) => new OpenAiResponsesClient({ apiKey: () => 'sk-test-secret', model: 'test-model', maxOutputTokens: 6000, offline: false, reserve });
it('sends reviewed image bytes as Responses image input while keeping storage disabled', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"approved":true}' }] }] })); vi.stubGlobal('fetch', fetcher);
  await client().complete({ model: 'test-model', prompt: 'Review the image', maxTokens: 1200, expectsJson: true, images: [{ mime: 'image/jpeg', base64: 'aW1hZ2U=' }] });
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({ store: false, input: [{ role: 'user', content: [{ type: 'input_text', text: expect.stringContaining('Review the image') }, { type: 'input_image', image_url: 'data:image/jpeg;base64,aW1hZ2U=', detail: 'high' }] }] });
});
it('sends only to the fixed OpenAI origin, disables storage, and extracts text beside reasoning items', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ status: 'completed', model: 'test-model', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }], usage: { input_tokens: 10, output_tokens: 20 } }));
  vi.stubGlobal('fetch', fetcher); const reserve = vi.fn();
  expect(await client(reserve).complete({ model: 'ignored-local-tag', prompt: 'Return JSON', maxTokens: 2000, expectsJson: true })).toMatchObject({ text: '{"ok":true}', inputTokens: 10 });
  const [url, request] = fetcher.mock.calls[0]!; expect(url).toBe('https://api.openai.com/v1/responses'); expect(request.redirect).toBe('error'); expect(JSON.parse(request.body)).toMatchObject({ model: 'test-model', store: false, text: { format: { type: 'json_object' } } }); expect(reserve).toHaveBeenCalledOnce();
});
it('does not expose remote error bodies or accept incomplete generations', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('sk-test-secret and private context', { status: 401 })));
  await expect(client().complete({ model: 'x', prompt: 'x', maxTokens: 1000 })).rejects.toThrow('HTTP 401');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ status: 'incomplete', output: [] })));
  await expect(client().complete({ model: 'x', prompt: 'x', maxTokens: 1000 })).rejects.toThrow('did not complete');
});
it('routes all agent roles and persists the daily request cap', () => {
  const app = createApp({ databaseUrl: ':memory:', getSecret: () => 'sk-test' });
  try { saveRuntimeSettings(app, { ...runtimeSettingsSchema.parse({}), provider: 'openai', openaiModel: 'test-model', dailyCallLimit: 1 });
    expect(['growth', 'marketing', 'pipeline', 'vision'].map(role => agentModel(app, role as 'growth'))).toEqual(['test-model', 'test-model', 'test-model', 'test-model']);
    expect(agentClient(app)).toBeInstanceOf(OpenAiResponsesClient); reserveCloudCall(app); expect(cloudCallsToday(app)).toBe(1); expect(() => reserveCloudCall(app)).toThrow('Daily GPT call limit');
  } finally { app.close(); }
});
