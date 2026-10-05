/* global fetch, AbortSignal, structuredClone */
// Manual integration check. Test keys only; never opens the owner Signal DB.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { URLSearchParams } from 'node:url';
import vm from 'node:vm';
import dotenv from 'dotenv';

const require = createRequire(import.meta.url);
const topup = process.argv.includes('--topup');
const root = resolve(topup ? 'data/stripe-topup-validation' : 'data/stripe-sandbox-validation');
mkdirSync(root, { recursive: true });
const file = join(root, 'state.json');
const env = dotenv.parse(readFileSync(resolve('../CineGen/functions/.env')));
const key = env.STRIPE_SECRET_KEY;
assert(/^(sk|rk)_test_/.test(key ?? ''), 'A Stripe test key is required');
const mode = process.argv[2];
assert(['--prepare', '--status', '--refund', '--cleanup'].includes(mode), 'Choose --prepare, --status, --refund or --cleanup');
const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { run: 'signal_' + Date.now(), since: Date.now(), cases: {} };
const save = () => writeFileSync(file, JSON.stringify(state, null, 2));
function form(value, prefix = '', result = new URLSearchParams()) {
  for (const [name, item] of Object.entries(value)) {
    if (item === undefined || item === null) continue;
    const path = prefix ? `${prefix}[${name}]` : name;
    if (typeof item === 'object') form(item, path, result); else result.append(path, String(item));
  }
  return result;
}
async function request(path, method = 'GET', body, operation) {
  assert(path.startsWith('/v1/'));
  const response = await fetch('https://api.stripe.com' + path, {
    method, redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { Authorization: 'Bearer ' + key, 'Stripe-Version': '2026-06-24.dahlia',
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(operation ? { 'Idempotency-Key': state.run + '-' + operation } : {}) },
    ...(body ? { body: form(body) } : {}),
  });
  const value = await response.json();
  assert(response.ok, `Stripe sandbox ${method} ${path.split('?')[0]} failed: ${response.status} ${value.error?.code ?? value.error?.type ?? ''}`);
  if ('livemode' in value) assert.equal(value.livemode, false);
  return value;
}
assert.equal((await request('/v1/balance')).livemode, false);

