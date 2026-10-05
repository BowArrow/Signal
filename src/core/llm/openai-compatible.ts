import type { Logger } from '../lib/logger.js';
import type { CompletionRequest, CompletionResult, LlmClient } from './client.js';
import { LlmUnavailableError } from './client.js';
import { localInferenceJson } from './local-request.js';

/**
 * The OpenAI chat-completions shape, which is what almost every local runtime
 * speaks: llama.cpp's llama-server, vLLM, LM Studio, Ollama's compat endpoint.
 *
 * Written against that rather than any one of them, so pointing Signal at a
 * different server is a URL change. No API key is sent unless one is
 * configured — a local server does not want one and some reject the header.
 */

interface ChatResponse {
  readonly choices?: {
    readonly message?: { readonly content?: string };
    readonly finish_reason?: string;
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
  readonly model?: string;
  readonly error?: { readonly message?: string } | string;
}

export class OpenAiCompatibleClient implements LlmClient {
  constructor(
    private readonly baseUrl: string,
    private readonly logger: Logger,
    private readonly options: {
      apiKey?: string | undefined;
      timeoutMs?: number;
      offline?: boolean;
      signal?: AbortSignal;
      localDevice?: 'auto' | 'cpu' | (() => 'auto' | 'cpu');
    } = {},
  ) {}

  available(): { ready: boolean; reason?: string } {
    if (this.options.offline) return { ready: false, reason: 'SIGNAL_OFFLINE=1' };
    if (this.cpuOnly() && !this.isLocalOllama()) return { ready: false, reason: 'CPU-only agents require Ollama at http://localhost:11434/v1 or http://127.0.0.1:11434/v1. Change the local endpoint or select Automatic in Settings.' };
    return { ready: true };
  }

  private cpuOnly(): boolean {
    return (typeof this.options.localDevice === 'function' ? this.options.localDevice() : this.options.localDevice) === 'cpu';
  }

  private isLocalOllama(): boolean {
    try {
      const base = new URL(this.baseUrl);
      return base.protocol === 'http:' && base.port === '11434' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
        && base.pathname.replace(/\/$/, '') === '/v1' && !base.username && !base.password && !base.search && !base.hash;
    } catch { return false; }
  }

