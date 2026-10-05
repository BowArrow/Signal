import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleClient } from '../../src/core/llm/openai-compatible.js';
import { silentLogger } from '../../src/core/lib/logger.js';
afterEach(() => vi.unstubAllGlobals());
describe('local completion transport', () => {
  it.each(['http://127.0.0.1:11434/v1', 'http://127.0.0.1:8080/v1'])('includes pixels when reviewing an image with %s', async base => {
    const fetcher = vi.fn(async () => Response.json(base.includes('11434') ? { message: { content: '{"approved":true}' } } : { choices: [{ message: { content: '{"approved":true}' } }] })); vi.stubGlobal('fetch', fetcher);
    await new OpenAiCompatibleClient(base, silentLogger).complete({ model: 'vision', task: 'operations.image-review', prompt: 'Review', maxTokens: 1200, expectsJson: true, images: [{ mime: 'image/jpeg', base64: 'aW1hZ2U=' }] });
    const body = JSON.parse((fetcher.mock.calls as unknown as [unknown, RequestInit][])[0]![1].body as string);
    expect(body.messages[0]).toEqual(base.includes('11434') ? { role: 'user', content: 'Review', images: ['aW1hZ2U='] } : { role: 'user', content: [{ type: 'text', text: 'Review' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,aW1hZ2U=' } }] });
  });
  it.each(['marketing.operator', 'studio.create', 'growth.research', 'draft', 'operations.compose', 'operations.review', 'sales-triage', 'sales.reply', 'sales.reply-review'])('gives %s enough context and releases model memory for creative jobs', async (task) => {
    const fetch = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.toString()).toBe('http://127.0.0.1:11434/api/chat');
      const body = JSON.parse(String(init.body));
      expect(body.options).toMatchObject({ num_ctx: 16384, num_predict: 2400 });
      expect(body.options).not.toHaveProperty('num_gpu');
      expect(body).toMatchObject({ stream: false, format: 'json', think: false, keep_alive: 0 });
      return new Response(JSON.stringify({ message: { content: '{"message":"Ready","actions":[]}' }, prompt_eval_count: 6200, eval_count: 12 }));
    });
    vi.stubGlobal('fetch', fetch);
    const client = new OpenAiCompatibleClient('http://127.0.0.1:11434/v1', silentLogger);
    expect((await client.complete({ model: 'local', prompt: 'tools and evidence', task, maxTokens: 2400 })).inputTokens).toBe(6200);
  });
  it.each(['{"score":1}', '"score":1}'])(
    'accepts full or continued JSON from a server with prefill: %s',
    async (text) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({ choices: [{ message: { content: text } }] }),
            ),
        ),
      );
      const client = new OpenAiCompatibleClient(
        'http://localhost:8080/v1',
        silentLogger,
      );
      const result = await client.complete({
        model: 'local',
        prompt: 'test',
        maxTokens: 10,
        prefill: '{',
      });
      expect(JSON.parse(result.text)).toEqual({ score: 1 });
    },
  );
  it('honors offline mode for both health checks and generation', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const client = new OpenAiCompatibleClient(
      'http://localhost:8080/v1',
      silentLogger,
      { offline: true },
    );
    expect((await client.ping()).ok).toBe(false);
    await expect(
      client.complete({ model: 'local', prompt: 'test', maxTokens: 10 }),
    ).rejects.toThrow('SIGNAL_OFFLINE');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['http://127.0.0.1:11434/v1', 'http://localhost:11434/v1/', 'http://[::1]:11434/v1'])('runs even unknown tasks through native CPU-only Ollama at %s', async base => {
    const fetcher = vi.fn(async (_url: URL, init: RequestInit) => {
      expect(String(_url)).toBe(new URL('/api/chat', base).href);
      expect(JSON.parse(String(init.body))).toMatchObject({ options: { num_gpu: 0, num_thread: 2, num_batch: 128, num_ctx: 16384, num_predict: 100 }, keep_alive: 0 });
      expect(JSON.parse(String(init.body))).not.toHaveProperty('format');
      return Response.json({ message: { content: 'A useful response' } });
    });
    vi.stubGlobal('fetch', fetcher);
    const client = new OpenAiCompatibleClient(base, silentLogger, { localDevice: 'cpu' });
    expect((await client.complete({ model: 'local', task: 'new-task', prompt: 'Help', maxTokens: 100 })).text).toBe('A useful response');
  });
  it.each(['http://localhost:8080/v1', 'https://localhost:11434/v1', 'http://remote.example:11434/v1', 'http://localhost:11434/proxy/v1', 'http://localhost:11434/v1?token=x', 'http://user:pass@localhost:11434/v1', 'not a URL'])('blocks CPU-only requests to unsupported endpoint %s without a fallback', async base => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const client = new OpenAiCompatibleClient(base, silentLogger, { localDevice: 'cpu' });
    expect(client.available()).toMatchObject({ ready: false });
    expect(await client.ping()).toMatchObject({ ok: false, detail: expect.stringContaining('CPU-only') });
    await expect(client.complete({ model: 'local', prompt: 'Help', maxTokens: 100 })).rejects.toThrow('CPU-only');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves structured output and cancellation in CPU mode', async () => {
    const controller = new AbortController(); const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toMatchObject({ format: schema, options: { num_gpu: 0 }, messages: [{ images: ['aW1hZ2U='] }] });
      controller.abort(); expect(init.signal?.aborted).toBe(true); throw Error('cancelled');
    }));
    const client = new OpenAiCompatibleClient('http://localhost:11434/v1', silentLogger, { localDevice: 'cpu', signal: controller.signal });
    await expect(client.complete({ model: 'vision', prompt: 'Review', maxTokens: 100, jsonSchema: schema, images: [{ mime: 'image/jpeg', base64: 'aW1hZ2U=' }] })).rejects.toThrow('cancelled');
  });
  it('rejects cloud model tags in CPU mode before sending a request', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const client = new OpenAiCompatibleClient('http://localhost:11434/v1', silentLogger, { localDevice: 'cpu' });
    await expect(client.complete({ model: 'model:cloud', prompt: 'Help', maxTokens: 100 })).rejects.toThrow('installed local model');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('passes cancellation to fetch without sending a cloud credential', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(
        (init.headers as Record<string, string>)['authorization'],
      ).toBeUndefined();
      controller.abort();
      expect(init.signal?.aborted).toBe(true);
      throw new Error('aborted');
    });
    vi.stubGlobal('fetch', fetch);
    const client = new OpenAiCompatibleClient(
      'http://localhost:8080/v1',
      silentLogger,
      { signal: controller.signal },
    );
    await expect(
      client.complete({ model: 'local', prompt: 'test', maxTokens: 10 }),
    ).rejects.toThrow('aborted');
  });
});
