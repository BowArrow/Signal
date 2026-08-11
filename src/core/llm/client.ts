import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from '../lib/logger.js';

/**
 * Everything that talks to a model goes through this interface, so scoring and
 * drafting can be tested against recorded responses without a key and without
 * a network. The real implementation is a thin wrapper; the seam is the point.
 */
export interface CompletionRequest {
  readonly model: string;
  readonly prompt: string;
  readonly maxTokens: number;
  /** Seeds the assistant turn. Used to force JSON without a code fence. */
  readonly prefill?: string;
  readonly temperature?: number;
  /** Which of the three jobs this is. Recorded, so the tasks can be compared. */
  readonly task?: string;
  /**
   * True when the prompt demands JSON. The recorder checks whether it got
   * any, which is the metric that decides whether a smaller model can hold
   * these contracts.
   */
  readonly expectsJson?: boolean;
}

export interface CompletionResult {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly model: string;
  readonly stopReason: string | null;
}

export interface LlmClient {
  complete(request: CompletionRequest): Promise<CompletionResult>;
  available(): { ready: boolean; reason?: string };
}

export class LlmUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'LlmUnavailableError';
  }
}

export class AnthropicClient implements LlmClient {
  private readonly client: Anthropic | null;

  constructor(
    apiKey: string | undefined,
    private readonly logger: Logger,
    private readonly offline = false,
  ) {
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  available(): { ready: boolean; reason?: string } {
    if (this.offline) return { ready: false, reason: 'SIGNAL_OFFLINE=1' };
    if (!this.client) return { ready: false, reason: 'ANTHROPIC_API_KEY is not set' };
    return { ready: true };
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const readiness = this.available();
    if (!this.client || !readiness.ready) {
      throw new LlmUnavailableError(readiness.reason ?? 'no LLM client');
    }

    const response = await this.client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      ...(request.temperature == null ? {} : { temperature: request.temperature }),
      messages: [
        { role: 'user', content: request.prompt },
        // Prefilling the assistant turn is the reliable way to get raw JSON
        // rather than JSON wrapped in a markdown fence and an apology.
        ...(request.prefill ? [{ role: 'assistant' as const, content: request.prefill }] : []),
      ],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    this.logger.debug('llm call', {
      model: response.model,
      in: response.usage.input_tokens,
      out: response.usage.output_tokens,
      stop: response.stop_reason,
    });

    return {
      // The prefill is not echoed back, so put it in front of what we got.
      text: (request.prefill ?? '') + text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: response.model,
      stopReason: response.stop_reason,
    };
  }
}

/**
 * Returns canned responses in order. Tests use this, and so does anyone
 * exercising the pipeline without a key.
 */
export class ScriptedLlmClient implements LlmClient {
  readonly calls: CompletionRequest[] = [];
  private index = 0;

  constructor(private readonly responses: string[]) {}

  available(): { ready: boolean } {
    return { ready: true };
  }

  complete(request: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(request);
    const text = this.responses[this.index];
    if (text === undefined) {
      return Promise.reject(
        new Error(`ScriptedLlmClient ran out of responses after ${this.index} calls`),
      );
    }
    this.index += 1;
    return Promise.resolve({
      text,
      inputTokens: 0,
      outputTokens: 0,
      model: request.model,
      stopReason: 'end_turn',
    });
  }
}

/**
 * Pulls a JSON object out of a model response.
 *
 * Models wrap JSON in fences, prepend "Here is the JSON:", or trail a closing
 * remark, all despite instructions. Prefilling handles most of it; this
 * handles the rest rather than failing a whole batch over a stray backtick.
 */
export function extractJson<T>(text: string): T {
  const trimmed = text.trim();

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidates = [
    fenced?.[1],
    trimmed,
    // Widest span from the first brace to the last.
    trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate.trim()) as T;
    } catch {
      continue;
    }
  }

  throw new Error(`model did not return parseable JSON: ${trimmed.slice(0, 300)}`);
}
