// Publish only Lemonade's funnel files while preserving the live Hosting manifest.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib'), { createHash } = require('node:crypto');
const { cloud } = require('../../Lemonade/scripts/growth-cloud.cjs');
const auth = require(path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/auth'));
const base = 'https://firebasehosting.googleapis.com/v1beta1/', site = 'siplemona-de', origin = 'https://siplemona.de';
const output = path.resolve('output/marketing-audit');
const digest = value => createHash('sha256').update(value).digest('hex');
async function filesFor(name) {
  const files = {}; let pageToken = '';
  do { const page = await cloud(base + name + '/files?pageSize=1000' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '')); for (const file of page.files || []) files[file.path] = file.hash; pageToken = page.nextPageToken || ''; } while (pageToken);
  return files;
}
async function latest() { return (await cloud(base + 'sites/' + site + '/releases?pageSize=1')).releases[0]; }
(async () => {
  const previous = await latest(), version = await cloud(base + previous.version.name), files = await filesFor(version.name);
  const content = new Map();
  for (const name of ['website-analytics.js', 'website-analytics.css', 'prospect-signup.js']) content.set('/' + name, fs.readFileSync(path.resolve('../Lemonade/site', name)));
  for (const pathname of ['/', '/ads/lemonade-ltd/']) {
    const response = await fetch(origin + pathname); assert(response.ok); let html = await response.text();
    if (!html.includes('src="/website-analytics.js"')) html = html.replace('</body>', '<script src="/website-analytics.js" defer></script></body>');
    if (pathname === '/' && !html.includes("signalWebsiteAnalytics?.track('begin_checkout')")) {
      assert.equal(html.split('if (body && body.url) {').length, 2);
      html = html.replace('if (body && body.url) {', "if (body && body.url) {\n            window.signalWebsiteAnalytics?.track('begin_checkout')");
    }
    content.set(pathname + 'index.html', Buffer.from(html));
  }
  const packed = new Map(), updates = {};
  for (const [name, bytes] of content) { const gzip = gzipSync(bytes), hash = digest(gzip); updates[name] = hash; packed.set(hash, gzip); }
  const expected = { ...files, ...updates }, created = await cloud(base + 'sites/' + site + '/versions', 'POST', { config: version.config });
  const population = await cloud(base + created.name + ':populateFiles', 'POST', { files: expected });
  const account = auth.getGlobalDefaultAccount(), token = (await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform'])).access_token;
  for (const hash of population.uploadRequiredHashes || []) {
    assert(packed.has(hash)); const url = new URL(population.uploadUrl); assert.equal(url.hostname, 'upload-firebasehosting.googleapis.com');
    const response = await fetch(url.href + '/' + hash, { method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream' }, body: packed.get(hash), signal: AbortSignal.timeout(60000) }); assert(response.ok);
  }
  assert.deepEqual(await filesFor(created.name), expected);
  await cloud(base + created.name + '?updateMask=status', 'PATCH', { status: 'FINALIZED' });
  assert.equal((await latest()).version.name, version.name, 'Concurrent website publication; refusing to overwrite it.');
  await cloud(base + 'sites/' + site + '/releases?versionName=' + encodeURIComponent(created.name), 'POST', { message: 'Optional website analytics and measured buyer journey' });
  const report = { checkedAt: new Date().toISOString(), version: created.name, rollbackVersion: version.name, preservedFiles: Object.keys(files).filter(name => !content.has(name)).length, expected: [...content].map(([name, bytes]) => ({ path: name, sha256: digest(bytes) })), published: true };
  fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'lemonade-funnel-release.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
