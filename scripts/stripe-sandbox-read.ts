// Uses the real connection and revenue services with an isolated in-memory DB.
// The owner database, vault, live key and business operating policies are untouched.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { ConnectionService, type CredentialVault } from '../src/core/connections/service.js';
import { RevenueService } from '../src/core/revenue/service.js';
import { studioCampaigns, studioLeads, marketingCash } from '../src/core/db/schema.js';
const root = resolve(process.argv.includes('--topup') ? 'data/stripe-topup-validation' : 'data/stripe-sandbox-validation');
const state = JSON.parse(readFileSync(root + '/state.json', 'utf8')) as {
  since: number; cases: Record<string, { campaign: string; product: string; expectedAmount: number; expectedRefunded?: number; paymentStatus: string; sessionId: string }>;
};
const key = dotenv.parse(readFileSync('../CineGen/functions/.env')).STRIPE_SECRET_KEY!;
assert(/^(sk|rk)_test_/.test(key ?? ''), 'A Stripe test key is required');
process.env.SIGNAL_OFFLINE = '0';
class Vault implements CredentialVault {
  data = new Map<string, string>();
  available() { return true; }
  get(key: string) { return this.data.get(key); }
  set(key: string, value: string) { this.data.set(key, value); }
  delete(key: string) { this.data.delete(key); }
}
const requests: string[] = [];
const transport: typeof fetch = async (input, options) => {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://api.stripe.com');
  assert.equal(options?.method ?? 'GET', 'GET', 'The revenue integration must remain read-only');
  requests.push(url.pathname);
  return fetch(input, options);
};
const app = createApp({ databaseUrl: ':memory:', logger: silentLogger });
const vault = new Vault();
const connections = new ConnectionService(app, vault, undefined, transport);
app.connections = connections;
const service = new RevenueService(app); app.revenue = service;
const results = [];
try {
  const products = connections.view().products;
  for (const [business, item] of Object.entries(state.cases)) {
    assert.equal(item.paymentStatus, 'paid', business + ' must complete hosted checkout first');
    const productId = products.find(p => p.name.toLowerCase() === business)!.id;
    await connections.connect({ productId, provider: 'stripe', label: 'Isolated sandbox ' + business, credential: key });
    const accountId = connections.accounts().find(a => a.productId === productId && a.provider === 'stripe')!.id;
    app.db.insert(studioCampaigns).values({ id: item.campaign, productId, brief: { title: 'Sandbox attribution check', channel: 'content', objective: 'Validate checkout attribution', audience: 'Synthetic buyer', offer: 'Test purchase', formats: ['article'] }, trackedUrl: 'https://example.invalid/?utm_source=signal&utm_campaign=' + item.campaign, createdAt: state.since }).run();
    app.db.insert(studioLeads).values({ id: business + '-fixture', productId, value: { name: 'Synthetic buyer', contact: 'signal-integration@example.invalid', stage: 'trial', permission: 'do-not-contact', source: 'Isolated sandbox', notes: '', campaignId: item.campaign, followUpAt: null }, createdAt: state.since }).run();
    service.configure(productId, { accountId, stripeProductIds: [item.product], since: state.since, live: false });
    for (let page = 0; page < 20; page++) {
      await service.sync(productId);
      if (service.states().find(s => s.productId === productId)!.status !== 'partial') break;
    }
    assert.equal(service.states().find(s => s.productId === productId)!.status, 'current', business + ' revenue scan');
    const payments = service.payments(productId);
    assert.equal(payments.length, 1, 'Exactly this business payment should be included');
    const payment = payments[0]!;
    assert.equal(payment.captured, item.expectedAmount);
    assert.equal(payment.refunded, item.expectedRefunded ?? 0);
    assert.equal(payment.campaignId, item.campaign);
    assert.equal(payment.attribution, 'matched');
    assert.equal(payment.live, false);
    assert.equal(payment.contactMatch, 'available');
    assert.equal(app.db.select().from(studioLeads).where(eq(studioLeads.id, business + '-fixture')).get()!.value.stage, 'trial', 'Sandbox payment must not turn a lead into a real customer');
    await service.sync(productId);
    assert.equal(service.payments(productId).length, 1, 'Re-sync must not double count');
    assert.equal(service.totals(productId)[0]!.captured, item.expectedAmount);
    service.configure(productId, { accountId, stripeProductIds: [item.product], since: state.since, live: true });
    await service.sync(productId);
    assert.equal(service.states().find(s => s.productId === productId)!.status, 'attention', 'A test key cannot validate live revenue');
    assert.equal(service.payments(productId).length, 0);
    results.push({ business, stripeSession: item.sessionId, paymentId: payment.id, campaignId: item.campaign, captured: payment.captured, refunded: payment.refunded, currency: payment.currency, live: false, attribution: payment.attribution, exactContactAvailable: payment.contactMatch === 'available', reSyncCount: 1, liveModeMismatchRejected: true, leadRemainedTrial: true });
  }
  assert.equal(app.db.select().from(marketingCash).all().length, 0, 'Gross payments must not become spendable cash');
  const report = { checkedAt: new Date().toISOString(), results, stripeRequests: requests.length, requestPaths: [...new Set(requests)], readOnly: true, ownerDatabaseUsed: false, ownerLiveSettingsChanged: false, productionPurchaseVerified: false };
  assert(!JSON.stringify(report).includes(key));
  writeFileSync(root + '/revenue-result.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await service.stop(); app.close(); vault.data.clear(); }