  /** Cheap liveness check, so `signal llm check` can say something useful. */
  async ping(): Promise<{ ok: boolean; detail: string; models?: string[] }> {
    const readiness = this.available();
    if (!readiness.ready) return { ok: false, detail: readiness.reason ?? 'unavailable' };
    try {
      const res = await fetch(new URL('models', this.withTrailingSlash()).toString(), {
        redirect: 'error',
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { ok: false, detail: `${res.status} ${res.statusText}` };
      const body = (await res.json()) as { data?: { id?: string }[] };
      const models = (body.data ?? []).map((m) => m.id).filter((id): id is string => id != null);
      return { ok: true, detail: `${models.length} models served`, models };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private withTrailingSlash(): string {
    return this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
    };
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const readiness = this.available();
    if (!readiness.ready) throw new LlmUnavailableError(readiness.reason ?? 'unavailable');

    // Ollama's compatibility endpoint cannot set context size. The operator's
    // tool catalogue and retrieved evidence exceed its default 4K window.
    // Use the native local endpoint for this bounded task so instructions are
    // never silently discarded to make room for a tool result.
    const base = new URL(this.baseUrl);
    const cpuOnly = this.cpuOnly();
    if (cpuOnly && /(?::cloud|-cloud)$/i.test(request.model)) throw new LlmUnavailableError('CPU-only mode requires an installed local model, not an Ollama cloud model.');
    const nativeTask = Boolean(request.images?.length) || request.task?.startsWith('operations.') || request.task?.startsWith('sales') || request.task?.startsWith('growth.') || ['marketing.operator', 'studio.create', 'interpret-rules', 'classify', 'draft'].includes(request.task ?? '');
    if ((nativeTask || cpuOnly) && this.isLocalOllama()) {
      const body = await localInferenceJson(new URL('/api/chat', base), {
        method: 'POST', redirect: 'error', headers: this.headers(),
        signal: AbortSignal.any([AbortSignal.timeout(cpuOnly ? Math.max(this.options.timeoutMs ?? 0, 900000) : this.options.timeoutMs ?? 120000), ...(this.options.signal ? [this.options.signal] : [])]),
        body: JSON.stringify({ model: request.model, stream: false, format: request.jsonSchema ?? (nativeTask || request.expectsJson ? 'json' : undefined), think: false, keep_alive: 0,
          // CPU mode favors desktop responsiveness over throughput. These are
          // inference controls, not a whole-machine power or memory guarantee.
          options: { num_ctx: 16384, num_predict: request.maxTokens, temperature: request.temperature ?? 0, ...(cpuOnly ? { num_gpu: 0, num_thread: 2, num_batch: 128 } : {}) },
          messages: [{ role: 'user', content: request.prompt, ...(request.images?.length ? { images: request.images.map(image => image.base64) } : {}) }] }),
      }) as { message?: { content?: string }; model?: string; prompt_eval_count?: number; eval_count?: number; done_reason?: string; error?: string };
      if (body.error || !body.message?.content) throw new Error(body.error ?? 'Local Ollama returned an empty completion');
      if (body.done_reason === 'length') throw new Error('Local model reached its output limit before completing the response. Use a shorter brief or a more concise model.');
      return { text: body.message.content, model: body.model ?? request.model, inputTokens: body.prompt_eval_count ?? 0, outputTokens: body.eval_count ?? 0, stopReason: body.done_reason ?? null };
    }

    const url = new URL('chat/completions', this.withTrailingSlash()).toString();
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: this.headers(),
      // A 30B on local hardware is much slower than a hosted API. The default
      // fetch timeout would abort a perfectly healthy generation.
      signal: AbortSignal.any([AbortSignal.timeout(this.options.timeoutMs ?? 120_000), ...(this.options.signal ? [this.options.signal] : [])]),
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature ?? 0,
        ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
        ...(request.jsonSchema ? { response_format: { type: 'json_schema', json_schema: { name: 'signal_action', schema: request.jsonSchema } } } : request.expectsJson && (request.task?.startsWith('growth.') || request.task?.startsWith('marketing.')) ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'user', content: request.images?.length ? [{ type: 'text', text: request.prompt }, ...request.images.map(image => ({ type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.base64}` } }))] : request.prompt },
          // Prefill works the same way here: an assistant turn ending mid-JSON
          // is the most reliable way to stop a model wrapping it in prose.
          // Servers that ignore it still produce usable output, because
          // extractJson digs the object out either way.
          ...(request.prefill ? [{ role: 'assistant', content: request.prefill }] : []),
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`${this.baseUrl} returned ${res.status}: ${detail.slice(0, 300)}`);
    }

    const body = (await res.json()) as ChatResponse;
    if (body.error) {
      const message = typeof body.error === 'string' ? body.error : body.error.message;
      throw new Error(`model server error: ${message ?? 'unknown'}`);
    }

    const choice = body.choices?.[0];
    const text = choice?.message?.content ?? '';
    if (!text) throw new Error('model returned an empty completion');

    this.logger.debug('llm call', {
      model: body.model ?? request.model,
      in: body.usage?.prompt_tokens,
      out: body.usage?.completion_tokens,
      stop: choice?.finish_reason,
    });

    return {
      // Local servers may return either a continuation or the full JSON object.
      // Restore a missing prefix without duplicating one already present.
      text: request.prefill && !text.trimStart().startsWith(request.prefill)
        ? request.prefill + text
        : text,
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      model: body.model ?? request.model,
      stopReason: choice?.finish_reason ?? null,
    };
  }
}
