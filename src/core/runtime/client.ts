import type { App } from '../app.js';
import { growthSettings } from '../growth/store.js';
import { marketingSettings } from '../marketing/store.js';
import { OpenAiCompatibleClient } from '../llm/openai-compatible.js';
import { OpenAiResponsesClient } from '../llm/openai-responses.js';
import { reserveCloudCall, runtimeSettings } from './settings.js';

export function agentModel(app: App, role: 'growth' | 'pipeline' | 'marketing' | 'vision'): string {
  const runtime = runtimeSettings(app);
  if (runtime.provider === 'openai') return runtime.openaiModel;
  if (role === 'vision') return runtime.localVisionModel || marketingSettings(app).model;
  const local = growthSettings(app);
  return role === 'marketing' ? marketingSettings(app).model : role === 'pipeline' ? local.pipelineModel : local.model;
}
export function agentClient(app: App, signal?: AbortSignal) {
  const runtime = runtimeSettings(app);
  if (runtime.provider === 'openai') return new OpenAiResponsesClient({
    apiKey: () => app.getSecret?.('OPENAI_API_KEY') ?? app.env.OPENAI_API_KEY,
    model: runtime.openaiModel, maxOutputTokens: runtime.maxOutputTokens,
    reserve: () => reserveCloudCall(app), offline: app.env.SIGNAL_OFFLINE === '1', ...(signal ? { signal } : {}),
  });
  return new OpenAiCompatibleClient(growthSettings(app).baseUrl, app.logger, {
    timeoutMs: 240000, localDevice: () => runtimeSettings(app).localDevice,
    offline: app.env.SIGNAL_OFFLINE === '1', ...(signal ? { signal } : {}),
  });
}
