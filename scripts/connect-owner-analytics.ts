// Run through connect-owner-analytics.mjs. Uses the app's normal OAuth and analytics services.
import { app, shell } from 'electron';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/core/app.js';
import { ConnectionService } from '../src/core/connections/service.js';
import { AnalyticsService } from '../src/core/analytics/service.js';
import { AccountVault } from '../electron/main/connection-handlers.js';
import { products, settings } from '../src/core/db/schema.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { newId } from '../src/core/lib/id.js';
import { connectionCredentialId } from '../src/shared/connections.js';
import { analyticsDates } from '../src/core/analytics/ga4.js';
import { oauthBody, type AccountCredential } from '../src/core/connections/providers.js';

const owner = join(process.env['APPDATA']!, 'signal');
const temporary = process.env['SIGNAL_ANALYTICS_HELPER_PROFILE'];
if (!temporary) throw new Error('Use the analytics connection launcher.');
app.disableHardwareAcceleration();
app.setPath('userData', temporary);
mkdirSync(temporary, { recursive: true });
copyFileSync(join(owner, 'Local State'), join(temporary, 'Local State'));

void app.whenReady().then(async () => {
  const signal = createApp({ databaseUrl: join(owner, 'signal.db'), logger: silentLogger, migrate: false });
  const vault = new AccountVault(join(owner, 'account-credentials'));
  const connections = new ConnectionService(signal, vault, url => {
    const destination = new URL(url);
    if (process.env['SIGNAL_ANALYTICS_REAUTHORIZE_CINEGEN'] === '1') { destination.searchParams.set('prompt', 'select_account consent'); destination.searchParams.set('login_hint', 'casey.shore.92@gmail.com'); }
    return shell.openExternal(destination.toString());
  });
  signal.connections = connections;
  const analytics = new AnalyticsService(signal);
  signal.analytics = analytics;
  try {
    if (process.env['SIGNAL_ANALYTICS_DIAGNOSE'] === '1') {
      const results = [];
      for (const state of analytics.states()) {
        const product = signal.db.select().from(products).where(eq(products.id, state.productId)).get()!;
        try {
          await connections.verify(state.productId, state.accountId, true);
          const account = connections.accounts().find(a => a.id === state.accountId)!;
          const auth = JSON.parse(vault.get('account.' + connectionCredentialId(account))!) as { accessToken: string };
          const read = async (url: string, body?: unknown) => {
            const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + auth.accessToken, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(20000) });
            const data = await response.json();
            if (!response.ok) throw new Error('Google Analytics HTTP ' + response.status + ': ' + String(data.error?.message ?? data.error ?? 'Request failed').replaceAll(auth.accessToken, '[redacted]'));
            return data;
          };
          const root = 'https://analyticsadmin.googleapis.com/v1beta/properties/' + state.propertyId;
          const property = await read(root);
          const streams = await read(root + '/dataStreams?pageSize=200');
          const dates = analyticsDates(Date.now(), property.timeZone);
          const reportUrl = 'https://analyticsdata.googleapis.com/v1beta/properties/' + state.propertyId + ':runReport';
          const hosts = await read(reportUrl, { dimensions: [{ name: 'hostName' }], metrics: [{ name: 'sessions' }, { name: 'eventCount' }], dateRanges: [dates], limit: '200' });
          const events = await read(reportUrl, { dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }], dateRanges: [dates], dimensionFilter: { filter: { fieldName: 'hostName', stringFilter: { matchType: 'EXACT', value: state.hostname } } }, limit: '200' });
          await analytics.sync(state.productId);
          const result = { business: product.name, propertyId: state.propertyId, hostname: state.hostname, dates, streams: (streams.dataStreams ?? []).map((s: { webStreamData?: unknown }) => s.webStreamData), hosts: hosts.rows ?? [], hostRowCount: hosts.rowCount ?? 0, events: events.rows ?? [], status: analytics.states().find(s => s.productId === state.productId)?.status, snapshot: analytics.snapshot(state.productId) };
          results.push(result); console.log(JSON.stringify(result));
        } catch (error) {
          let refreshError: string | undefined;
          const account = connections.accounts().find(a => a.id === state.accountId);
          const raw = account ? vault.get('account.' + connectionCredentialId(account)) : undefined;
          if (raw) {
            const credential = JSON.parse(raw) as AccountCredential;
            if (credential.refreshToken && credential.clientId) {
              const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', ...oauthBody('ga4', { clientId: credential.clientId, clientSecret: credential.clientSecret ?? '', developerToken: '' }, { grant_type: 'refresh_token', refresh_token: credential.refreshToken }), signal: AbortSignal.timeout(20000) });
              const data = await response.json() as { error?: string; error_description?: string };
              if (!response.ok) refreshError = [data.error, data.error_description].filter(Boolean).join(': ');
            }
          }
          const result = { business: product.name, propertyId: state.propertyId, error: error instanceof Error ? error.message : 'Analytics diagnosis failed', refreshError };
          results.push(result); console.log(JSON.stringify(result));
        }
      }
      mkdirSync('output/analytics', { recursive: true });
      writeFileSync('output/analytics/owner-diagnosis.json', JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2)); return;
    }
    if (process.env['SIGNAL_ANALYTICS_INSPECT'] === '1') {
      for (const saved of connections.accounts().filter(a => a.provider === 'ga4')) {
        await connections.verify(saved.productId, saved.id);
        const auth = JSON.parse(vault.get('account.' + saved.id)!) as { accessToken: string };
        const headers = { authorization: 'Bearer ' + auth.accessToken };
        const check = await fetch('https://analyticsadmin.googleapis.com/v1beta/properties/498970669', { headers, signal: AbortSignal.timeout(20000) });
        console.log(JSON.stringify({ connection: saved.id, label: saved.label, cinegenAccessStatus: check.status }));
      }
      const account = connections.accounts().filter(a => a.provider === 'ga4' && a.status === 'verified').sort((a, b) => b.createdAt - a.createdAt)[0];
      if (!account) throw new Error('No saved Analytics account.');
      const credential = JSON.parse(vault.get('account.' + account.id)!) as { accessToken: string };
      const read = async (url: string) => {
        const response = await fetch(url, { headers: { authorization: 'Bearer ' + credential.accessToken }, signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error('Analytics inventory HTTP ' + response.status);
        return await response.json();
      };
      let page = ''; let count = 0;
      do {
        const result = await read('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200' + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
        for (const summary of result.accountSummaries ?? []) {
          for (const property of summary.propertySummaries ?? []) {
            const streams = await read('https://analyticsadmin.googleapis.com/v1beta/' + property.property + '/dataStreams?pageSize=200');
            console.log(JSON.stringify({ account: summary.displayName, property: property.property, name: property.displayName, streams: (streams.dataStreams ?? []).map((s: { displayName: string; webStreamData?: { defaultUri?: string; measurementId?: string } }) => ({ name: s.displayName, url: s.webStreamData?.defaultUri, measurementId: s.webStreamData?.measurementId })) }));
          }
        }
        page = result.nextPageToken ?? '';
      } while (page && ++count < 20);
      if (page) throw new Error('Property inventory exceeded page limit.');
      return;
    }
    const businesses = [
      { key: 'lemonade', propertyId: '548984396', hostname: 'siplemona.de' },
      { key: 'cinegen', propertyId: '498970669', hostname: 'cinegenaimedia.com' },
    ].filter(target => process.env['SIGNAL_ANALYTICS_REAUTHORIZE_CINEGEN'] !== '1' || target.key === 'cinegen').map(target => {
      const product = signal.db.select().from(products).where(eq(products.key, target.key)).get();
      if (!product) throw new Error('Expected business is missing.');
      return { ...target, product };
    });
    const existingIds = new Set(connections.accounts().map(a => a.id));
    const reauthorize = process.env['SIGNAL_ANALYTICS_REAUTHORIZE_CINEGEN'] === '1';
    let source = reauthorize ? undefined : connections.accounts().find(a => a.provider === 'ga4' && a.status === 'verified');
    if (!source) {
      const first = businesses[0]!;
      await connections.beginOAuth('ga4', first.product.id, first.product.name + ' Google Analytics', 'read');
      console.log('Google Analytics consent opened. Waiting for your approval.');
      const deadline = Date.now() + 5 * 60000;
      while (!source && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        source = connections.accounts().find(a => a.provider === 'ga4' && a.status === 'verified' && !existingIds.has(a.id));
      }
      if (!source) throw new Error('Analytics consent was not completed. No analytics sources were configured.');
    }
    const credential = vault.get('account.' + source.id);
    if (!credential) throw new Error('Saved Analytics credential unavailable.');
    for (const target of businesses) {
      const previous = analytics.states().find(s => s.productId === target.product.id);
      if (previous && (previous.propertyId !== target.propertyId || previous.hostname !== target.hostname)) throw new Error('Existing analytics source differs; review it before replacing.');
      const candidates = connections.accounts().filter(a => a.provider === 'ga4' && a.productId === target.product.id && a.status === 'verified');
      let account = reauthorize && source.productId === target.product.id ? source : candidates.find(a => a.id === previous?.accountId) ?? candidates[0];
      if (!account) {
        account = { ...source, id: newId(), productId: target.product.id, label: target.product.name + ' Google Analytics', createdAt: Date.now() };
        vault.set('account.' + account.id, credential);
        try { signal.db.insert(settings).values({ key: 'connections.account.' + account.id, value: account, updatedAt: Date.now() }).run(); }
        catch (error) { vault.delete('account.' + account.id); throw error; }
      }
      await connections.verify(target.product.id, account.id);
      // A successful Google account read does not establish access to this
      // property's reports. Preserve the previous source and snapshot on 403.
      await connections.analyticsRead(target.product.id, { accountId: account.id, propertyId: target.propertyId, productId: target.product.id, hostname: target.hostname, revision: previous?.revision ?? 0, status: 'idle', lastAttemptAt: null, lastCompleteAt: null, detail: '' }, new AbortController().signal);
      if (!previous || previous.accountId !== account.id) analytics.configure(target.product.id, { accountId: account.id, propertyId: target.propertyId });
      await analytics.sync(target.product.id);
      const state = analytics.states().find(s => s.productId === target.product.id)!;
      console.log(JSON.stringify({ business: target.product.name, propertyId: state.propertyId, hostname: state.hostname, status: state.status, lastCompleteAt: state.lastCompleteAt }));
      if (!['current', 'limited'].includes(state.status)) {
        const saved = JSON.parse(vault.get('account.' + account.id)! ) as { accessToken: string };
        for (const endpoint of ['https://analyticsadmin.googleapis.com/v1beta/accountSummaries', 'https://analyticsadmin.googleapis.com/v1beta/properties/' + target.propertyId]) {
          const response = await fetch(endpoint, { headers: { authorization: 'Bearer ' + saved.accessToken }, signal: AbortSignal.timeout(20000) });
          const body = await response.json() as { error?: { message?: string; status?: string }; accountSummaries?: { displayName?: string; propertySummaries?: { property?: string; displayName?: string }[] }[] };
          console.log(JSON.stringify({ endpoint, status: response.status, error: body.error?.message?.replaceAll(saved.accessToken, '[redacted]'), properties: body.accountSummaries?.flatMap(a => a.propertySummaries ?? []) }));
        }
        await connections.analyticsRead(target.product.id, state, new AbortController().signal);
        throw new Error(target.product.name + ': Analytics read succeeded but saving the report needs attention.');
      }
    }
  } finally { connections.cancelOAuth(); await analytics.stop(); signal.close(); }
}).then(() => app.exit(0)).catch(error => { console.error(error instanceof Error ? error.message : 'Analytics setup failed'); app.exit(1); });
