import { app, shell } from 'electron';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/core/app.js';
import { ConnectionService } from '../src/core/connections/service.js';
import { SeoService } from '../src/core/seo/service.js';
import { AccountVault } from '../electron/main/connection-handlers.js';
import { products, settings } from '../src/core/db/schema.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { newId } from '../src/core/lib/id.js';
import { searchPropertyMatches } from '../src/shared/seo.js';
import { connectionCredentialId } from '../src/shared/connections.js';
import { OAUTH, type AccountCredential } from '../src/core/connections/providers.js';

const owner = join(process.env['APPDATA']!, 'signal');
const temporary = process.env['SIGNAL_SEARCH_HELPER_PROFILE'];
if (!temporary) throw new Error('Use the Search Console connection launcher.');
app.disableHardwareAcceleration(); app.setPath('userData', temporary);
mkdirSync(temporary, { recursive: true }); copyFileSync(join(owner, 'Local State'), join(temporary, 'Local State'));
void app.whenReady().then(async () => {
  const signal = createApp({ databaseUrl: join(owner, 'signal.db'), logger: silentLogger, migrate: false });
  const vault = new AccountVault(join(owner, 'account-credentials'));
  const setup = process.env['SIGNAL_SEARCH_SETUP_SITES'] === '1';
  // This optional one-time setup helper has site-management scopes. The shipped
  // application's normal Search Console connection continues to request reads only.
  if (setup) OAUTH['search-console'] = { ...OAUTH['search-console']!, scopes: ['https://www.googleapis.com/auth/webmasters', 'https://www.googleapis.com/auth/siteverification.verify_only'] };
  const connections = new ConnectionService(signal, vault, url => {
    const target = new URL(url); target.searchParams.set('prompt', 'select_account consent'); return shell.openExternal(target.toString());
  }); signal.connections = connections;
  const seo = new SeoService(signal); signal.seo = seo;
  try {
    const businesses = ['lemonade', 'cinegen'].map(key => signal.db.select().from(products).where(eq(products.key, key)).get()!);
    if (businesses.some(p => !p)) throw new Error('Expected owner businesses missing.');
    const usable = () => connections.accounts().filter(a => a.provider === 'search-console' && a.status === 'verified' && (!setup || ['https://www.googleapis.com/auth/webmasters', 'https://www.googleapis.com/auth/siteverification.verify_only'].every(scope => a.grantedScopes.includes(scope)))).sort((a, b) => Number(seo.states().some(s => s.accountId === b.id)) - Number(seo.states().some(s => s.accountId === a.id)))[0];
    let source = usable();
    if (!source) {
      const product = businesses[0]!; await connections.beginOAuth('search-console', product.id, 'AION X Google Search Console', 'read');
      console.log(setup ? 'Google website setup sign-in opened. Waiting for Search Console management and ownership-verification approval.' : 'Google Search Console sign-in opened. Waiting for read-only approval.');
      const deadline = Date.now() + 8 * 60000;
      while (!source && Date.now() < deadline) { await new Promise(r => setTimeout(r, 1000)); source = usable(); }
      if (!source) throw new Error('Search Console sign-in was not completed.');
    }
    if (setup) {
      await connections.verify(source.productId, source.id, true);
      const credential = JSON.parse(vault.get('account.' + connectionCredentialId(source))!) as AccountCredential;
      const call = async (url: string, method = 'GET', body?: unknown) => {
        const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { authorization: 'Bearer ' + credential.accessToken, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
        if (!response.ok) throw new Error('Google website setup returned HTTP ' + response.status + ' at ' + new URL(url).pathname);
        return response.status === 204 ? {} : await response.json().catch(() => ({})) as Record<string, unknown>;
      };
      const entries: { site: string; filename: string }[] = [];
      for (const product of businesses) {
        const site = new URL(product.utmBase).origin + '/';
        if (!['https://siplemona.de/', 'https://cinegenaimedia.com/'].includes(site)) throw new Error('Unexpected website.');
        const data = await call('https://www.googleapis.com/siteVerification/v1/token', 'POST', { site: { type: 'SITE', identifier: site }, verificationMethod: 'FILE' });
        if (typeof data['token'] !== 'string' || !/^google[a-f0-9]+\.html$/.test(data['token'])) throw new Error('Unexpected verification filename.');
        entries.push({ site, filename: data['token'] });
      }
      writeFileSync('output/seo/google-verification-files.json', JSON.stringify(entries, null, 2));
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ['scripts/publish-google-verification.cjs'], { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr); child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error('Verification file publication failed.')));
      });
      for (const entry of entries) {
        await call('https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=FILE', 'POST', { site: { type: 'SITE', identifier: entry.site } });
        const root = 'https://www.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(entry.site);
        await call(root, 'PUT');
        for (const path of ['sitemap.xml', 'writing/sitemap.xml']) await call(root + '/sitemaps/' + encodeURIComponent(entry.site + path), 'PUT');
        console.log(JSON.stringify({ website: entry.site, ownershipVerified: true, searchPropertyAdded: true, sitemapsSubmitted: 2 }));
      }
    }
    const sites = await connections.verify(source.productId, source.id, true);
    console.log(JSON.stringify({ accessibleProperties: sites.rows.map(row => ({ property: row.title, access: row.detail })) }));
    if (process.env['SIGNAL_SEARCH_AUDIT'] === '1') {
      const credential = JSON.parse(vault.get('account.' + connectionCredentialId(source))!) as AccountCredential;
      const results = [];
      for (const product of businesses) {
        const site = new URL(product.utmBase).origin + '/';
        const response = await fetch('https://www.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(site) + '/sitemaps', { redirect: 'error', signal: AbortSignal.timeout(30000), headers: { authorization: 'Bearer ' + credential.accessToken } });
        if (!response.ok) throw new Error('Sitemap audit HTTP ' + response.status);
        const data = await response.json() as { sitemap?: { path: string; lastSubmitted?: string; isPending?: boolean; errors?: string; warnings?: string }[] };
        const state = seo.states().find(s => s.productId === product.id);
        const result = { business: product.name, property: site, access: sites.rows.find(row => row.title === site)?.detail, status: state?.status, configuredProperty: state?.siteUrl, queryRows: seo.context(product.id).snapshot?.rows.length ?? 0, sitemaps: data.sitemap ?? [] };
        results.push(result); console.log(JSON.stringify(result));
      }
      writeFileSync('output/seo/search-console-setup.json', JSON.stringify({ checkedAt: new Date().toISOString(), businesses: results }, null, 2)); return;
    }
    if (process.env['SIGNAL_SEARCH_INSPECT_INDEX'] === '1') {
      const credential = JSON.parse(vault.get('account.' + connectionCredentialId(source))!) as AccountCredential;
      const posts = JSON.parse(readFileSync('output/seo/published-guides.json', 'utf8')) as { url: string }[];
      const results = [];
      for (const product of businesses) {
        const site = new URL(product.utmBase).origin + '/';
        for (const url of [site, ...posts.filter(p => new URL(p.url).origin + '/' === site).map(p => p.url)]) {
          const response = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { authorization: 'Bearer ' + credential.accessToken, 'content-type': 'application/json' }, body: JSON.stringify({ inspectionUrl: url, siteUrl: site, languageCode: 'en-US' }) });
          if (!response.ok) throw new Error('Google index inspection HTTP ' + response.status);
          const data = await response.json() as { inspectionResult?: { indexStatusResult?: Record<string, unknown>; inspectionResultLink?: string } };
          const index = data.inspectionResult?.indexStatusResult ?? {};
          const result = { url, checkedAt: new Date().toISOString(), verdict: index['verdict'], coverage: index['coverageState'], robots: index['robotsTxtState'], indexing: index['indexingState'], lastCrawl: index['lastCrawlTime'], googleCanonical: index['googleCanonical'], userCanonical: index['userCanonical'], inspectionLink: data.inspectionResult?.inspectionResultLink };
          results.push(result); console.log(JSON.stringify(result));
        }
      }
      writeFileSync('output/seo/google-index-inspection.json', JSON.stringify(results, null, 2)); return;
    }
    for (const product of businesses) {
      const origin = new URL(product.utmBase).origin;
      const property = sites.rows.map(r => r.title).filter(site => searchPropertyMatches(site, origin)).sort((a, b) => Number(b === origin + '/') - Number(a === origin + '/'))[0];
      if (!property) { console.log(JSON.stringify({ business: product.name, status: 'property-access-needed', website: origin })); continue; }
      let account = connections.accounts().find(a => a.provider === 'search-console' && a.productId === product.id && connectionCredentialId(a) === connectionCredentialId(source!));
      if (!account) {
        account = { ...source, id: newId(), credentialId: connectionCredentialId(source), productId: product.id, createdAt: Date.now() };
        signal.db.insert(settings).values({ key: 'connections.account.' + account.id, value: account, updatedAt: Date.now() }).run();
      }
      const previous = seo.states().find(s => s.productId === product.id);
      if (previous && (previous.siteUrl !== property || previous.accountId !== account.id)) throw new Error('Existing Search Console source differs. Review it before replacing.');
      if (!previous) seo.configure(product.id, { accountId: account.id, siteUrl: property });
      await seo.sync(product.id); const state = seo.states().find(s => s.productId === product.id)!;
      console.log(JSON.stringify({ business: product.name, property, status: state.status, rows: seo.context(product.id).snapshot?.rows.length ?? 0 }));
    }
  } finally { connections.cancelOAuth(); await seo.stop(); signal.close(); }
}).then(() => app.exit(0)).catch(error => { console.error(error instanceof Error ? error.message : 'Search setup failed'); app.exit(1); });
