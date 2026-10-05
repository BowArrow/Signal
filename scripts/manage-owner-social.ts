import { app, shell } from 'electron';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../src/core/app.js';
import { ConnectionService } from '../src/core/connections/service.js';
import { AccountVault } from '../electron/main/connection-handlers.js';
import { products } from '../src/core/db/schema.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { connectionCredentialId } from '../src/shared/connections.js';
import { SalesService } from '../src/core/sales/service.js';
import { ProspectService } from '../src/core/sales/prospects.js';
import { RevenueService } from '../src/core/revenue/service.js';
import { OperationsService } from '../src/core/operations/service.js';
import { SalesReplyService } from '../src/core/sales/reply-service.js';
import { OutreachService } from '../src/core/sales/outreach-service.js';
import { AnalyticsService } from '../src/core/analytics/service.js';
import { runtimeSettings, saveRuntimeSettings } from '../src/core/runtime/settings.js';
import { DELIVERY_PROVIDERS, hasPublishingPermission } from '../src/shared/operations.js';
import { BRAND_CARD_WORKFLOW } from '../src/shared/brand-card.js';
import { parseDiscoveryQueries, suggestedDiscoveryQueries } from '../src/shared/discovery.js';
import { prepareOwnerAdDrafts } from './prepare-owner-ad-drafts.js';
import { mapOwnerTopup } from './map-owner-topup.js';
import { prepareOwnerLtd } from './prepare-owner-ltd.js';

