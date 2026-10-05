/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process, console, URL */
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const live = process.env.SIGNAL_WEBSITE_TEST_LIVE === '1';
const root = path.resolve('../Lemonade/site'), output = path.resolve('data/website-funnel-validation' + (live ? '-live' : ''));
if (!process.env.SIGNAL_WEBSITE_TEST_PROFILE) throw Error('Use the launcher');
app.disableHardwareAcceleration(); app.setPath('userData', process.env.SIGNAL_WEBSITE_TEST_PROFILE);
let server, win;
app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true });
  server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname;
    const target = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.svg') ? 'image/svg+xml' : target.endsWith('.html') ? 'text/html' : 'application/octet-stream'); res.end(fs.readFileSync(target));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = live ? 'https://siplemona.de' : 'http://127.0.0.1:' + server.address().port;
  win = new BrowserWindow({ show: false, width: 1100, height: 820, webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true, sandbox: true } });
  const google = [];
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    if (details.url.startsWith('https://www.googletagmanager.com/')) google.push(details.url);
    callback({ cancel: new URL(details.url).origin !== origin || !['GET', 'HEAD'].includes(details.method) });
  });
  await win.loadURL(origin + '/?utm_source=signal&utm_campaign=lemonade-test-20260925&email=must-not-leak@example.test&oobCode=SECRET');
  const evaluate = async code => { try { return await win.webContents.executeJavaScript(code); } catch (error) { throw Error(code + ': ' + error.message); } };
  assert.equal(await evaluate('Boolean(window.signalWebsiteAnalytics)'), true);
  assert.equal(google.length, 0);
  assert.equal(await evaluate('window.signalWebsiteAnalytics.track("begin_checkout")'), false);
  fs.writeFileSync(path.join(output, 'consent-desktop.png'), (await win.webContents.capturePage()).toPNG());
  win.setSize(390, 844);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
  fs.writeFileSync(path.join(output, 'consent-mobile.png'), (await win.webContents.capturePage()).toPNG());
  await evaluate('document.querySelector("[data-choice=denied]").click()');
  assert.equal(google.length, 0);
  await evaluate('document.querySelector(".website-analytics-preferences").click();document.querySelector("[data-choice=granted]").click()');
  await evaluate('document.addEventListener("click",e=>e.preventDefault());window.signalWebsiteAnalytics.track("begin_checkout");document.querySelector("a[href*=Lemonade-Setup]").dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true}));');
  const commands = await evaluate('window.dataLayer.map(v=>Array.from(v))');
  assert.equal(commands.filter(command => command[0] === 'event' && command[1] === 'page_view').length, 1);
  assert(commands.some(command => command[1] === 'download_requested'));
  assert(!JSON.stringify(commands).includes('must-not-leak'));
  assert(!JSON.stringify(commands).includes('SECRET'));
  assert(commands.some(command => command[1] === 'page_view' && command[2].campaign_name === 'lemonade-test-20260925'));
  await evaluate('document.querySelector(".website-analytics-preferences").click();document.querySelector("[data-choice=denied]").click()');
  assert.equal(await evaluate('window.signalWebsiteAnalytics.track("begin_checkout")'), false);
  await evaluate('document.querySelector(".website-analytics-preferences").click();document.querySelector("[data-choice=granted]").click()');
  assert.equal(await evaluate('window["ga-disable-G-0B685NXWZW"]'), false);
  assert.equal(await evaluate('window.signalWebsiteAnalytics.track("begin_checkout")'), true);
  assert.equal(await evaluate('window.signalWebsiteAnalytics.track("purchase")'), false);
  const report = { checkedAt: new Date().toISOString(), origin, productionFiles: live, beforeConsentRequests: 0, consentWithdrawalAndRegrant: true, querySecretsExcluded: true, campaignPreserved: true, pageViewOncePerDocument: true, realGoogleRequestsBlocked: true, realCheckoutCreated: false };
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}).catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => { win?.destroy(); server?.close(); app.exit(process.exitCode || 0); });
