/* global fetch, AbortSignal */
// Public GET requests only. A 200 SPA fallback is not a deployed script.
import { mkdirSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';

const results = [];
async function read(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok) throw Error('HTTP ' + response.status + ' for ' + url);
  const body = await response.text();
  if (body.length > 10 * 1024 * 1024) throw Error('Asset exceeds check limit');
  return { body, type: response.headers.get('content-type') ?? '' };
}
for (const [business, origin] of [['Lemonade', 'https://siplemona.de'], ['CineGen', 'https://cinegenaimedia.com']]) {
  const missing = [];
  try {
    const html = (await read(origin + '/')).body;
    const referral = await read(origin + '/referral.js');
    if (!/javascript/.test(referral.type) || !referral.body.includes('signal-campaign-v1') || !referral.body.includes('getSignalCampaign')) missing.push('Campaign continuity helper is not deployed in referral.js');
    const prospect = await read(origin + '/prospect-signup.js');
    if (!/javascript/.test(prospect.type) || !prospect.body.includes('continuedSource') || !prospect.body.includes('checkoutCampaign')) missing.push('Email verification does not yet preserve campaign continuity through checkout');
    if (business === 'Lemonade') {
      if (!html.includes('getSignalCampaign()') || !/signalCampaign:\s*(?:signalCampaign|typeof window\.getSignalCampaign)/.test(html)) missing.push('Homepage checkout does not pass the campaign hint');
    } else {
      const campaign = await read(origin + '/campaign-attribution.js');
      if (!/javascript/.test(campaign.type) || !campaign.body.includes('signal-campaign-v1')) missing.push('Campaign script is missing or returns the HTML app fallback');
      if (!html.includes('src="/campaign-attribution.js"')) missing.push('Homepage does not load the campaign script');
      const paths = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)].map(m => m[1]).filter(p => /^\/assets\/[^?#]+\.js(?:\?[^#]*)?$/.test(p));
      let wired = false;
      for (const path of paths.slice(0, 8)) {
        const bundle = await read(new URL(path, origin));
        if (/javascript/.test(bundle.type) && bundle.body.includes('signalCampaignHint') && bundle.body.includes('signalCampaign:')) wired = true;
      }
      if (!wired) missing.push('Main app bundle has not been verified to send signalCampaign at checkout (lazy chunks may require separate inspection)');
    }
    results.push({ business, browserWiringVerified: missing.length === 0, missing });
  } catch (error) { results.push({ business, browserWiringVerified: false, error: error.message }); }
}
const report = { checkedAt: new Date().toISOString(), results, backendMetadataVerified: false, realCheckoutCreated: false, emailSent: false,
  boundary: 'Public source checks only. Function revision inspection and a test-mode checkout-to-Stripe read are still needed; these checks do not prove revenue or campaign causality.' };
mkdirSync('data/campaign-production-validation', { recursive: true });
writeFileSync('data/campaign-production-validation/result.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (results.some(r => !r.browserWiringVerified)) process.exitCode = 1;