const owner = join(process.env['APPDATA']!, 'signal');
const temporary = process.env['SIGNAL_OWNER_HELPER_PROFILE'];
if (!temporary) throw new Error('Use the owner connection launcher.');
app.disableHardwareAcceleration(); app.setPath('userData', temporary);
mkdirSync(temporary, { recursive: true }); copyFileSync(join(owner, 'Local State'), join(temporary, 'Local State'));
void app.whenReady().then(async () => {
  const signal = createApp({ databaseUrl: join(owner, 'signal.db'), logger: silentLogger, migrate: false });
  const vault = new AccountVault(join(owner, 'account-credentials'));
  const connections = new ConnectionService(signal, vault, url => shell.openExternal(url));
  signal.connections = connections;
  try {
    const businesses = signal.db.select().from(products).all();
    const lemonade = businesses.find(p => p.key === 'lemonade'); const cinegen = businesses.find(p => p.key === 'cinegen');
    if (!lemonade || !cinegen) throw new Error('Expected businesses are missing.');
    if (process.env['SIGNAL_OWNER_HELPER_MODE'] === '--inspect-sales-funding') {
      const revenue = new RevenueService(signal); signal.revenue = revenue;
      for (const product of [lemonade, cinegen]) {
        const state = revenue.states().find(s => s.productId === product.id); if (!state) continue;
        const account = connections.accounts().find(a => a.id === state.accountId)!;
        const credential = JSON.parse(vault.get('account.' + connectionCredentialId(account))!) as { accessToken: string };
        const response = await fetch('https://api.stripe.com/v1/balance_transactions?limit=1', { headers: { authorization: 'Bearer ' + credential.accessToken, 'Stripe-Version': '2024-06-20' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
        const balanceReadStatus = response.status; await response.body?.cancel();
        await revenue.sync(product.id);
        const after = revenue.states().find(s => s.productId === product.id)!;
        const payments = revenue.payments(product.id);
        console.log(JSON.stringify({ business: product.name, balanceReadStatus, scanStatus: after.status, paymentCount: payments.length, withSettlementEvidence: payments.filter(p => p.settlement).length, livePayments: payments.filter(p => p.live).length }));
      }
      return;
    }
    if (process.env['SIGNAL_OWNER_HELPER_MODE'] === '--refresh-analytics') {
      const analytics = new AnalyticsService(signal); signal.analytics = analytics;
      for (const product of [lemonade, cinegen]) {
        await analytics.sync(product.id);
        const state = analytics.states().find(s => s.productId === product.id)!;
        const snapshot = analytics.snapshot(product.id);
        console.log(JSON.stringify({ business: product.name, status: state.status, lastCompleteAt: state.lastCompleteAt, detail: state.detail, rows: snapshot?.rows.length, funnel: snapshot?.funnel }));
        if (state.status === 'attention') {
          await connections.verify(product.id, state.accountId);
          const checked = connections.accounts().find(a => a.id === state.accountId)!;
          console.log(JSON.stringify({ business: product.name, connectionStatus: checked.status, detail: checked.detail }));
        }
        const account = connections.accounts().find(a => a.id === state.accountId)!;
        const credential = JSON.parse(vault.get('account.' + connectionCredentialId(account))!) as { accessToken: string };
        const response = await fetch(`https://analyticsadmin.googleapis.com/v1beta/properties/${state.propertyId}/dataStreams`, { headers: { authorization: 'Bearer ' + credential.accessToken }, signal: AbortSignal.timeout(20000) });
        if (!response.ok) { console.log(JSON.stringify({ business: product.name, streamAccess: response.status })); continue; }
        const result = await response.json() as { dataStreams?: { webStreamData?: { measurementId?: string; defaultUri?: string } }[] };
        console.log(JSON.stringify({ business: product.name, streams: result.dataStreams?.map(s => s.webStreamData) }));
      }
      return;
    }
    if (process.env['SIGNAL_OWNER_HELPER_MODE'] === '--prepare-ltd-campaigns') {
      signal.operations = new OperationsService(signal);
      await prepareOwnerLtd(signal);
      return;
    }
    if (process.env['SIGNAL_OWNER_HELPER_MODE'] === '--map-custom-topup') {
      await mapOwnerTopup(signal);
      return;
    }
    if (process.env['SIGNAL_OWNER_HELPER_MODE'] === '--prepare-ad-drafts') {
      signal.operations = new OperationsService(signal);
      prepareOwnerAdDrafts(signal, owner);
      return;
    }
    if (process.env['SIGNAL_OWNER_HELPER_MODE'] === '--use-cpu-agents') {
      signal.operations = new OperationsService(signal);
      if (businesses.some(product => signal.operations!.state(product.id).running)) throw new Error('Pause business operations before changing the text-agent device.');
      const previous = runtimeSettings(signal);
      if (previous.provider !== 'local') throw new Error('A cloud text provider is selected; leave it unchanged.');
      if (previous.localDevice !== 'cpu') {
        const folder = join(process.cwd(), 'data', 'runtime-cpu-owner'); mkdirSync(folder, { recursive: true });
        const backup = join(folder, 'before-' + Date.now() + '.json');
        writeFileSync(backup, JSON.stringify(previous, null, 2), { flag: 'wx' });
        saveRuntimeSettings(signal, { ...previous, localDevice: 'cpu' });
      }
      console.log(JSON.stringify({ provider: runtimeSettings(signal).provider, localDevice: runtimeSettings(signal).localDevice, operationsRunning: false, modelStarted: false }));
      return;
    }
    if (process.env['SIGNAL_OWNER_HELPER_MODE'] === '--configure-research') {
      signal.operations = new OperationsService(signal);
      for (const product of [lemonade, cinegen]) {
        const state = signal.operations.state(product.id);
        if (state.running) throw new Error('Pause before preparing research.');
        if (!state.discovery?.enabled) {
          if (state.revision !== 1 || state.accountIds.length !== 3) throw new Error('Expected the newly prepared operation; refusing to replace other settings.');
          signal.operations.configure(product.id, { objective: state.objective, accountIds: state.accountIds, intervalHours: state.intervalHours, dailyLimit: state.dailyLimit, ...(state.imageWorkflowId ? { imageWorkflowId: state.imageWorkflowId } : {}), discovery: { enabled: true, queries: parseDiscoveryQueries(suggestedDiscoveryQueries(product.name)) } });
        }
        const research = await signal.operations.discovery.refresh(product.id);
        console.log(JSON.stringify({ product: product.name, running: signal.operations.state(product.id).running, searches: research.searches, findings: research.findings.length, sourceUrls: research.findings.slice(0, 3).map(f => f.url), queuedPublications: signal.operations.deliveries().filter(j => j.productId === product.id && j.status === 'queued').length }));
      }
      return;
    }
    if (process.env['SIGNAL_OWNER_HELPER_MODE'] === '--prepare-operation') {
      signal.operations = new OperationsService(signal); signal.sales = new SalesService(signal);
      signal.salesReplies = new SalesReplyService(signal); signal.outreach = new OutreachService(signal);
      signal.prospects = new ProspectService(signal); signal.revenue = new RevenueService(signal); signal.analytics = new AnalyticsService(signal);
      for (const product of [lemonade, cinegen]) {
        const existing = signal.operations.state(product.id), replies = signal.salesReplies.policy(product.id);
        if (existing.running || existing.revision !== 0 || existing.accountIds.length || replies.enabled || replies.revision !== 0) throw new Error(product.name + ' already has owner operating settings; refusing to replace them.');
        const destinations = ['signal-blog', 'bluesky', 'x'].map(provider => connections.accounts().find(a => a.productId === product.id && a.provider === provider && a.status === 'verified' && hasPublishingPermission(a)));
        if (destinations.some(a => !a)) throw new Error('Expected publishing connection missing for ' + product.name);
        const inbox = signal.sales.sources().find(s => s.productId === product.id && s.autoSync && s.aiTriage);
        if (!inbox) throw new Error('Expected monitored sales inbox missing for ' + product.name);
        for (const account of destinations) await connections.verify(product.id, account!.id);
        await connections.verify(product.id, inbox.accountId);
        signal.db.transaction(() => {
          signal.operations!.configure(product.id, {
            objective: product.key === 'lemonade'
              ? 'Help small teams find answers in their own documents and reduce repetitive work. Show one concrete, source-verified workflow and invite the reader to try it with their own files. Measure trial interest and product-scoped Stripe sales; never invent customer outcomes.'
              : 'Help independent creators move one story idea into a concrete shot plan and editable video project. Show one source-verified workflow and invite the reader to try it. Measure trial interest and product-scoped Stripe sales; never imply generated examples are customer work.',
            accountIds: destinations.map(a => a!.id), intervalHours: 24, dailyLimit: 1, imageWorkflowId: BRAND_CARD_WORKFLOW,
          });
          signal.salesReplies!.configure(product.id, { enabled: true, accountIds: [inbox.accountId], dailyLimit: 3, delayMinutes: 10, followUpDays: [] });
        });
        console.log(JSON.stringify({ product: product.name, running: signal.operations.state(product.id).running, destinations: destinations.map(a => a!.provider), dailyPublications: 1, dailyReplies: 3, followUps: [], outreachEnabled: false, imageMode: 'local branded card', readiness: signal.operations.readiness(product.id) }));
      }
      return;
    }
    if (process.env['SIGNAL_OWNER_HELPER_MODE'] === '--inspect-bluesky-requests') {
      const account = connections.accounts().find(a => a.productId === lemonade.id && a.provider === 'bluesky' && a.status === 'verified');
      if (!account) throw new Error('Lemonade Bluesky account unavailable.');
      signal.operations = new OperationsService(signal);
      const queries = signal.operations.state(lemonade.id).discovery?.queries.filter(q => q.kind === 'bluesky').map(q => q.query) ?? [];
      const collected = new Map<string, import('../src/shared/discovery.js').DemandFinding>();
      for (const query of queries) {
        const findings = await connections.blueskyRequests(lemonade.id, account.id, query, new AbortController().signal);
        for (const finding of findings) collected.set(finding.id, finding);
        console.log(JSON.stringify({ query, count: findings.length }));
      }
      mkdirSync('data/operations-validation', { recursive: true });
      writeFileSync('data/operations-validation/public-requests.json', JSON.stringify({ capturedAt: Date.now(), findings: [...collected.values()] }, null, 2));
      console.log(JSON.stringify({ uniqueFindings: collected.size, externalDeliveries: 0 }));
      return;
    }
    if (process.env['SIGNAL_OWNER_HELPER_MODE'] === '--inspect-operation') {
      signal.operations = new OperationsService(signal); signal.sales = new SalesService(signal);
      signal.salesReplies = new SalesReplyService(signal); signal.outreach = new OutreachService(signal);
      signal.prospects = new ProspectService(signal); signal.revenue = new RevenueService(signal); signal.analytics = new AnalyticsService(signal);
      const runtime = runtimeSettings(signal);
      console.log(JSON.stringify({ provider: runtime.provider, localDevice: runtime.localDevice }));
      for (const product of [lemonade, cinegen]) {
        const state = signal.operations.state(product.id), reply = signal.salesReplies.policy(product.id), outreach = signal.outreach.policy(product.id);
        console.log(JSON.stringify({ product: product.name, running: state.running, destinations: state.accountIds, dailyLimit: state.dailyLimit, replyEnabled: reply.enabled, outreachEnabled: outreach.enabled, hasMailingAddress: Boolean(outreach.mailingAddress), readiness: signal.operations.readiness(product.id), accounts: connections.accounts().filter(a => a.productId === product.id).map(a => ({ id: a.id, provider: a.provider, label: a.label, status: a.status, canPublish: (DELIVERY_PROVIDERS as readonly string[]).includes(a.provider) && hasPublishingPermission(a) })) }));
      }
      return;
    }
    const mode = process.env['SIGNAL_OWNER_HELPER_MODE'];
    if (mode === '--inspect-facebook') {
      const account = connections.accounts().find(a => a.productId === lemonade.id && a.provider === 'facebook');
      if (!account) throw new Error('No Facebook Page connection found.');
      await connections.verify(account.productId, account.id);
      console.log(JSON.stringify(connections.accounts().filter(a => a.provider === 'facebook').map(a => ({ label: a.label, identity: a.identity, status: a.status, page: a.facebookPage, detail: a.detail }))));
      return;
    }
    if (mode === '--configure-revenue') {
      const revenue = new RevenueService(signal); signal.revenue = revenue;
      const source = connections.accounts().find(a => a.productId === lemonade.id && a.provider === 'stripe' && a.status === 'verified');
      if (!source) throw new Error('Verified AIonX Stripe connection missing.');
      const credential = JSON.parse(vault.get('account.' + connectionCredentialId(source))!) as { accessToken: string };
      if (!credential.accessToken.startsWith('rk_live_')) throw new Error('Expected the existing live restricted Stripe key.');
      const catalog = await revenue.catalog(lemonade.id, source.id);
      const names = { lemonade: ['Lemonade'], cinegen: ['CineGen Editor', 'CineGen Editor+', 'CineGen Creator', 'CineGen Pro', 'CineGen Studio', 'Small Token Pack', 'Medium Token Pack', 'Large Token Pack', 'CineGen AI token top-up'] };
      for (const product of [lemonade, cinegen]) {
        const expected = names[product.key as keyof typeof names];
        const selected = catalog.filter(p => expected.includes(p.name));
        if (expected.some(name => !selected.some(p => p.name === name))) throw new Error('Expected catalog entry missing for ' + product.name);
        let account = connections.accounts().find(a => a.productId === product.id && connectionCredentialId(a) === connectionCredentialId(source));
        account ??= await connections.shareAccount(source.productId, source.id, product.id);
        const previous = revenue.states().find(s => s.productId === product.id);
        if (previous && (previous.accountId !== account.id || !previous.live || [...previous.stripeProductIds].sort().join('\n') !== selected.map(p => p.id).sort().join('\n'))) throw new Error('Existing revenue mapping differs; left unchanged for ' + product.name);
        if (!previous) revenue.configure(product.id, { accountId: account.id, stripeProductIds: selected.map(p => p.id), since: Date.now() - 90 * 86400000, live: true });
        for (let page = 0; page < 20; page++) {
          await revenue.sync(product.id);
          if (revenue.states().find(s => s.productId === product.id)?.status !== 'partial') break;
        }
        const state = revenue.states().find(s => s.productId === product.id)!;
        console.log(JSON.stringify({ business: product.name, mappedProducts: selected, status: state.status, scanned: state.scanned, excluded: state.excluded, totals: revenue.totals(product.id), startedOperations: false }));
        if (state.status !== 'current') throw new Error('Revenue scan needs attention for ' + product.name + ': ' + state.detail);
      }
      return;
    }
    if (mode === '--inspect-revenue') {
      const revenue = new RevenueService(signal); signal.revenue = revenue;
      for (const product of [lemonade, cinegen]) {
        const accounts = connections.accounts().filter(a => a.productId === product.id && a.provider === 'stripe');
        for (const account of accounts) {
          const catalog = account.status === 'verified' ? await revenue.catalog(product.id, account.id) : [];
          console.log(JSON.stringify({ business: product.name, accountId: account.id, label: account.label, status: account.status, catalog }));
        }
        console.log(JSON.stringify({ business: product.name, stripeAccounts: accounts.length, source: revenue.states().find(s => s.productId === product.id) ?? null }));
      }
      return;
    }
    if (mode === '--configure-intake') {
      const sales = new SalesService(signal); signal.sales = sales;
      const prospects = new ProspectService(signal); signal.prospects = prospects;
      const gmail = connections.accounts().find(a => a.productId === lemonade.id && a.provider === 'gmail' && a.status === 'verified');
      if (!gmail) throw new Error('Verified business Gmail connection missing.');
      for (const [product, sender] of [[lemonade, 'sales@aionx.aionapp.org'], [cinegen, 'sales@outreach.cinegenaimedia.com']] as const) {
        const website = connections.accounts().find(a => a.productId === product.id && a.provider === 'signal-blog');
        if (!website) throw new Error('Website connection missing: ' + product.name);
        const existing = prospects.source(product.id, 'signal-blog');
        if (!existing) await prospects.configure(product.id, { provider: 'signal-blog', accountId: website.id, listId: 'website', enabled: true, businessConfirmed: true, marketingPermissionId: '' });
        else if (existing.accountId !== website.id || !existing.enabled) throw new Error('Existing website preferences differ; left unchanged.');
        await prospects.sync(product.id, false, 'signal-blog');
        let inbox = connections.accounts().find(a => a.productId === product.id && a.provider === 'gmail' && a.identity === gmail.identity);
        if (!inbox) {
          await connections.reuseGmail(gmail.productId, gmail.id, product.id);
          inbox = connections.accounts().find(a => a.productId === product.id && a.provider === 'gmail' && a.identity === gmail.identity);
        }
        if (!inbox) throw new Error('Could not link business Gmail.');
        const source = sales.sources().find(s => s.productId === product.id && s.accountId === inbox.id);
        if (!source) await sales.configureVerified(product.id, { accountId: inbox.id, senderEmail: sender, since: Date.now() - 7 * 86400000, autoSync: true, aiTriage: true });
        else if (source.senderEmail !== sender) throw new Error('Existing sender differs; left unchanged.');
        const current = prospects.source(product.id, 'signal-blog')!;
        console.log(JSON.stringify({ product: product.name, websiteSource: current.status, leadsAdded: current.added, sender, inboxConfigured: true, startedOperations: false, emailSent: false }));
      }
      return;
    }
    if (mode === '--inspect-prospects') {
      for (const product of [lemonade, cinegen]) {
        const account = connections.accounts().find(a => a.productId === product.id && a.provider === 'signal-blog');
        const expectedOrigin = product.key === 'lemonade' ? 'https://siplemona.de' : 'https://cinegenaimedia.com';
        if (!account || account.site !== expectedOrigin) throw new Error('Expected website connection missing.');
        const credential = JSON.parse(vault.get('account.' + connectionCredentialId(account))!) as { accessToken: string };
        for (const endpoint of ['/meta', '/changes?after=0&limit=1']) {
          const response = await fetch(expectedOrigin + '/api/prospects' + endpoint, { headers: { authorization: 'Bearer ' + credential.accessToken }, signal: AbortSignal.timeout(30000), redirect: 'error' });
          if (!response.ok) throw new Error(product.name + ' prospect endpoint returned HTTP ' + response.status);
          const data = await response.json() as { product?: string; changes?: unknown[]; head?: number };
          if (data.product !== product.key) throw new Error('Prospect response product mismatch.');
          console.log(JSON.stringify({ product: product.name, endpoint, status: response.status, productMatches: true, ...(data.changes ? { sampledChanges: data.changes.length, head: data.head } : {}) }));
        }
      }
      return;
    }
    if (mode === '--share') {
      for (const [provider, label] of [['youtube', 'YouTube'], ['bluesky', 'Bluesky'], ['linkedin', 'LinkedIn'], ['x', 'X'], ['facebook', 'Facebook Page']] as const) {
        const source = connections.accounts().find(a => a.productId === lemonade.id && a.provider === provider);
        if (!source) throw new Error('Expected social account missing: ' + provider);
        connections.rename(lemonade.id, source.id, 'AIonX ' + label);
        let target = connections.accounts().find(a => a.productId === cinegen.id && connectionCredentialId(a) === connectionCredentialId(source));
        if (!target) target = await connections.shareSocial(lemonade.id, source.id, cinegen.id);
        console.log(JSON.stringify({ provider, label: target.label, businesses: ['Lemonade', 'CineGen'], sharedCredential: true }));
      }
      return;
    }
    const account = connections.accounts().find(a => a.productId === lemonade.id && a.provider === 'x');
    if (!account) throw new Error('Expected X connection missing.');
    if (!account.grantedScopes.includes('tweet.write')) {
      await connections.authorizeXPosting(account.productId, account.id);
      console.log('X authorization opened. Approve posting access for ' + account.identity + '. Direct Messages are not requested.');
      const deadline = Date.now() + 5 * 60000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (connections.accounts().find(a => a.id === account.id)?.grantedScopes.includes('tweet.write')) break;
      }
    }
    const updated = connections.accounts().find(a => a.id === account.id);
    if (!updated?.grantedScopes.includes('tweet.write')) throw new Error('X posting authorization was not completed. Existing login retained.');
    console.log(JSON.stringify({ xPostingGranted: true, identity: updated.identity, sharedBusinesses: connections.accounts().filter(a => connectionCredentialId(a) === connectionCredentialId(updated)).length, posted: false }));
  } finally { connections.cancelOAuth(); signal.close(); }
}).then(() => app.exit(0)).catch(error => { console.error(error instanceof Error ? error.message : 'Owner setup failed.'); app.exit(1); });
