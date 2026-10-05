import { expect, it } from 'vitest';
import { outreachPolicySchema } from '../../src/shared/outreach.js';

const policy = { enabled: true, accountId: 'inbox', objective: 'Help the interested buyer try one useful task.', mailingAddress: '', dailyLimit: 3, delayMinutes: 10, followUpDays: [] };
it.each(['sales@example.com', 'mailto:sales@example.com', 'https://example.com/contact'])('does not treat %s as a physical email footer address', mailingAddress => {
  expect(() => outreachPolicySchema.parse({ ...policy, mailingAddress })).toThrow('physical business mailing address');
});
it('accepts postal address text and permits disabling an incomplete policy', () => {
  expect(outreachPolicySchema.parse({ ...policy, mailingAddress: 'PO Box 123, Example City, CA 90000' }).enabled).toBe(true);
  expect(outreachPolicySchema.parse({ ...policy, enabled: false }).enabled).toBe(false);
});
