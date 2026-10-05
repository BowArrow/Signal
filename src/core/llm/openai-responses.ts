import type { CompletionRequest, CompletionResult, LlmClient } from './client.js';

/** The key can only travel to OpenAI's fixed HTTPS origin. Error bodies are never logged. */
export class OpenAiResponsesClient implements LlmClient {
  constructor(private readonly options: {
    apiKey: () => string | undefined; model: string; maxOutputTokens: number;
    offline: boolean; reserve: () => void; signal?: AbortSignal;
  }) {}
  available() {
    if (this.options.offline) return { ready: false, reason: 'SIGNAL_OFFLINE=1' };
    return this.options.apiKey() ? { ready: true } : { ready: false, reason: 'Add an OpenAI API key in Settings.' };
  }
  async ping(): Promise<{ ok: boolean; detail: string; models: string[] }> {
    const ready = this.available();
    if (!ready.ready) return { ok: false, detail: ready.reason!, models: [] };
    try {
      const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(this.options.model)}`, {
        headers: { authorization: `Bearer ${this.options.apiKey()}` }, redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      return { ok: response.ok, detail: response.ok ? 'API key and model access verified. Generation uses your OpenAI billing.' : `OpenAI model check returned HTTP ${response.status}. Check the key and model access.`, models: response.ok ? [this.options.model] : [] };
    } catch { return { ok: false, detail: 'Could not reach OpenAI. Check your connection.', models: [] }; }
  }
  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const ready = this.available();
    if (!ready.ready) throw new Error(ready.reason);
    this.options.signal?.throwIfAborted();
    this.options.reserve();
    const prompt = request.prompt + (request.expectsJson ? '\nReturn only a JSON object matching the requested contract.' : '');
    // Tool inputs are a dynamic object, so use JSON mode plus the engine's Zod
    // validators. Claiming strict schema compliance for that shape is incorrect.
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${this.options.apiKey()}`, 'content-type': 'application/json' },
      signal: AbortSignal.any([AbortSignal.timeout(240000), ...(this.options.signal ? [this.options.signal] : [])]),
      body: JSON.stringify({ model: this.options.model, store: false,
        input: request.images?.length ? [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...request.images.map(image => ({ type: 'input_image', image_url: `data:${image.mime};base64,${image.base64}`, detail: 'high' }))] }] : prompt,
        max_output_tokens: Math.min(this.options.maxOutputTokens, Math.max(request.maxTokens, 4000)),
        ...(request.expectsJson ? { text: { format: ['studio.create', 'operations.compose'].includes(request.task ?? '') && request.jsonSchema ? { type: 'json_schema', name: 'campaign_material', strict: true, schema: request.jsonSchema } : { type: 'json_object' } } } : {}),
      }),
    });
    if (!response.ok) throw new Error(`OpenAI returned HTTP ${response.status}. Check billing, model access, and rate limits in your OpenAI account.`);
    const body = await response.json() as { status?: string; model?: string; output?: { type: string; content?: { type: string; text?: string }[] }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    if (body.status !== 'completed') throw new Error('GPT did not complete the response. Increase the output token limit or retry a smaller task.');
    const content = (body.output ?? []).flatMap(item => item.type === 'message' ? item.content ?? [] : []);
    if (content.some(item => item.type === 'refusal')) throw new Error('GPT declined this request. Revise the campaign brief.');
    const text = content.filter(item => item.type === 'output_text').map(item => item.text ?? '').join('');
    if (!text.trim()) throw new Error('GPT returned no usable text.');
    return { text, model: body.model ?? this.options.model, inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0, stopReason: 'completed' };
  }
}