if (mode === '--prepare') {
  assert(!state.cleanedAt, 'This sandbox run has already been cleaned up');
  // The existing test endpoint is attached to the deployed live billing service.
  // Verify that service still uses its separate live signing secret before
  // creating test objects. Never disable or reconfigure an existing webhook.
  const { cloud } = require('../../Lemonade/scripts/growth-cloud.cjs');
  const deployed = await cloud('https://cloudfunctions.googleapis.com/v1/projects/cinegen-12360/locations/us-central1/functions/stripeWebhook');
  assert.equal(deployed.status, 'ACTIVE');
  assert.equal(deployed.environmentVariables?.STRIPE_MODE, 'live');
  assert(deployed.secretEnvironmentVariables?.some(s => s.key === 'STRIPE_LIVE_WEBHOOK_SECRET'));
  const hooks = await request('/v1/webhook_endpoints?limit=100');
  assert.equal(hooks.has_more, false);
  for (const hook of hooks.data.filter(h => h.status === 'enabled')) {
    assert.equal(hook.livemode, false);
    assert.equal(hook.url, 'https://us-central1-cinegen-12360.cloudfunctions.net/stripeWebhook', 'Review any new sandbox webhook before generating events');
  }
  state.preflight = { at: new Date().toISOString(), testKeyVerified: true, deployedWebhookMode: 'live', webhookConfigurationChanged: false };
  save();
  if (!topup && !state.lemonadePrice) {
    const product = await request('/v1/products', 'POST', { name: 'Signal integration check - Lemonade (TEST ONLY)', metadata: { signal_test_run: state.run } }, 'product');
    state.lemonadeProduct = product.id; save();
    const price = await request('/v1/prices', 'POST', { product: product.id, currency: 'usd', unit_amount: 4900 }, 'price');
    state.lemonadePrice = price.id; save();
  }
  const cinegenPrice = await request('/v1/prices/' + env.STRIPE_PRICE_CREATOR);
  assert.equal(cinegenPrice.type, 'recurring');
  if (!state.customer) {
    const customer = await request('/v1/customers', 'POST', { name: 'Signal isolated test buyer', email: 'signal-integration@example.invalid', metadata: { signal_test_run: state.run } }, 'customer');
    state.customer = customer.id; save();
  }
  for (const business of topup ? ['cinegen'] : ['lemonade', 'cinegen']) {
    if (state.cases[business]) continue;
    const campaign = state.run + '_' + business;
    let captured;
    const stripe = () => ({ checkout: { sessions: { create: async parameters => {
      // Execute the actual checkout handler, with only billing/auth/storage
      // dependencies isolated. Keep the request contract for later review.
      captured = structuredClone(parameters);
      const session = await request('/v1/checkout/sessions', 'POST', parameters, 'checkout-' + business);
      assert.match(session.id, /^cs_test_/);
      state.cases[business] = { campaign, sessionId: session.id, product: business === 'lemonade' ? state.lemonadeProduct : topup ? 'cinegen_custom_topup' : cinegenPrice.product, expectedAmount: session.amount_total, sourceHash: '', status: session.status };
      save();
      return { id: session.id, url: 'https://example.invalid/test-checkout' };
    } } } });
    const location = resolve(business === 'lemonade' ? '../Lemonade/functions/checkout.js' : '../CineGen/functions/billing.js');
    const source = readFileSync(location, 'utf8');
    const campaignMetadata = require(resolve('../' + (business === 'lemonade' ? 'Lemonade' : 'CineGen') + '/functions/growth/campaign.js')).campaignMetadata;
    const dependencies = {
      stripe, console: { error() {}, log() {} },
      require: name => {
        if (name === './growth') return { attribution: async () => ({}) };
        if (name === './growth/campaign') return { campaignMetadata };
        throw Error('Unexpected checkout dependency');
      },
    };
    if (business === 'lemonade') {
      const start = source.indexOf('const createCheckout = onRequest(OPTIONS, ');
      const end = source.indexOf('\n});', start);
      assert(start >= 0 && end > start);
      const handler = vm.runInNewContext(source.slice(start, end + 4) + '; createCheckout;', {
        ...dependencies, OPTIONS: {}, onRequest: (_, handler) => handler, siteOrigin: () => 'https://example.invalid',
        priceId: () => state.lemonadePrice, stripeMode: () => 'test', supportEmail: () => 'support@example.invalid',
      });
      const res = { status(code) { assert.equal(code, 200); return this; }, json(value) { assert.match(value.id, /^cs_test_/); } };
      await handler({ method: 'POST', headers: {}, body: { signalCampaign: campaign, email: 'signal-integration@example.invalid' } }, res);
    } else {
      const start = source.indexOf('const createCheckoutSession = onCallV2(');
      const end = source.indexOf('\nconst createPortalSession', start);
      assert(start >= 0 && end > start);
      const billingConfig = require('../../CineGen/functions/billingConfig.js');
      const handler = vm.runInNewContext(source.slice(start, end) + '; createCheckoutSession;', {
        ...dependencies, ...billingConfig, onCallV2: handler => handler, HttpsError: Error,
        resolveOrigin: () => 'https://example.invalid', resolvePriceId: async () => cinegenPrice.id,
        ensureUserDoc: async () => ({}), activeComplimentaryMembership: () => false,
        getOrCreateCustomer: async () => state.customer, userRef: () => ({ get: async () => ({ data: () => ({}) }) }),
        currentBillingId: () => null, activeSubscriptionSale: async () => null, effectivePlan: () => 'creator',
      });
      await handler({ itemKey: topup ? 'custom_topup' : 'creator', ...(topup ? { amountUsd: 7 } : {}), signalCampaign: campaign }, { auth: { uid: state.run, token: { email: 'signal-integration@example.invalid' } } });
    }
    assert.equal(captured.metadata.signal_campaign, campaign);
    assert.equal((captured.payment_intent_data ?? captured.subscription_data).metadata.signal_campaign, campaign);
    state.cases[business].sourceHash = createHash('sha256').update(source).digest('hex');
    state.cases[business].request = captured;
    save();
  }
}
for (const [business, item] of Object.entries(state.cases)) {
  const session = await request('/v1/checkout/sessions/' + item.sessionId);
  assert.equal(session.metadata.signal_campaign, item.campaign);
  Object.assign(item, { status: session.status, paymentStatus: session.payment_status, paymentIntent: session.payment_intent, subscription: session.subscription, invoice: session.invoice, customer: session.customer });
  if (mode === '--refund' && business === 'lemonade' && !item.refundId) {
    assert.equal(session.payment_status, 'paid');
    assert.equal(session.mode, 'payment');
    assert.equal(session.amount_total, 4900);
    const payment = await request('/v1/payment_intents/' + session.payment_intent);
    assert.equal(payment.metadata.signal_campaign, item.campaign);
    const refund = await request('/v1/refunds', 'POST', { payment_intent: payment.id, amount: 1000, metadata: { signal_test_run: state.run } }, 'partial-refund');
    assert.equal(refund.status, 'succeeded');
    Object.assign(item, { refundId: refund.id, expectedRefunded: 1000 }); save();
  }
  if (mode === '--cleanup') {
    if (session.status === 'open') await request('/v1/checkout/sessions/' + item.sessionId + '/expire', 'POST', {}, 'expire-' + business);
    if (session.subscription) {
      const sub = await request('/v1/subscriptions/' + session.subscription);
      assert.equal(sub.metadata.signal_campaign, item.campaign);
      if (sub.status !== 'canceled') await request('/v1/subscriptions/' + sub.id, 'DELETE');
      assert.equal((await request('/v1/subscriptions/' + sub.id)).status, 'canceled');
      item.subscriptionCanceled = true;
    }
  }
}
if (mode === '--cleanup' && state.lemonadeProduct) {
  await request('/v1/prices/' + state.lemonadePrice, 'POST', { active: false }, 'archive-price');
  await request('/v1/products/' + state.lemonadeProduct, 'POST', { active: false }, 'archive-product');
  state.cleanedAt = new Date().toISOString();
}
save();
console.log(JSON.stringify({ mode, run: state.run, cases: Object.fromEntries(Object.entries(state.cases).map(([name, item]) => [name, { id: item.sessionId, status: item.status, paymentStatus: item.paymentStatus }])), livePaymentsCreated: false }));
