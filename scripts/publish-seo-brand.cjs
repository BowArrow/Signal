// Publish only the brand-identity and guide-link changes; preserve the live manifest.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib'), { createHash } = require('node:crypto');
const { cloud } = require('../../Lemonade/scripts/growth-cloud.cjs');
const auth = require(path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/auth'));
const base = 'https://firebasehosting.googleapis.com/v1beta1/', site = 'siplemona-de', origin = 'https://siplemona.de';
const output = path.resolve('output/seo');
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
  const response = await fetch(origin + '/'); assert(response.ok); let html = await response.text();
  const source = fs.readFileSync(path.resolve('../Lemonade/site/index.html'), 'utf8');
  for (const pattern of [/<title>[^<]+<\/title>/, /<meta name="description"[^>]+>/, /<meta property="og:title"[^>]+>/, /<p class="lp-hero__detail">[^<]+<\/p>/]) {
    const replacement = source.match(pattern)?.[0]; assert(replacement && pattern.test(html)); html = html.replace(pattern, () => replacement);
  }
  html = html.replace('"alternateName": "siplemona.de"', '"alternateName": ["Lemonade by AIon X", "siplemona.de"]');
  if (!html.includes('href="/writing/compare-client-reports-with-local-ai"')) html = html.replace('<a href="/writing">All posts</a>', '<a href="/writing">All posts</a><a href="/writing/compare-client-reports-with-local-ai">Compare client reports</a><a href="/writing/turn-scattered-notes-into-project-brief">Build a project brief</a>');
  assert(html.includes('Compare client reports')); content.set('/index.html', Buffer.from(html));
  const community = source.match(/<a href="https:\/\/discord\.gg\/[A-Za-z0-9]+">Join our Discord community<\/a>/)?.[0];
  if (community && !html.includes(community)) html = html.replace('<a href="/about">About Lemonade</a>', '<a href="/about">About Lemonade</a>' + community);
  content.set('/index.html', Buffer.from(html));
  const sitemapResponse = await fetch(origin + '/sitemap.xml'); assert(sitemapResponse.ok);
  const sitemap = (await sitemapResponse.text()).replace(/(<loc>https:\/\/siplemona\.de\/<\/loc>\s*<lastmod>)[^<]+/, (_match, prefix) => prefix + '2026-09-27');
  content.set('/sitemap.xml', Buffer.from(sitemap));
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
  await cloud(base + 'sites/' + site + '/releases?versionName=' + encodeURIComponent(created.name), 'POST', { message: 'Lemonade product identity and practical document guides' });
  const report = { checkedAt: new Date().toISOString(), version: created.name, rollbackVersion: version.name, preservedFiles: Object.keys(files).filter(name => !content.has(name)).length, expected: [...content].map(([name, bytes]) => ({ path: name, sha256: digest(bytes) })), published: true };
  fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'lemonade-brand-release.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
