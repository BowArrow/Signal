/* global fetch, WebSocket, setTimeout, clearTimeout */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const folder = resolve('data/connections-validation'); mkdirSync(folder, { recursive: true });
const profile = join(folder, `profile-${Date.now()}`); mkdirSync(profile);
const database = join(profile, 'fixture.db');
const env = { ...process.env, SIGNAL_DATABASE_URL: database, SIGNAL_OFFLINE: '1', SIGNAL_PROFILE_DIR: profile, SIGNAL_UI_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(process.argv[2] ?? require('electron'), [...(process.argv[2] ? [] : ['.']), '--disable-gpu', '--remote-debugging-port=9338'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', value => { logs += value; }); child.stderr.on('data', value => { logs += value; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)); let socket; let seq = 0; const pending = new Map(); const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; }
async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`Condition failed: ${expression}`); }
async function click(text) { if (!await evaluate(`(() => {const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});el?.click();return !!el;})()`)) throw new Error(`Button missing: ${text}`); await pause(250); }
async function fill(label, value) { await evaluate(`(() => {const e=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`); await pause(100); }
async function screenshot(name) { const result = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(folder, `${name}.png`), Buffer.from(result.data, 'base64')); }
try {
  let target;
  for (let i = 0; i < 100; i++) { try { target = (await fetch('http://127.0.0.1:9338/json').then(r => r.json())).find(t => t.type === 'page'); if (target) break; } catch { /* starting */ } await pause(200); }
  if (!target) throw new Error(logs);
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.method === 'Runtime.exceptionThrown') errors.push(value.params); const wait = pending.get(value.id); if (wait) { clearTimeout(wait.timer); pending.delete(value.id); if (value.error) wait.reject(value.error); else wait.resolve(value.result); } });
  await send('Runtime.enable'); await send('Page.enable'); await until('Boolean(window.signal && document.querySelector(".sidebar"))');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await click('Connections'); await until('document.querySelectorAll(".connection-catalog article").length===28');
  if (!await evaluate(`(() => { const e=document.querySelector('[aria-label="Connections business"]');const rect=e.getBoundingClientRect();return rect.width>0 && rect.right<=innerWidth && rect.top>=0; })()`)) throw Error('Business selector is not visible');
  if (await evaluate('document.querySelectorAll(".connection-checklist-item").length') !== 9) throw new Error('Account categories missing');
  await screenshot('connections-desktop');
  await evaluate('document.querySelector(".connection-checklist-item").click()');
  await until('document.querySelectorAll(".connection-catalog article").length===2');
  if (!await evaluate('[...document.querySelectorAll(".connection-catalog article")].every(card=>card.textContent.includes("Automatic inbox monitoring and replies available")) && document.querySelector(".connection-catalog").textContent.includes("Outlook requires Mail.ReadWrite and Mail.Send.")')) throw new Error('Inbox workflow boundary missing');
  await click('Show all providers');
  await evaluate(`(() => {const card=[...document.querySelectorAll('.connection-catalog article')].find(e=>e.querySelector('h3')?.textContent==='Gmail / Google Workspace');const buttons=[...card.querySelectorAll('button')];(buttons.find(b=>b.textContent==='Connection options')??buttons.find(b=>b.textContent==='Connect Gmail / Google Workspace')).click();})()`);
  await until('Boolean(document.querySelector("#connection-setup"))');
  await evaluate('document.querySelector("#connection-setup").scrollIntoView({block:"start",behavior:"instant"})');
  if (await evaluate('Boolean(document.querySelector("[aria-label=\\"OAuth client ID\\"]"))')) throw new Error('Developer fields shown in normal connection flow');
  await screenshot('google-simple-setup');
  await click('Advanced setup'); await fill('OAuth client ID', 'fixture-desktop-client'); await click('Save developer app'); await until('window.signal.connections().then(v=>v.oauthConfigured.includes("gmail"))'); await screenshot('oauth-setup'); await click('Close setup');
  await click('Connect Resend'); await fill('Connection label', 'Lemonade sales email'); await fill('Account credential', 'signal-connection-fixture-secret'); await click('Save and check connection');
  await until('document.querySelectorAll(".connection-account").length===1');
  const state = await evaluate('window.signal.connections().then(v=>({accounts:v.accounts,secureStorage:v.secureStorage}))');
  if (!state.secureStorage || state.accounts[0].status !== 'saved' || JSON.stringify(state).includes('signal-connection-fixture-secret')) throw new Error('Secret or offline status boundary failed');
  if (!await evaluate('[...document.querySelectorAll(".connection-checklist-item")].find(e=>e.textContent.includes("Email delivery")).textContent.includes("1 linked, needs checking")')) throw new Error('Saved account incorrectly treated as verified');
  const files = readdirSync(join(profile, 'account-credentials')); if (files.length !== 2) throw new Error('Expected encrypted OAuth config and account token');
  for (const file of files) if (readFileSync(join(profile, 'account-credentials', file)).includes(Buffer.from('signal-connection-fixture-secret'))) throw new Error('Plaintext credential on disk');
  if (readFileSync(database).includes(Buffer.from('signal-connection-fixture-secret'))) throw new Error('Credential leaked into database');
  await evaluate('location.reload()'); await until('document.querySelectorAll(".connection-account").length===1'); await screenshot('connected-account');
  await click('Rename'); await fill('Account name', 'AIonX sales email'); await click('Save account name');
  await until('document.querySelector(".connection-account h3")?.textContent === "AIonX sales email"');
  await evaluate(`(() => {const e=document.querySelector('[aria-label="Connections business"]');e.value=[...e.options].find(o=>o.text==='CineGen').value;e.dispatchEvent(new Event('change',{bubbles:true}));})()`); await until('document.querySelectorAll(".connection-account").length===0');
  if (!await evaluate('[...document.querySelectorAll(".connection-checklist-item")].every(e=>e.textContent.includes("No linked account"))')) throw new Error('Checklist crossed business boundary');
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 800, deviceScaleFactor: 1, mobile: false }); await screenshot('connections-small');
  if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Horizontal overflow');
  await evaluate(`(() => {const card=[...document.querySelectorAll('.connection-catalog article')].find(e=>e.querySelector('h3')?.textContent==='Gmail / Google Workspace');[...card.querySelectorAll('button')].find(b=>b.textContent==='Connection options').click();})()`);
  await until('Boolean(document.querySelector("#connection-setup"))');
  await evaluate('document.querySelector("#connection-setup").scrollIntoView({block:"start",behavior:"instant"})');
  await screenshot('google-simple-small'); if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Google setup overflow'); await click('Close setup');
  await click('Connect WordPress'); await screenshot('wordpress-small'); if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Setup overflow'); await click('Close setup');
  await click('Connect Stripe'); await until('document.querySelector("#connection-setup")?.textContent.includes("Create a read-only Stripe key")');
  await screenshot('stripe-readonly-small'); if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Stripe setup overflow'); await click('Close setup');
  await evaluate(`(() => {const e=document.querySelector('[aria-label="Connections business"]');e.value=[...e.options].find(o=>o.text==='Lemonade').value;e.dispatchEvent(new Event('change',{bubbles:true}));})()`); await until('document.querySelectorAll(".connection-account").length===1');
  await click('Disconnect'); await click('Remove connection'); await until('document.querySelectorAll(".connection-account").length===0');
  if (readdirSync(join(profile, 'account-credentials')).length !== 1 || errors.length) throw new Error('Disconnect or renderer validation failed');
  // Synthetic shared accounts exercise both business views without provider calls.
  const Database = require('better-sqlite3');
  const db = new Database(database, { nativeBinding: resolve('native/better_sqlite3-node.node') });
  try {
    const businesses = db.prepare('SELECT id, key FROM products').all();
    for (const product of businesses.filter(p => ['lemonade', 'cinegen'].includes(p.key))) {
      const id = 'shared-fixture-' + product.key;
      const account = { id, credentialId: 'shared-fixture', productId: product.id, provider: 'x', label: 'AIonX X', identity: 'AIonX', site: '', username: '', status: 'verified', detail: 'Synthetic UI fixture', checkedAt: Date.now(), expiresAt: null, refreshable: true, grantedScopes: ['tweet.read'], createdAt: Date.now() };
      db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run('connections.account.' + id, JSON.stringify(account), Date.now());
    }
  } finally { db.close(); }
  await evaluate('location.reload()'); await until('document.querySelector(".connection-account h3")?.textContent === "AIonX X"');
  if (!await evaluate('document.querySelector(".connection-management").textContent.includes("Shared account for Lemonade and CineGen")')) throw new Error('Shared business explanation missing');
  if (!await evaluate('[...document.querySelectorAll("button")].some(b=>b.textContent==="Authorize X posting")')) throw new Error('X permission upgrade missing');
  if (await evaluate('[...document.querySelectorAll("button")].some(b=>b.textContent==="Use for CineGen")')) throw new Error('Duplicate sharing offered');
  await evaluate('document.querySelector(".connection-account").scrollIntoView({block:"start",behavior:"instant"})');
  await screenshot('shared-account-small'); if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Shared account overflow');
  await click('Rename'); await fill('Account name', 'AIonX shared X'); await screenshot('rename-small'); await click('Save account name');
  await until('document.querySelector(".connection-account h3")?.textContent === "AIonX shared X"');
  await evaluate(`(() => {const e=document.querySelector('[aria-label="Connections business"]');e.value=[...e.options].find(o=>o.text==='CineGen').value;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until('document.querySelector(".connection-account h3")?.textContent === "AIonX shared X"');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await screenshot('shared-account-desktop');
  if (errors.length) throw new Error('Shared account renderer errors');
  console.log(JSON.stringify({ ok: true, providers: 28, accountCategories: 9, checklistIsolation: true, workflowBoundaries: true, encryptedCredentialFiles: true, businessIsolation: true, reload: true, disconnected: true, viewports: ['1440x900', '720x800'], rendererErrors: errors.length }));
} finally { socket?.close(); child.kill(); writeFileSync(join(folder, 'ui.log'), logs); }
