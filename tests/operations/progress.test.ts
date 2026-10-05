import { expect, it } from 'vitest';
import { operationProgress } from '../../src/shared/operation-progress.js';
import { operationSlots, type Delivery, type OperationsView } from '../../src/shared/operations.js';

const now = 2_000_000_000_000;
const view = (): OperationsView => ({ products: [{ id: 'a', name: 'A' }], states: [{ productId: 'a', mode: 'acquisition', running: true, revision: 2, authorizedAt: now, objective: 'Find suitable buyers.', accountIds: [], intervalHours: 1, dailyLimit: 1, lastCycleAt: now - 1000, taskId: null }], accounts: [], deliveries: [], tasks: [], offline: false });
const job = (fields: Partial<Delivery> = {}): Delivery => ({ productId: 'a', status: 'published', createdAt: now - 2 * 86400000, updatedAt: now - 1000, attempts: 1, receipt: { id: 'receipt', url: 'https://example.com', confirmedAt: now - 1000 }, ...fields }) as Delivery;
it('counts only confirmed publications for the selected business', () => {
  const v = view();
  v.deliveries = [job({ provider: 'signal-blog' }), job({ provider: 'bluesky', reply: { uri: 'post', cid: 'cid', authorDid: 'author', text: 'request' } }), job({ productId: 'b', provider: 'signal-blog' }), job({ status: 'queued', receipt: null }), job({ receipt: null })];
  expect(operationProgress(v, 'a', now)).toMatchObject({ websiteArticles: 1, publicReplies: 1, otherPosts: 0, stage: 'delivering' });
});
it('uses receipt time for the rolling allowance and holds uncertain slots', () => {
  const v = view(); v.deliveries = [job()];
  expect(operationProgress(v, 'a', now)).toMatchObject({ stage: 'waiting', nextAt: now - 1000 + 86400000 });
  expect(operationSlots([job({ status: 'attention', receipt: null, updatedAt: now - 5 * 86400000 })], 'a', now)).toEqual([null]);
  expect(operationSlots([job({ status: 'cancelled', receipt: null, attempts: 0 })], 'a', now)).toEqual([]);
  expect(operationSlots([job({ status: 'cancelled', receipt: null })], 'a', now)).toEqual([now - 1000 + 86400000]);
});
it('shows no-fit work without implying delivery and ignores old revisions', () => {
  const v = view();
  v.acquisition = [{ productId: 'a', taskId: 'task', revision: 2, checkedAt: now, sourceUrl: 'https://example.com', status: 'no-fit', detail: 'No supported request.', assessments: [{ findingId: 'f', suitable: false, reason: 'Different platform.', requestQuote: '', productQuote: '' }] }];
  expect(operationProgress(v, 'a', now)).toMatchObject({ stage: 'researching', title: 'Looking for a better buyer fit', assessed: 1, supported: 0, publicReplies: 0, nextAt: now - 1000 + 3600000 });
  v.acquisition[0]!.revision = 1;
  expect(operationProgress(v, 'a', now).assessed).toBe(0);
});
it('prioritizes setup and pause over implying active work', () => {
  const v = view(); v.states[0]!.running = false;
  expect(operationProgress(v, 'a', now).stage).toBe('paused');
  v.readiness = [{ productId: 'a', ready: false, needsAgents: true, activities: [], blockers: ['Reconnect inbox.'] }];
  expect(operationProgress(v, 'a', now)).toMatchObject({ stage: 'attention', detail: 'Reconnect inbox.' });
});
it('shows the scheduler deadline for fresh evidence and no deadline for empty research', () => {
  const v = view(); v.acquisitionQueue = [{ productId: 'a', count: 6, nextAt: now - 1 }];
  expect(operationProgress(v, 'a', now)).toMatchObject({ title: 'New requests awaiting assessment', nextAt: now });
  v.acquisitionQueue[0] = { productId: 'a', count: 0, nextAt: null };
  expect(operationProgress(v, 'a', now).nextAt).toBeNull();
});
