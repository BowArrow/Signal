import { expect, it, vi } from 'vitest';
import { StripeRevenueReader } from '../../src/core/revenue/stripe.js';

async function read(variation: string) {
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input)); expect(url.origin).toBe('https://api.stripe.com'); expect(init?.method).toBe('GET'); expect(init?.redirect).toBe('error');
    const list = (data: unknown[]) => Response.json({ data, has_more: false });
    if (url.pathname === '/v1/charges') return list([{ id: 'ch_1', created: 1700000000, livemode: true, currency: 'usd', paid: true, captured: true, status: 'succeeded', amount_captured: 4900, amount_refunded: 0, disputed: false, invoice: variation === 'invoice' ? 'in_1' : null, payment_intent: 'pi_1', metadata: {}, balance_transaction: variation === 'no-balance' ? null : 'txn_1' }]);
    if (url.pathname === '/v1/checkout/sessions') return list([{ id: 'cs_1', payment_intent: 'pi_1', metadata: {}, ...(variation === 'no-tax' ? {} : { total_details: { amount_tax: 400 } }) }]);
    if (url.pathname.endsWith('/line_items') || url.pathname.endsWith('/lines')) return list([{ id: 'li_1', price: { product: 'prod_1' } }]);
    if (url.pathname === '/v1/invoices/in_1') return Response.json({ id: 'in_1', metadata: {}, total_tax_amounts: [{ amount: 300 }, { amount: 100 }] });
    if (url.pathname === '/v1/balance_transactions/txn_1') {
      if (variation === 'forbidden') return Response.json({ error: { message: 'restricted' } }, { status: 403 });
      return Response.json({ id: variation === 'wrong-id' ? 'txn_2' : 'txn_1', source: variation === 'wrong-charge' ? 'ch_2' : 'ch_1', currency: variation === 'fx' ? 'eur' : 'usd', amount: variation === 'amount' ? 4901 : 4900, fee: 172, net: variation === 'net' ? 4900 : 4728, available_on: 1700100000, status: variation === 'pending' ? 'pending' : 'available' });
    }
    throw Error('Unexpected endpoint');
  });
  const reader = new StripeRevenueReader('fixture-read-only-key', transport, new AbortController().signal);
  const result = await reader.page({ accountId: 'stripe', stripeProductIds: ['prod_1'], since: 1600000000000, live: true }, '', 1800000000000);
  return { result, transport };
}
it.each(['checkout', 'invoice', 'pending'])('reads linked %s cash evidence without a Stripe write', async variant => {
  const { result } = await read(variant);
  expect(result.rows[0]?.settlement).toEqual({ id: 'txn_1', currency: 'usd', amount: 4900, fee: 172, net: 4728, tax: 400, availableAt: 1700100000000, status: variant === 'pending' ? 'pending' : 'available' });
});
it.each(['forbidden', 'no-tax', 'no-balance', 'wrong-id', 'wrong-charge', 'fx', 'amount', 'net'])('preserves sales reporting but leaves %s cash evidence unavailable', async variant => {
  const { result } = await read(variant); expect(result.rows).toHaveLength(1); expect(result.rows[0]?.captured).toBe(4900); expect(result.rows[0]?.settlement).toBeUndefined();
});
