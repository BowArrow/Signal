import { operationSlots, type Delivery, type OperationState } from './operations.js';

/** Explicit reply budgets are separate from broadcast/article tests. Legacy
 * policies retain their combined allowance until the owner sets a reply budget. */
export function deliveryCapacity(state: OperationState, history: Delivery[], now: number) {
  const separate = state.publicReplyLimit !== undefined;
  const publicationUsed = operationSlots(separate ? history.filter(d => !d.reply) : history, state.productId, now).length;
  const replies = history.filter(d => d.reply);
  const reserved = (d: Delivery) => operationSlots([d], d.productId, now).length > 0
    || (d.status === 'published' && !d.receipt && d.createdAt > now - 86400000);
  const globalReplyUsed = replies.filter(reserved).length;
  const replyUsed = separate ? replies.filter(d => d.productId === state.productId && reserved(d)).length : globalReplyUsed;
  const replyLimit = state.publicReplyLimit ?? 3;
  const canPublish = publicationUsed < state.dailyLimit;
  const canReply = Boolean(state.mode === 'acquisition' && state.replyToRequests && replyUsed < replyLimit
    && globalReplyUsed < (separate ? 10 : 3) && (separate || canPublish));
  return { separate, publicationUsed, replyUsed, globalReplyUsed, replyLimit, canPublish, canReply };
}
