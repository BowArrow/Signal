import { expect, it } from 'vitest';
import { channelCoverage } from '../../src/shared/channel-coverage.js';
import { operationPolicySchema, type OperationsView } from '../../src/shared/operations.js';
const now = Date.now();
const view = (): OperationsView => ({ offline: false, products: [], states: [{ productId: 'one', mode: 'acquisition', running: true, testChannels: true, objective: 'Find relevant document buyers.', accountIds: [], intervalHours: 1, dailyLimit: 1, revision: 1, authorizedAt: now, taskId: null, lastCycleAt: null }], accounts: [], tasks: [], deliveries: [] });
it('shows all 19 channels without inventing readiness or completed experiments', () => {
  const rows = channelCoverage(view(), 'one', now);
  expect(rows).toHaveLength(19);
  expect(rows.find(c => c.key === 'community')?.status).toBe('Needs setup');
  expect(rows.find(c => c.key === 'sem')?.status).toBe('Funding and launch required');
  expect(rows.find(c => c.key === 'affiliates')?.status).toBe('Partner recruitment required');
  expect(rows.some(c => c.status === 'Enabled')).toBe(false);
  expect(rows.every(c => c.nextStep.length > 30 && c.steps.length > 0 && c.measure && c.destination)).toBe(true);
  expect(rows.find(c => c.key === 'community')?.lane).toBe('setup');
  expect(rows.find(c => c.key === 'platforms')?.nextStep).toContain('existing LTD submissions');
  expect(rows.find(c => c.key === 'email')?.nextStep).toContain('connecting Gmail alone');
});
it('uses only the selected business readiness and distinguishes pause and offline', () => {
  const v = view(); v.readiness = [{ productId: 'two', ready: true, needsAgents: false, blockers: [], activities: [{ label: 'Public request replies', ready: true, detail: '' }] }];
  expect(channelCoverage(v, 'one', now).find(c => c.key === 'community')?.status).toBe('Needs setup');
  v.readiness[0]!.productId = 'one'; expect(channelCoverage(v, 'one', now).find(c => c.key === 'community')?.status).toBe('Enabled');
  v.states[0]!.running = false; expect(channelCoverage(v, 'one', now).find(c => c.key === 'community')?.status).toBe('Ready when Run starts');
  v.states[0]!.running = true; v.offline = true; expect(channelCoverage(v, 'one', now).find(c => c.key === 'community')?.status).toBe('Ready when Run starts');
});
it('permits testing more than three selected accounts but still rejects duplicates and excessive selection', () => {
  const policy = { testChannels: true, objective: 'Test a few feasible channels.', accountIds: ['website', 'blue', 'x', 'linkedin', 'facebook'], dailyLimit: 1, intervalHours: 1 };
  expect(operationPolicySchema.parse(policy).accountIds).toHaveLength(5);
  expect(() => operationPolicySchema.parse({ ...policy, accountIds: ['x', 'x'] })).toThrow();
  expect(() => operationPolicySchema.parse({ ...policy, accountIds: Array.from({ length: 11 }, (_, i) => String(i)) })).toThrow();
});
