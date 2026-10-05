import { describe, expect, it } from 'vitest';
import {
  assertGroundedMoney,
  modelContext,
} from '../../src/core/growth/context.js';
describe('monetary grounding', () => {
  it('turns nested cents into labelled currency for model consumption', () => {
    expect(
      modelContext(
        {
          goal: { maxCacCents: 1500 },
          tests: [{ spendCents: 100, visitors: 120 }],
        },
        'USD',
      ),
    ).toEqual({
      goal: { maxCac: 'USD 15.00' },
      tests: [{ spend: 'USD 1.00', visitors: 120 }],
    });
  });
  it('rejects cents echoed as dollars and accepts correctly rendered amounts', () => {
    const context = { maxCacCents: 1500, budgetCents: 5000 };
    expect(() =>
      assertGroundedMoney(
        { summary: 'The maximum CAC is $1500.' },
        context,
        'USD',
      ),
    ).toThrow('Unsupported');
    expect(() =>
      assertGroundedMoney(
        { summary: 'The maximum CAC is $15.00 within a USD 50 budget.' },
        context,
        'USD',
      ),
    ).not.toThrow();
    expect(() =>
      assertGroundedMoney({ summary: 'Spend €15.00' }, context, 'EUR'),
    ).not.toThrow();
  });
});
