import type { App } from '../app.js';
import type { OperationState } from '../../shared/operations.js';
import { hasPublishingPermission } from '../../shared/operations.js';
import type { DemandFinding } from '../../shared/discovery.js';
import { deliveryCapacity } from '../../shared/delivery-capacity.js';
import { chooseOperation } from './learning.js';

/** Only routes that can perform the particular experiment participate in selection. */
export function acquisitionChannel(app: App, state: OperationState, findings: DemandFinding[]) {
  const history = app.operations?.deliveries() ?? [];
  const capacity = deliveryCapacity(state, history, app.clock.now());
  const accounts = app.connections?.accounts().filter(a => a.productId === state.productId && state.accountIds.includes(a.id)
    && a.status === 'verified' && hasPublishingPermission(a) && (!a.expiresAt || a.expiresAt > app.clock.now() || a.refreshable)) ?? [];
  const routes = accounts.flatMap(account => {
    const reply = state.replyToRequests && account.provider === 'bluesky' ? findings.find(f => f.kind === 'bluesky' && f.reply) : undefined;
    if (reply) return capacity.canReply ? [{ account, finding: reply, reply: true }] : [];
    const canPublish = account.provider === 'signal-blog' || ((state.ownedAudience || state.testChannels) && ['x', 'linkedin', 'facebook', 'bluesky'].includes(account.provider));
    // Search queries are website research, not public posts or people to approach.
    const finding = findings.find(f => account.provider === 'signal-blog' || f.kind !== 'search-console');
    return capacity.canPublish && canPublish && finding ? [{ account, finding, reply: false }] : [];
  });
  if (!routes.length) return undefined;
  if (!state.testChannels) return { route: routes.find(r => r.reply) ?? routes.find(r => r.account.provider === 'signal-blog') ?? routes[0]! };
  const learning = chooseOperation(app, { ...state, accountIds: routes.map(r => r.account.id) }, history);
  // Outcome evidence chooses the destination, not somebody else's conversation.
  // The new reply/article must still answer its own selected buyer problem.
  delete learning.reference;
  if (learning.traffic) delete learning.traffic.reference;
  learning.reason += ' This selects a small channel test; the new material must address its own qualified buyer problem. A connected social account does not establish reach.';
  return { route: routes.find(r => r.account.id === learning.accountId)!, learning };
}
