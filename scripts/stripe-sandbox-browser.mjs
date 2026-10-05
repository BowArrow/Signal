/* global fetch, AbortSignal, WebSocket, setTimeout, clearTimeout */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { URL } from 'node:url';
import dotenv from 'dotenv';
const root = resolve(process.argv.includes('--topup') ? 'data/stripe-topup-validation' : 'data/stripe-sandbox-validation');
const state = JSON.parse(readFileSync(join(root, 'state.json'), 'utf8'));
const business = process.argv[2];
assert(['lemonade', 'cinegen'].includes(business));
const item = state.cases[business];
assert(item && !state.cleanedAt);
const key = dotenv.parse(readFileSync('../CineGen/functions/.env')).STRIPE_SECRET_KEY;
assert(/^(sk|rk)_test_/.test(key ?? ''), 'A Stripe test key is required');
const response = await fetch('https://api.stripe.com/v1/checkout/sessions/' + item.sessionId, { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(20000) });
assert(response.ok);
const session = await response.json();
assert.equal(session.livemode, false); assert.match(session.id, /^cs_test_/); assert.equal(session.status, 'open');
assert.equal(new URL(session.url).hostname, 'checkout.stripe.com');
const profile = join(root, 'chrome-' + Date.now());
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(r => setTimeout(r, ms));
let ws;
try {
  const active = join(profile, 'DevToolsActivePort');
  for (let n = 0; n < 100 && !existsSync(active); n++) await pause(100);
  const port = readFileSync(active, 'utf8').split('\n')[0];
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let next = 0;
  const pending = new Map();
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('Timed out: ' + method)); }, 20000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  ws.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.method === 'Fetch.requestPaused') {
      void cdp('Fetch.fulfillRequest', { requestId: data.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from('<h1>Signal test return page</h1>').toString('base64') });
    }
    const item = pending.get(data.id); if (!item) return;
    clearTimeout(item.timer); pending.delete(data.id);
    if (data.error) item.reject(Error(data.error.message)); else item.resolve(data.result);
  });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert(!result.exceptionDetails, 'Checkout page evaluation failed');
    return result.result.value;
  };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Fetch.enable', { patterns: [{ urlPattern: 'https://example.invalid/*' }] });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: session.url });
  for (let n = 0; n < 150; n++) {
    if (await evaluate('Boolean(document.querySelector("#payment-method-accordion-item-title-card") || document.querySelector("input[name=cardNumber]"))')) break;
    await pause(100);
  }
  await pause(1200);
  const card = await evaluate('(() => {const e=document.querySelector("#payment-method-accordion-item-title-card");if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
  if (card) {
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...card, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...card, button: 'left', clickCount: 1 });
  }
  await evaluate('(() => {const e=document.querySelector("#enableStripePass");if(e?.checked)e.click();})()');
  await evaluate('(() => {for(const e of document.querySelectorAll("input[type=checkbox]")) {if([...e.labels??[]].some(l=>l.textContent.includes("I am an AI agent"))&&!e.checked)e.click();}})()');
  await pause(1200);
  const capture = async suffix => {
    const dom = await evaluate('({text:document.body.innerText,fields:[...document.querySelectorAll("input,select,button")].map(e=>({tag:e.tagName,id:e.id,name:e.name,type:e.type,text:e.tagName==="BUTTON"?e.innerText:undefined})),frames:[...document.querySelectorAll("iframe")].map(e=>({title:e.title}))})');
    writeFileSync(join(root, business + '-' + suffix + '.json'), JSON.stringify(dom, null, 2));
    writeFileSync(join(root, business + '-' + suffix + '.png'), Buffer.from((await cdp('Page.captureScreenshot', { captureBeyondViewport: false })).data, 'base64'));
    return dom;
  };
  const before = await capture('checkout');
  console.log(JSON.stringify({ business, fields: before.fields, frames: before.frames, testModeLabel: /test mode|sandbox/i.test(before.text) }));
  if (process.argv.includes('--pay')) {
    assert(/test mode|sandbox/i.test(before.text), 'Verify Stripe test-mode label before payment');
    assert(!/verify you are human|complete the captcha/i.test(before.text), 'Human verification requires owner interaction');
    const setField = async (name, value) => {
      assert(await evaluate(`Boolean(document.querySelector('[name="${name}"]'))`), 'Missing checkout field ' + name);
      await evaluate(`(() => {const e=document.querySelector('[name="${name}"]'); e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.blur();})()`);
    };
    await setField('cardNumber', '4242424242424242');
    await setField('cardExpiry', '12/34');
    await setField('cardCvc', '123');
    await setField('billingName', 'Signal Test Buyer');
    if (await evaluate('Boolean(document.querySelector("input[name=billingPostalCode]"))')) await setField('billingPostalCode', '95113');
    await pause(500);
    await capture('filled');
    assert(await evaluate('Boolean(document.querySelector("button[type=submit]") && !document.querySelector("button[type=submit]").disabled)'), 'Submit must be enabled');
    await evaluate('document.querySelector("button[type=submit]").click()');
    for (let n = 0; n < 200; n++) {
      if (await evaluate('location.hostname === "example.invalid"')) break;
      await pause(150);
    }
    const after = await capture('result');
    console.log(JSON.stringify({ business, returnedToIsolatedPage: await evaluate('location.hostname === "example.invalid"'), visibleResult: after.text.slice(0, 1500) }));
  }
} finally { ws?.close(); chrome.kill(); }
