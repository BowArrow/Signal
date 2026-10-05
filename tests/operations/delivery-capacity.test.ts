import { expect, it } from 'vitest';
import { deliveryCapacity } from '../../src/shared/delivery-capacity.js';
import type { Delivery, OperationState } from '../../src/shared/operations.js';
const now = 2_000_000_000_000;
const state = { productId: 'a', mode: 'acquisition', replyToRequests: true, dailyLimit: 1 } as OperationState;
const job = (reply: boolean, patch: Partial<Delivery> = {}) => ({ id: 'one', productId: 'a', status: 'published', attempts: 1, createdAt: now - 1000, updatedAt: now - 1000, receipt: { id: 'post', confirmedAt: now - 1000, url: 'https://example.com' }, ...(reply ? { reply: { uri: 'post', cid: 'cid', authorDid: 'author', text: 'Question' } } : {}), ...patch }) as Delivery;
it('preserves the combined allowance for existing policies', () => {
  expect(deliveryCapacity(state, [job(false)], now)).toMatchObject({ canPublish: false, canReply: false, separate: false });
  expect(deliveryCapacity(state, [job(true)], now)).toMatchObject({ canPublish: false, canReply: false });
});
it('keeps a website post from consuming an explicitly configured reply budget', () => {
  expect(deliveryCapacity({ ...state, publicReplyLimit: 5 }, [job(false)], now)).toMatchObject({ canPublish: false, canReply: true, replyUsed: 0, replyLimit: 5 });
  expect(deliveryCapacity({ ...state, publicReplyLimit: 5 }, Array.from({ length: 5 }, () => job(true)), now)).toMatchObject({ canPublish: true, canReply: false, publicationUsed: 0, replyUsed: 5 });
});
it('counts pending and uncertain replies even after a day and releases only resolved slots', () => {
  const history = [job(true, { status: 'attention', createdAt: now - 3 * 86400000, receipt: null })];
  expect(deliveryCapacity({ ...state, publicReplyLimit: 1 }, history, now).canReply).toBe(false);
  history[0] = job(true, { status: 'cancelled', attempts: 0, receipt: null });
  expect(deliveryCapacity({ ...state, publicReplyLimit: 1 }, history, now).canReply).toBe(true);
});
it('enforces business reply limits and the shared ceiling without adding email contacts', () => {
  const elsewhere = Array.from({ length: 9 }, () => job(true, { productId: 'b' }));
  expect(deliveryCapacity({ ...state, publicReplyLimit: 5 }, elsewhere, now)).toMatchObject({ canReply: true, replyUsed: 0, globalReplyUsed: 9 });
  expect(deliveryCapacity({ ...state, publicReplyLimit: 5 }, [...elsewhere, job(true)], now).canReply).toBe(false);
  expect(deliveryCapacity({ ...state, publicReplyLimit: 5, replyToRequests: false }, [], now).canReply).toBe(false);
});
