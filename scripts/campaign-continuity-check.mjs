// Execute the actual website scripts. No network, user profiles or payments.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { URLSearchParams } from 'node:url';

const helper = readFileSync('../CineGen/public/campaign-attribution.js', 'utf8');
const ttl = 30 * 60 * 1000;
let now = 1800000000000;
const tagged = id => '?utm_source=signal&utm_campaign=' + id;
const key = 'signal-campaign-v1';
function page(source, search, values = new Map(), blocked = false) {
  const location = { search };
  const storage = {
    getItem(k) { if (blocked) throw Error('Storage unavailable'); return values.get(k) ?? null; },
    setItem(k, v) { if (blocked) throw Error('Storage unavailable'); values.set(k, v); },
    removeItem(k) { if (blocked) throw Error('Storage unavailable'); values.delete(k); },
  };
  const window = { location, sessionStorage: storage };
  const context = { window, location, URLSearchParams, Date: { now: () => now }, fetch: () => { throw Error('Unexpected network request'); } };
  runInNewContext(source, context);
  return { window, values, context };
}

for (const file of ['../CineGen/public/campaign-attribution.js', '../CineGen/public/referral.js', '../Lemonade/site/referral.js']) {
  const source = readFileSync(file, 'utf8');
  assert(source.startsWith(helper), 'Embedded campaign implementations must match');
  const first = page(source, tagged('campaign_first'));
  assert.equal(first.window.signalCampaignHint, 'campaign_first');
  assert.deepEqual(Object.keys(JSON.parse(first.values.get(key))).sort(), ['expiresAt', 'id']);
  first.window.location.search = '';
  assert.equal(first.window.signalCampaignHint, 'campaign_first', 'SPA navigation');
  const reloaded = page(source, '', first.values);
  assert.equal(reloaded.window.signalCampaignHint, 'campaign_first', 'Full navigation or login return');
  assert.equal(page(source, '').window.signalCampaignHint, '', 'Separate browser context');
  runInNewContext(helper, reloaded.context);
  assert.equal(reloaded.window.signalCampaignHint, 'campaign_first', 'Duplicate script is harmless');
  const expiry = JSON.parse(first.values.get(key)).expiresAt;
  now += 1000;
  assert.equal(page(source, '', first.values).window.signalCampaignHint, 'campaign_first');
  assert.equal(JSON.parse(first.values.get(key)).expiresAt, expiry, 'Plain reload never extends attribution');
  reloaded.window.location.search = tagged('campaign_new');
  assert.equal(reloaded.window.signalCampaignHint, 'campaign_new', 'New SPA campaign supersedes original');
  now += ttl;
  assert.equal(reloaded.window.signalCampaignHint, '', 'A checkout in a long-lived SPA must expire too');
  assert(!first.values.has(key));
  for (const bad of ['?utm_source=other&utm_campaign=another_campaign', '?utm_campaign=campaign_only', '?utm_source=signal&utm_campaign=bad%40email.test', tagged('campaign_good') + '&utm_campaign=campaign_second', tagged('campaign_good') + '&utm_source=other']) {
    const initial = page(source, tagged('campaign_first'));
    assert.equal(page(source, bad, initial.values).window.signalCampaignHint, '', 'Do not reuse an older campaign for an explicit new source');
    assert.equal(page(source, '', initial.values).window.signalCampaignHint, '');
  }
  for (const stale of ['not-json', '{}', JSON.stringify({ id: 'campaign_first', expiresAt: now - 1 }), JSON.stringify({ id: 'campaign_first', expiresAt: now + ttl + 100 })]) {
    assert.equal(page(source, '', new Map([[key, stale]])).window.signalCampaignHint, '');
  }
  assert.equal(page(source, tagged('campaign_first'), new Map(), true).window.signalCampaignHint, 'campaign_first');
  assert.equal(page(source, '', new Map(), true).window.signalCampaignHint, '');
  console.log(JSON.stringify({ file, reload: true, spaNavigation: true, expiry: true, replacement: true, blockedStorage: true, networkRequests: 0 }));
}

// Invoke Lemonade's actual buy handler after a full navigation and confirm the
// value reaches its checkout request, rather than only testing the helper.
const html = readFileSync('../Lemonade/site/index.html', 'utf8');
const checkout = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes("fetch('/api/checkout'"));
assert(checkout);
const first = page(helper, tagged('campaign_purchase'));
const current = page(helper, '', first.values);
let buy, request;
runInNewContext(checkout, {
  ...current.context, localStorage: { getItem: () => '' },
  document: { getElementById: () => null, querySelectorAll: () => [{ addEventListener: (_event, fn) => { buy = fn; }, textContent: 'Buy' }] },
  fetch: async (url, init) => { request = { url, body: JSON.parse(init.body) }; return { json: async () => ({ url: 'https://checkout.stripe.com/fixture' }) }; },
});
await buy();
assert.equal(request.url, '/api/checkout');
assert.equal(request.body.signalCampaign, 'campaign_purchase');
console.log(JSON.stringify({ lemonadeCheckoutAfterNavigation: true, realPaymentsCreated: false }));
