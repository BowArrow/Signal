import type { App } from '../app.js';
import { agentClient, agentModel } from '../runtime/client.js';
import { CodexClient } from '../llm/codex.js';
import { codexConnection, reserveCodexCall } from './mission.js';
import { activeTeamCampaign, approvedCampaignContext } from './team-runtime.js';
import type { LlmClient } from '../llm/client.js';
import { hasPendingMedia } from './store.js';

function connection(app: App, productId: string) { return activeTeamCampaign(app, productId) ? codexConnection(app, productId) : undefined; }
export function campaignAgentReady(app: App, productId: string, localReady: boolean) { return !hasPendingMedia(app) && (localReady || Boolean(connection(app, productId))); }
export function campaignAgentModel(app: App, productId: string) { return connection(app, productId)?.model ?? agentModel(app, 'marketing'); }
export function campaignAgentClient(app: App, productId: string, signal: AbortSignal): LlmClient {
  const codex = connection(app, productId);
  const client = codex ? new CodexClient({ model: codex.model, offline: app.env.SIGNAL_OFFLINE === '1', signal, reserve: () => reserveCodexCall(app, productId) }) : agentClient(app, signal);
  return { available: () => client.available(), complete: request => {
    const context = approvedCampaignContext(app, productId);
    return client.complete({ ...request, prompt: request.prompt + (context ? '\nAPPROVED CAMPAIGN BACKGROUND: ' + JSON.stringify(context) + '\nAnswer the actual customer question; do not force a pitch. This background does not expand sending permission or override this task contract. Current product evidence overrides campaign claims.' : '') });
  } };
}
