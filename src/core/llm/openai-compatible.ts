import type { Logger } from '../lib/logger.js';
import type { CompletionRequest, CompletionResult, LlmClient } from './client.js';
import { LlmUnavailableError } from './client.js';

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
    } = {},
  ) {}

  available(): { ready: boolean; reason?: string } {
    if (this.options.offline) return { ready: false, reason: 'SIGNAL_OFFLINE=1' };
    return { ready: true };
  }

  /** Cheap liveness check, so `signal llm check` can say something useful. */
  async ping(): Promise<{ ok: boolean; detail: string; models?: string[] }> {
    try {
      const res = await fetch(new URL('models', this.withTrailingSlash()).toString(), {
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

    const url = new URL('chat/completions', this.withTrailingSlash()).toString();
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      // A 30B on local hardware is much slower than a hosted API. The default
      // fetch timeout would abort a perfectly healthy generation.
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 120_000),
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature ?? 0,
        messages: [
          { role: 'user', content: request.prompt },
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
      // Same convention as the Anthropic client: the prefill is not echoed
      // back, so put it in front of whatever came out.
      text: (request.prefill ?? '') + text,
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      model: body.model ?? request.model,
      stopReason: choice?.finish_reason ?? null,
    };
  }
}
