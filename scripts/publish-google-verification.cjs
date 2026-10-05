// Publishes only Google verification files to the two owner-authorized websites.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib'), { createHash } = require('node:crypto');
const { cloud } = require('../../Lemonade/scripts/growth-cloud.cjs');
const auth = require(path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/auth'));
const base = 'https://firebasehosting.googleapis.com/v1beta1/';
const sites = { 'https://siplemona.de/': { id: 'siplemona-de', directory: '../Lemonade/site' }, 'https://cinegenaimedia.com/': { id: 'cinegen-12360', directory: '../CineGen/public' } };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function filesFor(name) {
  const files = {}; let pageToken = '';
  do { const page = await cloud(base + name + '/files?pageSize=1000' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '')); for (const file of page.files || []) files[file.path] = file.hash; pageToken = page.nextPageToken || ''; } while (pageToken);
  return files;
}
(async () => {
  const entries = JSON.parse(fs.readFileSync('output/seo/google-verification-files.json', 'utf8'));
  assert(Array.isArray(entries) && entries.length > 0 && entries.length <= 2);
  for (const entry of entries) {
    const site = sites[entry.site]; assert(site && /^google[a-f0-9]+\.html$/.test(entry.filename));
    const body = Buffer.from('google-site-verification: ' + entry.filename);
    const filename = '/' + entry.filename, packed = gzipSync(body), digest = hash(packed);
    const latest = async () => (await cloud(base + 'sites/' + site.id + '/releases?pageSize=1')).releases[0];
    const previous = await latest(), version = await cloud(base + previous.version.name), files = await filesFor(version.name);
    if (files[filename] && files[filename] !== digest) throw Error('Existing verification file differs.');
    if (!files[filename]) {
      const created = await cloud(base + 'sites/' + site.id + '/versions', 'POST', { config: version.config });
      const expected = { ...files, [filename]: digest };
      const population = await cloud(base + created.name + ':populateFiles', 'POST', { files: expected });
      const account = auth.getGlobalDefaultAccount(), token = (await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform'])).access_token;
      for (const required of population.uploadRequiredHashes || []) {
        assert.equal(required, digest); const upload = new URL(population.uploadUrl); assert.equal(upload.hostname, 'upload-firebasehosting.googleapis.com');
        const response = await fetch(upload.href + '/' + digest, { method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream' }, body: packed, signal: AbortSignal.timeout(60000) }); assert(response.ok);
      }
      assert.deepEqual(await filesFor(created.name), expected);
      await cloud(base + created.name + '?updateMask=status', 'PATCH', { status: 'FINALIZED' });
      assert.equal((await latest()).version.name, version.name, 'Concurrent website publication.');
      await cloud(base + 'sites/' + site.id + '/releases?versionName=' + encodeURIComponent(created.name), 'POST', { message: 'Google Search Console ownership verification file' });
    }
    const response = await fetch(entry.site + entry.filename); assert.equal(response.status, 200); assert.equal((await response.text()).trim(), body.toString());
    fs.writeFileSync(path.resolve(site.directory, entry.filename), body);
    console.log(JSON.stringify({ site: entry.site, verificationFilePublished: true }));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
