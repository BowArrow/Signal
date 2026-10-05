import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync('../CineGen/src/lib/telemetry.js', 'utf8').replace("import { app } from '../../firebase';", 'const app = {};').replaceAll('export ', '').replaceAll('import.meta.env', '({})').replace("await import('firebase/analytics')", 'await window.__sdk()') + '\nglobalThis.test={trackEvent,trackPageView};';
function setup(pending = false) {
  let consent = 'granted', release;
  const calls = [];
  const sdk = { isSupported: async () => true, initializeAnalytics: (_app, options) => { calls.push(options); return {}; }, setAnalyticsCollectionEnabled() {}, logEvent: (_analytics, name, params) => calls.push({ name, params }) };
  const ctx = { console, window: { location: { origin: 'https://cinegenaimedia.com', pathname: '/editor/private-project-id', search: '?email=private@example.test' }, localStorage: { getItem: () => consent }, getSignalCampaign: () => 'cinegen-test-20260925', __sdk: () => pending ? new Promise(resolve => { release = () => resolve(sdk); }) : Promise.resolve(sdk) } };
  runInNewContext(source, ctx);
  return { test: ctx.test, calls, deny: () => { consent = 'denied'; }, release: () => release() };
}
const first = setup(); assert(await first.test.trackPageView());
assert.equal(first.calls[1].params.page_location, 'https://cinegenaimedia.com/editor/:id');
assert.equal(first.calls[1].params.campaign_name, 'cinegen-test-20260925');
assert(!JSON.stringify(first.calls).includes('private-project-id'));
assert(!JSON.stringify(first.calls).includes('private@example.test'));
first.deny(); assert.equal(await first.test.trackEvent('sign_up'), false);
const race = setup(true); const pending = race.test.trackEvent('begin_checkout'); race.deny(); race.release(); assert.equal(await pending, false); assert.equal(race.calls.length, 0);
console.log('CineGen telemetry checks passed: sanitized routes, campaign continuity, denied consent and in-flight withdrawal.');
