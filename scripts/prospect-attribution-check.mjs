// Browser script regression checks. All HTTP and authentication are fake.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { URL, URLSearchParams } from 'node:url';

async function page(script, origin, search, blockedStorage = false) {
  const elements = new Map(), calls = [], storage = new Map();
  let cleanUrl;
  const node = id => {
    if (!elements.has(id)) elements.set(id, { value: '', checked: false, hidden: true, textContent: '', disabled: false, handlers: {}, addEventListener(event, handler) { this.handlers[event] = handler; } });
    return elements.get(id);
  };
  runInNewContext(script, {
    document: { getElementById: node, createElement: () => ({ dataset: {} }), head: { appendChild() {} } }, window: {}, URL, URLSearchParams,
    location: { origin, pathname: '/get-started', search }, history: { replaceState(_state, _unused, url) { cleanUrl = url; } },
    sessionStorage: {
      getItem(key) { if (blockedStorage) throw Error('Storage disabled'); return storage.get(key); },
      setItem(key, value) { if (blockedStorage) throw Error('Storage disabled'); storage.set(key, value); },
      removeItem(key) { if (blockedStorage) throw Error('Storage disabled'); storage.delete(key); },
    },
    fetch: async (url, init = {}) => {
      const body = init.body && JSON.parse(init.body); calls.push({ url, ...init, body });
      let data;
      if (url === '/__/firebase/init.json') data = { apiKey: 'fake-public-key' };
      else if (url === '/api/prospects/policy') data = { version: 'fixture', text: 'Explicit fixture consent.' };
      else if (url.includes('accounts:sendOobCode')) data = {};
      else if (url.includes('accounts:signInWithEmailLink')) data = { idToken: 'fake-token' };
      else if (url === '/api/prospects/mine') data = { email: 'buyer@example.test' };
      else throw Error('Unexpected URL');
      return { ok: true, json: async () => data };
    },
  });
  node('email').value = 'buyer@example.test';
  await node('verify-form').handlers.submit({ preventDefault() {} });
  return { calls, node, cleanUrl };
}

for (const [name, origin, file] of [
  ['Lemonade', 'https://siplemona.de', '../Lemonade/site/prospect-signup.js'],
  ['CineGen', 'https://cinegenaimedia.com', '../CineGen/public/prospect-signup.js'],
]) {
  const script = readFileSync(file, 'utf8');
  for (const blockedStorage of [false, true]) {
    const first = await page(script, origin, '?utm_source=signal&utm_campaign=video_fixture_123', blockedStorage);
    const sent = first.calls.find(c => c.url.includes('sendOobCode'));
    assert(sent); assert.equal(new URL(sent.body.continueUrl).searchParams.get('utm_campaign'), 'video_fixture_123');
    assert.equal(new URL(sent.body.continueUrl).searchParams.get('utm_source'), 'signal');
    assert(!sent.body.continueUrl.includes('buyer')); assert(!sent.body.continueUrl.includes('token'));
    // A completely new context has no session storage from the landing page.
    const query = new URLSearchParams({ mode: 'signIn', oobCode: 'fake-code', continueUrl: sent.body.continueUrl });
    const second = await page(script, origin, '?' + query, blockedStorage);
    const cleaned = new URL(second.cleanUrl, origin);
    assert.equal(cleaned.searchParams.get('utm_source'), 'signal');
    assert.equal(cleaned.searchParams.get('utm_campaign'), 'video_fixture_123');
    assert.equal(cleaned.searchParams.size, 2, 'Remove authentication codes and continuation URL');
    assert.equal(second.node('preference-step').hidden, false);
    assert.equal(second.node('consent').checked, false);
    assert(!second.calls.some(c => c.method === 'PUT'));
    second.node('consent').checked = true;
    second.node('preference-form').handlers.submit({ preventDefault() {} });
    await Promise.resolve();
    assert.equal(second.calls.find(c => c.method === 'PUT').body.campaign, 'video_fixture_123');
  }
  for (const query of ['?utm_source=signal', '?utm_source=other&utm_campaign=campaign_123', '?utm_source=signal&utm_campaign=campaign_123&utm_campaign=another_123', '?' + new URLSearchParams({ mode: 'signIn', oobCode: 'fake-code', continueUrl: origin + '/get-started?utm_source=signal&utm_campaign=campaign_123&utm_campaign=another_123' })]) {
    const opened = await page(script, origin, query);
    assert.equal(new URL(opened.cleanUrl, origin).search, '', 'Invalid/ambiguous tags must not become checkout hints');
  }
  for (const continuation of ['https://unrelated.example/get-started?utm_campaign=bad_campaign', origin + '/other?utm_campaign=bad_campaign', origin + '/get-started?utm_campaign=' + 'x'.repeat(129)]) {
    const opened = await page(script, origin, '?' + new URLSearchParams({ mode: 'signIn', oobCode: 'fake-code', continueUrl: continuation }));
    opened.node('consent').checked = true; opened.node('preference-form').handlers.submit({ preventDefault() {} }); await Promise.resolve();
    assert.equal(opened.calls.find(c => c.method === 'PUT').body.campaign, '');
  }
  console.log(JSON.stringify({ business: name, newBrowserAttribution: true, storageDisabled: true, untrustedContinuationRejected: true, explicitConsentRequired: true, realEmailSent: false }));
}
