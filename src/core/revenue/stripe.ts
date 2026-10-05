import { z } from 'zod';
import { boundedJson } from '../connections/network.js';
import type { RevenueConfig, RevenuePayment } from '../../shared/revenue.js';
import { stripeProductIdSchema } from '../../shared/revenue.js';
import { purchaseIdentity } from './identity.js';
const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`));
const amount = z.number().int().min(0).max(99999999);
const metadata = z.record(z.string()).default({});
const emailFields = z.object({ email: z.unknown().optional() });
const chargeSchema = z.object({ id: id('ch'), created: z.number().int().nonnegative(), livemode: z.boolean(), currency: z.string().regex(/^[a-z]{3}$/), paid: z.boolean(), captured: z.boolean(), status: z.enum(['succeeded', 'pending', 'failed']), amount_captured: amount, amount_refunded: amount, disputed: z.boolean(), invoice: id('in').nullable().optional(), payment_intent: id('pi').nullable(), metadata });
const listSchema = z.object({ data: z.array(z.unknown()).max(100), has_more: z.boolean() });
export interface StripePayment { id: string; live: boolean; currency: string; captured: number; refunded: number; disputed: boolean; createdAt: number; campaign: string | null; hasCampaign: boolean; contactHash?: string | null; contactMatch?: 'missing' | 'conflicting' | 'available'; settlement?: RevenuePayment['settlement']; }
/** Fixed origin, version and GET-only methods. Raw Stripe data never leaves this reader. */
export class StripeRevenueReader {
  constructor(private readonly token: string, private readonly transport: typeof fetch, private readonly signal: AbortSignal, private readonly assertAllowed: () => void = () => {}) {}
  private async read(path: string, params: Record<string, string> = {}) {
    this.signal.throwIfAborted(); this.assertAllowed();
    const url = new URL(path, 'https://api.stripe.com'); url.search = new URLSearchParams(params).toString();
    try { return await boundedJson(await this.transport(url, { method: 'GET', redirect: 'error', headers: { authorization: `Bearer ${this.token}`, 'Stripe-Version': '2024-06-20' }, signal: AbortSignal.any([this.signal, AbortSignal.timeout(20000)]) })); }
    catch { throw new Error('Stripe read failed. Check network access and restricted-key permissions for charges, invoices, Checkout Sessions, and products.'); }
  }
  async catalog() {
    const result: { id: string; name: string }[] = []; let cursor = '';
    for (let page = 0; page < 10; page++) {
      const list = listSchema.parse(await this.read('/v1/products', { limit: '100', ...(cursor ? { starting_after: cursor } : {}) }));
      for (const raw of list.data) { const product = z.object({ id: stripeProductIdSchema, name: z.string().max(1000) }).parse(raw); result.push({ id: product.id, name: product.name.replaceAll(this.token, '[redacted]').slice(0, 200) }); }
      if (!list.has_more) return result;
      const next = result.at(-1)?.id; if (!next || next === cursor) throw new Error('Stripe product pagination did not advance.'); cursor = next;
    }
    throw new Error('Stripe product catalogue exceeds the supported 1000-product selection window.');
  }
  private async lines(path: string) {
    const productIds: (string | null)[] = []; let cursor = '';
    for (let page = 0; page < 10; page++) {
      const list = listSchema.parse(await this.read(path, { limit: '100', ...(cursor ? { starting_after: cursor } : {}) }));
      for (const raw of list.data) {
        const line = z.object({ id: z.string().regex(/^[a-z]+_[A-Za-z0-9_]+$/), price: z.object({ product: stripeProductIdSchema }).nullable() }).parse(raw);
        // Manual invoice items can legitimately have no Stripe product. Keep an
        // unscoped marker so that whole payment is excluded, not misattributed.
        productIds.push(line.price?.product ?? null);
      }
      if (!list.has_more) return productIds;
      const next = z.object({ id: z.string() }).parse(list.data.at(-1)).id;
      if (next === cursor) throw new Error('Stripe line pagination did not advance.'); cursor = next;
    }
    throw new Error('A payment has too many line items to scope reliably.');
  }
  async page(config: RevenueConfig, cursor: string, startedAt: number): Promise<{ rows: StripePayment[]; next: string; excluded: number; scanned: number }> {
    if (cursor) id('ch').parse(cursor);
    const list = listSchema.parse(await this.read('/v1/charges', { limit: '10', 'created[gte]': String(Math.floor(config.since / 1000)), 'created[lte]': String(Math.floor(startedAt / 1000)), ...(cursor ? { starting_after: cursor } : {}) }));
    const rows: StripePayment[] = []; let excluded = 0; let last = '';
    for (const raw of list.data) {
      const charge = chargeSchema.parse(raw); last = charge.id;
      if (charge.livemode !== config.live) throw new Error('Stripe mode does not match the configured revenue source.');
      if (!charge.paid || !charge.captured || charge.status !== 'succeeded' || charge.amount_captured === 0) { excluded++; continue; }
      let productIds: (string | null)[] = []; const campaigns: string[] = []; let tax: number | undefined;
      const identity = z.object({ billing_details: emailFields.nullable().optional() }).parse(raw);
      const emails: unknown[] = [identity.billing_details?.email];
      const collect = (value: Record<string, string>) => { for (const key of ['signal_campaign', 'utm_campaign']) if (value[key]) campaigns.push(value[key]!); };
      collect(charge.metadata);
      if (charge.invoice) {
        const invoice = z.object({ id: id('in'), metadata, customer_email: z.unknown().optional(), subscription_details: z.object({ metadata }).nullable().optional(), total_tax_amounts: z.array(z.object({ amount })).optional() }).parse(await this.read(`/v1/invoices/${charge.invoice}`));
        if (invoice.total_tax_amounts) tax = invoice.total_tax_amounts.reduce((sum, item) => sum + item.amount, 0);
        if (invoice.id !== charge.invoice) throw new Error('Invoice does not match its charge.');
        emails.push(invoice.customer_email);
        collect(invoice.metadata); if (invoice.subscription_details) collect(invoice.subscription_details.metadata);
        productIds = await this.lines(`/v1/invoices/${charge.invoice}/lines`);
      } else if (charge.payment_intent) {
        const sessions = listSchema.parse(await this.read('/v1/checkout/sessions', { payment_intent: charge.payment_intent, limit: '2' }));
        if (sessions.has_more || sessions.data.length !== 1) { excluded++; continue; }
        const session = z.object({ id: id('cs'), payment_intent: id('pi'), metadata, customer_details: emailFields.nullable().optional(), customer_email: z.unknown().optional(), total_details: z.object({ amount_tax: amount }).nullable().optional() }).parse(sessions.data[0]);
        tax = session.total_details?.amount_tax;
        if (session.payment_intent !== charge.payment_intent) throw new Error('Checkout Session does not match its payment.');
        emails.push(session.customer_details?.email, session.customer_email);
        collect(session.metadata); productIds = await this.lines(`/v1/checkout/sessions/${session.id}/line_items`);
      }
      // Whole-charge amounts cannot be assigned to one product in a mixed basket.
      if (!productIds.length || productIds.some(p => p === null || !config.stripeProductIds.includes(p))) { excluded++; continue; }
      if (charge.amount_refunded > charge.amount_captured) throw new Error('Stripe refund amount exceeds the captured amount.');
      const unique = [...new Set(campaigns)];
      const campaign = unique.length === 1 && /^[A-Za-z0-9_-]{1,100}$/.test(unique[0]!) ? unique[0]! : null;
      let settlement: RevenuePayment['settlement'];
      // A restricted key may permit sales reads without balance transactions.
      // Preserve revenue reporting, but never treat missing cash evidence as zero fees/tax.
      const balanceId = z.object({ balance_transaction: id('txn').nullable().optional() }).safeParse(raw);
      if (tax !== undefined && balanceId.success && balanceId.data.balance_transaction) {
        try {
          const value = z.object({ id: id('txn'), source: id('ch'), currency: z.string(), amount, fee: amount, net: z.number().int(), available_on: z.number().int().nonnegative(), status: z.enum(['pending', 'available']) }).parse(await this.read(`/v1/balance_transactions/${balanceId.data.balance_transaction}`));
          if (value.id === balanceId.data.balance_transaction && value.source === charge.id && value.currency === charge.currency && value.amount === charge.amount_captured && value.net === value.amount - value.fee && tax <= value.amount) settlement = { id: value.id, currency: value.currency, amount: value.amount, fee: value.fee, net: value.net, availableAt: value.available_on * 1000, status: value.status, tax };
        } catch { this.signal.throwIfAborted(); this.assertAllowed(); }
      }
      rows.push({ id: charge.id, live: charge.livemode, currency: charge.currency, captured: charge.amount_captured, refunded: charge.amount_refunded, disputed: charge.disputed, createdAt: charge.created * 1000, campaign, hasCampaign: campaigns.length > 0, ...purchaseIdentity(config.accountId, emails), ...(settlement ? { settlement } : {}) });
    }
    if (list.has_more && (!last || last === cursor)) throw new Error('Stripe charge pagination did not advance.');
    return { rows, next: list.has_more ? last : '', excluded, scanned: list.data.length };
  }
}
