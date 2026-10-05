/* global fetch, AbortSignal */
// Read-only checks against public Hosting files. No test conversions are sent.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { checkedAt: new Date().toISOString(), files: [], analyticsIngestionVerified: false };
const receipt = JSON.parse(readFileSync('output/marketing-audit/lemonade-funnel-release.json', 'utf8'));
async function verify(origin, path, expected) {
  const response = await fetch(origin + path, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  assert(response.ok, `${origin}${path}: HTTP ${response.status}`);
  const sha256 = hash(Buffer.from(await response.arrayBuffer()));
  assert.equal(sha256, expected, `Published content differs: ${origin}${path}`);
  report.files.push({ origin, path, sha256 });
}
for (const file of receipt.expected) await verify('https://siplemona.de', file.path, file.sha256);

const cinegenRoot = resolve('../CineGen/dist');
const cinegenIndex = readFileSync(resolve(cinegenRoot, 'index.html'));
await verify('https://cinegenaimedia.com', '/', hash(cinegenIndex));
for (const path of ['/website-analytics.js', '/website-analytics.css', '/prospect-signup.js']) {
  await verify('https://cinegenaimedia.com', path, hash(readFileSync(resolve(cinegenRoot, '.' + path))));
}
const scripts = [...cinegenIndex.toString().matchAll(/<script\b[^>]*\bsrc="(\/assets\/[^"?#]+\.js)"/g)].map(match => match[1]);
assert(scripts.length > 0, 'No compiled CineGen entry script found');
for (const path of new Set(scripts)) await verify('https://cinegenaimedia.com', path, hash(readFileSync(resolve(cinegenRoot, '.' + path))));
mkdirSync('output/marketing-audit', { recursive: true });
writeFileSync('output/marketing-audit/website-funnel-live-verification.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
