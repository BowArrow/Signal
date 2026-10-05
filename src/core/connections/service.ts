import { createHash, randomBytes } from 'node:crypto';
import { searchBlueskyRequests } from '../operations/bluesky-discovery.js';
import { createServer, type Server } from 'node:http';
import { eq, like } from 'drizzle-orm';
import { z } from 'zod';
import type { App } from '../app.js';
import { settings } from '../db/schema.js';
import { initializeMarketing, requireProduct } from '../marketing/store.js';
import { studioView } from '../studio/store.js';
import { newId } from '../lib/id.js';
import { ACCOUNT_PROVIDERS, accountProvider, connectionInput, connectionCredentialId, SHARED_SOCIAL_PROVIDERS, type ConnectedAccount, type ConnectionView, type ProviderId } from '../../shared/connections.js';
import { boundedJson, publicOrigin } from './network.js';
import { OAUTH, PUBLISH_SCOPES, oauthBody, probeAccount, type AccountCredential, type OAuthConfig } from './providers.js';
import { deliver, type PublicationJournal } from '../operations/delivery.js';
import type { Delivery } from '../../shared/operations.js';
import { StripeRevenueReader } from '../revenue/stripe.js';
import type { RevenueConfig } from '../../shared/revenue.js';
import { Ga4Reader } from '../analytics/ga4.js';
import type { AnalyticsState } from '../../shared/analytics.js';
import { InboxReader } from '../sales/inbox.js';
import { GmailReplyDelivery } from '../sales/gmail-delivery.js';
import { OutreachDelivery } from '../sales/outreach-delivery.js';
import { MailchimpReader } from '../sales/mailchimp.js';
import { YoutubeClient } from '../video/youtube.js';
import { youtubeCanUpload } from '../../shared/video-publishing.js';
import { WebsiteProspectReader } from '../sales/website-prospects.js';
import type { OutreachJob } from '../../shared/outreach.js';
import { OutlookReplyDelivery } from '../sales/outlook-delivery.js';
import type { SalesReply } from '../../shared/sales-replies.js';
import { bundledOAuth, isGoogleProvider, parseConnectionApps, parseGoogleDesktopClient, type ConnectionApps } from './app-config.js';

export interface CredentialVault { available(): boolean; get(key: string): string | undefined; set(key: string, value: string): void; delete(key: string): void; }
export const CALLBACK_URL = 'http://127.0.0.1:43821/oauth/callback';
const PREFIX = 'connections.account.';
const tokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1).optional(), expires_in: z.coerce.number().positive().optional(), scope: z.string().optional() });
type Pending = { provider: ProviderId; productId: string; label: string; state: string; verifier: string; expiresAt: number; server: Server; timer: ReturnType<typeof setTimeout>; config: OAuthConfig; epoch: number; replacingId?: string };
export class ConnectionService {
  private pending: Pending | null = null;
  private opening = false;
  private authEpoch = 0;
  private message = '';
  private refreshes = new Map<string, Promise<AccountCredential>>();
  private gmailSenderCache = new Map<string, { identity: string; checkedAt: number; rows: { accountId: string; email: string; verified: boolean; primary: boolean }[] }>();
  private readonly connectionApps: ConnectionApps;
  constructor(private readonly app: App, private readonly vault: CredentialVault, private readonly openBrowser: (url: string) => Promise<void> = async () => { throw new Error('Browser authorization is available in the desktop app.'); }, private readonly transport: typeof fetch = fetch, connectionApps: ConnectionApps = {}) { this.connectionApps = parseConnectionApps(connectionApps); }
  accounts(): ConnectedAccount[] {
    return this.app.db.select().from(settings).where(like(settings.key, `${PREFIX}%`)).all().map(row => row.value as ConnectedAccount);
  }
  view(): ConnectionView {
    initializeMarketing(this.app);
    const products = studioView(this.app).products;
    const oauthConfigured = ACCOUNT_PROVIDERS.filter(p => this.oauthConfig(p.id)).map(p => p.id);
    const oauthManaged = oauthConfigured.filter(id => Boolean(bundledOAuth(this.connectionApps, id) || (isGoogleProvider(id) && this.vault.get('oauth.google'))));
    return { providers: ACCOUNT_PROVIDERS, accounts: this.accounts(), products: products.map(p => ({ id: p.id, name: p.name })), secureStorage: this.vault.available(), oauthConfigured, oauthManaged, callbackUrl: CALLBACK_URL, configuredWebsites: products.filter(p => this.configuredWebsiteKey(p.id)).map(p => p.id), pending: this.pending ? { provider: this.pending.provider, label: this.pending.label, expiresAt: this.pending.expiresAt } : null, oauthMessage: this.message };
  }
  private online() { if (this.app.env.SIGNAL_OFFLINE === '1') throw new Error('Offline mode: account network requests are disabled.'); }
  private configuredWebsiteKey(productId: string) {
    const product = requireProduct(this.app, productId);
    return product.key === 'lemonade' ? this.app.env.SIGNAL_LEMONADE_PUBLISH_KEY : product.key === 'cinegen' ? this.app.env.SIGNAL_CINEGEN_PUBLISH_KEY : undefined;
  }
  async importWebsite(productId: string) {
    const product = requireProduct(this.app, productId); const key = this.configuredWebsiteKey(productId);
    if (!key) throw new Error('No website publishing key is configured for this business.');
    if (this.accounts().some(a => a.productId === productId && a.provider === 'signal-blog')) throw new Error('A website connection already exists. Check it or disconnect before linking a replacement.');
    await this.connect({ provider: 'signal-blog', productId, label: `${product.name} website`, credential: key });
  }
  private save(account: ConnectedAccount) {
    this.app.db.insert(settings).values({ key: `${PREFIX}${account.id}`, value: account, updatedAt: this.app.clock.now() }).onConflictDoUpdate({ target: settings.key, set: { value: account, updatedAt: this.app.clock.now() } }).run();
  }
  rename(productId: string, id: string, label: string) {
    const account = this.requireAccount(productId, id);
    const name = z.string().trim().min(1).max(120).parse(label);
    const family = connectionCredentialId(account);
    this.app.db.transaction(() => {
      for (const linked of this.accounts().filter(a => connectionCredentialId(a) === family)) this.save({ ...linked, label: name });
    }, { behavior: 'immediate' });
  }
  async shareSocial(productId: string, id: string, targetProductId: string) {
    if (!SHARED_SOCIAL_PROVIDERS.includes(this.requireAccount(productId, id).provider)) throw new Error('Choose a verified social account.');
    return this.shareAccount(productId, id, targetProductId);
  }
  async shareAccount(productId: string, id: string, targetProductId: string) {
    this.online();
    const source = this.requireAccount(productId, id); requireProduct(this.app, targetProductId);
    if ((!SHARED_SOCIAL_PROVIDERS.includes(source.provider) && source.provider !== 'stripe') || source.status !== 'verified') throw new Error('Choose a verified social or Stripe account.');
    if (productId === targetProductId) throw new Error('This account already belongs to that business.');
    await this.credentials(source);
    return this.app.db.transaction(() => {
      const current = this.requireAccount(productId, id);
      if (current.status !== 'verified') throw new Error('Check this connection before sharing it.');
      const family = connectionCredentialId(current);
      if (this.accounts().some(a => a.productId === targetProductId && (connectionCredentialId(a) === family || (current.provider !== 'stripe' && a.provider === current.provider && a.identity === current.identity && a.site === current.site)))) throw new Error('This account is already linked to that business.');
      const linked: ConnectedAccount = { ...current, id: newId(), credentialId: family, productId: targetProductId, createdAt: this.app.clock.now() };
      this.save(linked); return linked;
    }, { behavior: 'immediate' });
  }
  private requireAccount(productId: string, id: string) {
    requireProduct(this.app, productId);
    const account = this.accounts().find(item => item.id === id && item.productId === productId);
    if (!account) throw new Error('Account not found for this business.'); return account;
  }
  private persist(account: ConnectedAccount, credential: AccountCredential) {
    this.vault.set(`account.${account.id}`, JSON.stringify(credential));
    try { this.save(account); } catch (error) { this.vault.delete(`account.${account.id}`); throw error; }
  }
  configureOAuth(provider: ProviderId, config: OAuthConfig) {
    if (!OAUTH[provider]) throw new Error('This provider uses a token or app password.');
    const previous = this.oauthConfig(provider);
    const next = { clientId: config.clientId, clientSecret: config.clientSecret || (previous?.clientId === config.clientId ? previous.clientSecret : '') || '', developerToken: config.developerToken || previous?.developerToken || '' };
    if (['linkedin', 'pinterest'].includes(provider) && !next.clientSecret) throw new Error('This provider requires the developer app client secret.');
    if (provider === 'google-ads' && !next.developerToken) throw new Error('Google Ads also requires your developer token.');
    this.vault.set(isGoogleProvider(provider) && provider !== 'google-ads' ? 'oauth.google' : `oauth.${provider}`, JSON.stringify(next));
  }
  importGoogleClient(input: unknown) {
    const config = parseGoogleDesktopClient(input);
    this.vault.set('oauth.google', JSON.stringify(config));
    this.message = 'Google sign-in is ready for Gmail, YouTube, Analytics and Search Console. Choose an account to connect.';
  }
  private oauthConfig(provider: ProviderId): OAuthConfig | null {
    if (!OAUTH[provider]) return null;
    const raw = this.vault.get(`oauth.${provider}`);
    const individual = raw ? JSON.parse(raw) as OAuthConfig : null;
    const shared = isGoogleProvider(provider) ? this.vault.get('oauth.google') : undefined;
    const config = shared ? { ...JSON.parse(shared) as OAuthConfig, developerToken: individual?.developerToken ?? '' } : individual ?? bundledOAuth(this.connectionApps, provider);
    return provider === 'google-ads' && !config?.developerToken ? null : config;
  }
  gmailSenderOptions() {
    return [...this.gmailSenderCache.entries()].filter(([id, saved]) => this.app.clock.now() - saved.checkedAt < 15 * 60000 && this.accounts().some(a => a.id === id && a.identity === saved.identity)).flatMap(([, saved]) => saved.rows);
  }
  requireKnownGmailSender(productId: string, id: string, email: string) {
    const account = this.requireAccount(productId, id);
    if (account.provider !== 'gmail' || !this.gmailSenderOptions().some(row => row.accountId === id && row.email === email && row.verified)) throw new Error('Refresh Gmail sender addresses and choose a verified address. Add missing aliases in Gmail Settings > Accounts > Send mail as.');
  }
  async verifyGmailSender(productId: string, id: string, email: string) {
    await this.gmailSenders(productId, id); this.requireKnownGmailSender(productId, id, email);
  }
  async reuseGmail(sourceProductId: string, id: string, productId: string) {
    this.online(); const source = this.requireAccount(sourceProductId, id); const product = requireProduct(this.app, productId);
    if (source.provider !== 'gmail' || source.status !== 'verified') throw new Error('Choose a verified Gmail connection.');
    if (this.accounts().some(a => a.productId === productId && a.provider === 'gmail' && a.identity === source.identity)) throw new Error('This Gmail account is already linked to this business.');
    const credential = await this.credentials(source); this.requireAccount(sourceProductId, id);
    const account = { ...source, id: newId(), productId, label: `${product.name} Gmail`, createdAt: this.app.clock.now() };
    this.persist(account, credential); await this.verify(productId, account.id);
  }
  async gmailSenders(productId: string, id: string) {
    this.online(); const account = this.requireAccount(productId, id);
    if (account.provider !== 'gmail') throw new Error('Choose a Gmail connection.');
    this.gmailSenderCache.delete(id);
    let credential = await this.credentials(account);
    const read = () => this.json('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs', { headers: { authorization: `Bearer ${credential.accessToken}` } });
    let data;
    try { data = await read(); } catch (error) {
      if (!credential.refreshToken || !(error instanceof Error) || !error.message.startsWith('Provider returned HTTP 401.')) throw error;
      credential = await this.credentials(this.requireAccount(productId, id), true); data = await read();
    }
    if (this.requireAccount(productId, id).identity !== account.identity) throw new Error('Gmail account changed while reading senders.');
    const parsed = z.object({ sendAs: z.array(z.object({ sendAsEmail: z.string().email().max(254), isPrimary: z.boolean().optional(), verificationStatus: z.enum(['accepted', 'pending', 'verificationStatusUnspecified']).optional() })).max(100) }).safeParse(data);
    if (!parsed.success) throw new Error('Gmail returned an invalid sender list.');
    const secrets = [credential.accessToken, credential.refreshToken, credential.clientSecret].filter((value): value is string => Boolean(value));
    const rows = parsed.data.sendAs.map(alias => ({ accountId: id, email: alias.sendAsEmail.toLowerCase(), verified: alias.verificationStatus === 'accepted' || (alias.isPrimary === true && alias.sendAsEmail.toLowerCase() === account.identity.toLowerCase()), primary: alias.isPrimary === true }));
    if (rows.some(row => secrets.some(secret => row.email.includes(secret.toLowerCase())))) throw new Error('Gmail returned an invalid sender address.');
    this.gmailSenderCache.set(id, { identity: account.identity, checkedAt: this.app.clock.now(), rows });
    return rows;
  }
  async gmailAliases(productId: string, id: string) {
    const senders = await this.gmailSenders(productId, id);
    return { title: 'Gmail sender addresses', rows: senders.map(row => ({ title: row.email, detail: row.primary ? 'Primary Gmail address' : row.verified ? 'Verified Gmail alias. Select this address in Sales to route incoming conversations and send replies from it.' : 'Not verified for sending in Gmail.' })) };
  }
  async connect(input: unknown): Promise<void> {
    const value = connectionInput.parse(input); const product = requireProduct(this.app, value.productId);
    let site = value.site.replace(/\/$/, '');
    if (['wordpress', 'mastodon'].includes(value.provider)) site = publicOrigin(site);
    if (value.provider === 'posthog' && !['https://us.posthog.com', 'https://eu.posthog.com'].includes(site)) throw new Error('Choose the PostHog US or EU cloud origin.');
    if (value.provider === 'signal-blog') { const sites: Record<string, string> = { lemonade: 'https://siplemona.de', cinegen: 'https://cinegenaimedia.com' }; site = sites[product.key] ?? ''; if (!site) throw new Error('No Signal website adapter for this business.'); }
    if (['wordpress', 'bluesky'].includes(value.provider) && !value.username) throw new Error('Enter the account username or handle.');
    const developerToken = value.provider === 'google-ads' ? this.oauthConfig('google-ads')?.developerToken : undefined;
    let credential: AccountCredential = { accessToken: value.credential, ...(developerToken ? { developerToken } : {}) };
    if (value.provider === 'bluesky') {
      this.online();
      const data = await this.json('https://bsky.social/xrpc/com.atproto.server.createSession', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: value.username, password: value.credential }) });
      credential = { accessToken: z.string().min(1).parse(data.accessJwt), refreshToken: z.string().min(1).parse(data.refreshJwt) };
    }
    const account: ConnectedAccount = { id: newId(), productId: value.productId, provider: value.provider, label: value.label, site, username: value.username, identity: '', status: 'saved', detail: 'Saved; account read access has not been verified.', checkedAt: null, expiresAt: value.provider === 'bluesky' ? this.app.clock.now() + 90 * 60000 : value.expiresAt, refreshable: Boolean(credential.refreshToken), grantedScopes: [], createdAt: this.app.clock.now() };
    this.persist(account, credential);
    if (this.app.env.SIGNAL_OFFLINE !== '1') await this.verify(account.productId, account.id);
  }
  disconnect(productId: string, id: string) {
    const account = this.requireAccount(productId, id);
    this.app.db.delete(settings).where(eq(settings.key, `${PREFIX}${id}`)).run();
    const family = connectionCredentialId(account);
    if (!this.accounts().some(a => connectionCredentialId(a) === family)) this.vault.delete(`account.${family}`);
  }
  private async json(url: string, init: RequestInit = {}) { this.online(); return boundedJson(await this.transport(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) })); }
  private async credentials(account: ConnectedAccount, forceRefresh = false): Promise<AccountCredential> {
    const family = connectionCredentialId(account);
    const raw = this.vault.get(`account.${family}`); if (!raw) throw new Error('Credential unavailable. Unlock OS storage or reconnect the account.');
    const value = JSON.parse(raw) as AccountCredential;
    if (!forceRefresh && (!account.expiresAt || account.expiresAt > this.app.clock.now() + 60000)) return value;
    if (!value.refreshToken) throw new Error('Account token has expired. Reconnect with a renewed token.');
    const active = this.refreshes.get(family); if (active) return active;
    const promise = this.refresh(account, value).finally(() => this.refreshes.delete(family));
    this.refreshes.set(family, promise); return promise;
  }
  private async refresh(account: ConnectedAccount, credential: AccountCredential): Promise<AccountCredential> {
    let next: AccountCredential; let expiresAt: number | null;
    let grantedScopes = account.grantedScopes;
    if (account.provider === 'bluesky') {
      const data = await this.json('https://bsky.social/xrpc/com.atproto.server.refreshSession', { method: 'POST', headers: { authorization: `Bearer ${credential.refreshToken}` } });
      next = { accessToken: z.string().min(1).parse(data.accessJwt), refreshToken: z.string().min(1).parse(data.refreshJwt) }; expiresAt = this.app.clock.now() + 90 * 60000;
    } else {
      const spec = OAUTH[account.provider]; if (!spec || !credential.clientId) throw new Error('This token cannot be refreshed. Reconnect the account.');
      const config: OAuthConfig = { clientId: credential.clientId, clientSecret: credential.clientSecret ?? '', developerToken: credential.developerToken ?? '' };
      const data = tokenSchema.parse(await this.json(spec.token, { method: 'POST', ...oauthBody(account.provider, config, { grant_type: 'refresh_token', refresh_token: credential.refreshToken! }) }));
      next = { ...credential, accessToken: data.access_token, refreshToken: data.refresh_token ?? credential.refreshToken! };
      if (data.scope) grantedScopes = data.scope.split(/[ ,]+/);
      expiresAt = data.expires_in ? this.app.clock.now() + data.expires_in * 1000 : null;
    }
    const family = connectionCredentialId(account);
    const linked = this.accounts().filter(a => connectionCredentialId(a) === family);
    if (!linked.length) throw new Error('Account disconnected during token refresh.');
    const latest = this.vault.get(`account.${family}`);
    if (latest && latest !== JSON.stringify(credential)) return JSON.parse(latest) as AccountCredential;
    this.vault.set(`account.${family}`, JSON.stringify(next));
    this.app.db.transaction(() => {
      for (const current of linked) this.save({ ...current, expiresAt, refreshable: Boolean(next.refreshToken), grantedScopes });
    }, { behavior: 'immediate' });
    return next;
  }
  async verify(productId: string, id: string, preview = false) {
    this.online(); const account = this.requireAccount(productId, id);
    try {
      let credential = await this.credentials(account);
      let result;
      try { result = await probeAccount(account, credential, this.transport, preview); }
      catch (error) {
        if (!credential.refreshToken || !(error instanceof Error) || !error.message.startsWith('Provider returned HTTP 401.')) throw error;
        credential = await this.credentials(this.requireAccount(productId, id), true);
        result = await probeAccount(account, credential, this.transport, preview);
      }
      // Provider text is untrusted and can echo credentials. Never send such text to the renderer/agent.
      const scrub = (value: string) => [credential.accessToken, credential.refreshToken, credential.clientSecret, credential.developerToken].filter((s): s is string => Boolean(s)).reduce((out, secret) => out.replaceAll(secret, '[redacted]'), value).slice(0, 500);
      const current = this.requireAccount(productId, id);
      const checkedAccounts = result.facebookPage ? this.accounts().filter(a => a.provider === 'facebook' && connectionCredentialId(a) === connectionCredentialId(current)) : [current];
      this.app.db.transaction(() => {
        for (const linked of checkedAccounts) this.save({ ...linked, ...(result.facebookPage ? { facebookPage: result.facebookPage } : {}), identity: scrub(result.identity), status: 'verified', detail: result.detail, checkedAt: this.app.clock.now() });
      });
      return { title: scrub(result.identity), rows: result.rows.map(row => ({ title: scrub(row.title), detail: scrub(row.detail) })) };
    } catch (error) {
      // Only locally authored HTTP status diagnostics cross the boundary. Network,
      // JSON parser, and provider-body errors can contain credentials or private data.
      const raw = error instanceof Error ? error.message : '';
      const detail = /^(Provider returned HTTP \d+\.|Account token has expired\.|Credential unavailable\.|The provider did not return|Provider rejected the connection|Use a Facebook Page token|Connect an authorized bot account)/.test(raw) ? raw : 'Connection check failed. Verify API access, account type, required permissions, and network connectivity; reconnect if needed.';
      if (this.accounts().some(item => item.id === id && item.productId === productId)) {
        const current = this.requireAccount(productId, id);
        const linked = current.provider === 'facebook' ? this.accounts().filter(a => connectionCredentialId(a) === connectionCredentialId(current)) : [current];
        for (const item of linked) this.save({ ...item, ...(item.facebookPage ? { facebookPage: { ...item.facebookPage, canPost: false } } : {}), status: 'attention', detail, checkedAt: this.app.clock.now() });
      }
      if (preview) throw new Error(detail);
      return { title: 'Connection needs attention', rows: [{ title: 'Check failed', detail }] };
    }
  }
  /** Main-process only: reuses the verified, product-scoped website credential. */
  websiteKey(productId: string): string | undefined {
    const account = this.accounts().find(item => item.productId === productId && item.provider === 'signal-blog' && item.status === 'verified' && (!item.expiresAt || item.expiresAt > this.app.clock.now()));
    if (!account) return undefined;
    const value = this.vault.get(`account.${account.id}`); return value ? (JSON.parse(value) as AccountCredential).accessToken : undefined;
  }
  /** A scoped main-process client. Every request rechecks the account and current write authority. */
  youtube(productId: string, accountId: string, signal: AbortSignal, canWrite: () => void) {
    const allowed = () => {
      this.online(); signal.throwIfAborted();
      const account = this.requireAccount(productId, accountId);
      if (account.provider !== 'youtube' || account.status !== 'verified' || !youtubeCanUpload(account)) throw new Error('Reconnect this YouTube channel with upload permission.');
      return account;
    };
    return new YoutubeClient(async (url, init, write) => {
      const original = allowed(); const family = connectionCredentialId(original);
      const send = async (forceRefresh = false) => {
        const credential = await this.credentials(allowed(), forceRefresh);
        const current = allowed();
        if (connectionCredentialId(current) !== family || current.identity !== original.identity) throw new Error('YouTube connection changed.');
        if (write) canWrite();
        return this.transport(url, { ...init, redirect: 'manual', headers: { ...init.headers, Authorization: `Bearer ${credential.accessToken}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]) });
      };
      const response = await send();
      if (response.status !== 401) return response;
      await response.body?.cancel(); return send(true);
    });
  }
  /** Main-process delivery only; credentials never cross the IPC or model boundary. */
  async deliver(job: Delivery, signal: AbortSignal, canWrite: () => void, journal?: PublicationJournal) {
    this.online();
    const account = this.requireAccount(job.productId, job.accountId);
    if (account.provider !== job.provider || account.status !== 'verified') throw new Error('Verify the selected destination before delivery.');
    const credential = await this.credentials(account);
    this.requireAccount(job.productId, job.accountId);
    signal.throwIfAborted(); canWrite();
    return deliver(account, credential, job, this.transport, signal, canWrite, () => { if (!this.app.operationImages) throw new Error('Open Signal desktop to read the campaign image.'); return this.app.operationImages.read(job.image?.asset); }, journal);
  }
  /** Read-only Mailchimp adapter; the credential stays in the main process. */
  async mailchimpReader(productId: string, accountId: string, signal: AbortSignal) {
    this.online();
    const allowed = () => { const account = this.requireAccount(productId, accountId); if (account.provider !== 'mailchimp' || account.status !== 'verified') throw new Error('Verify this business Mailchimp connection first.'); return account; };
    const credential = await this.credentials(allowed()); signal.throwIfAborted(); allowed();
    return new MailchimpReader(credential.accessToken, this.transport, signal, allowed);
  }
  async websiteProspectReader(productId: string, accountId: string, signal: AbortSignal) {
    this.online(); const product = requireProduct(this.app, productId);
    const allowed = () => { const account = this.requireAccount(productId, accountId); if (account.provider !== 'signal-blog' || account.status !== 'verified') throw new Error('Verify this business website connection first.'); return account; };
    const account = allowed(), credential = await this.credentials(account); this.online(); signal.throwIfAborted(); allowed();
    return new WebsiteProspectReader(account.site, product.key, credential.accessToken, this.transport, signal, allowed);
  }
  /** Fixed, read-only Stripe adapter; no credentials or raw customer fields escape. */
  async revenueRead(productId: string, config: RevenueConfig | { accountId: string }, signal: AbortSignal, scan?: { cursor: string; startedAt: number }) {
    this.online(); const account = this.requireAccount(productId, config.accountId);
    if (account.provider !== 'stripe' || account.status !== 'verified') throw new Error('Verify this business Stripe connection before syncing revenue.');
    const credential = await this.credentials(account); signal.throwIfAborted();
    const reader = new StripeRevenueReader(credential.accessToken, this.transport, signal, () => { this.requireAccount(productId, config.accountId); });
    const result = scan && 'stripeProductIds' in config ? await reader.page(config, scan.cursor, scan.startedAt) : await reader.catalog();
    this.requireAccount(productId, config.accountId); signal.throwIfAborted(); return result;
  }
  async blueskyRequests(productId: string, accountId: string, query: string, signal: AbortSignal) {
    this.online();
    const allowed = () => { this.online(); const account = this.requireAccount(productId, accountId); if (account.provider !== 'bluesky' || account.status !== 'verified') throw new Error('Verify this business Bluesky account before searching.'); return account; };
    const credential = await this.credentials(allowed());
    return searchBlueskyRequests(credential.accessToken, query, this.app.clock.now(), signal, allowed, this.transport);
  }
  /** Fixed Google Search Console endpoint; tokens remain in the credential vault. */
  async searchRead(productId: string, config: SeoState, signal: AbortSignal) {
    this.online();
    const allowed = () => { this.online(); const account = this.requireAccount(productId, config.accountId); if (account.provider !== 'search-console' || account.status !== 'verified') throw new Error('Verify Search Console first.'); return account; };
    let credential = await this.credentials(allowed());
    const read = () => new SearchConsoleReader(credential.accessToken, this.transport, signal, allowed).report(config.siteUrl, config.origin, this.app.clock.now());
    try { return await read(); }
    catch (error) {
      if (!credential.refreshToken || !(error instanceof Error) || !error.message.startsWith('Provider returned HTTP 401.')) throw error;
      signal.throwIfAborted(); credential = await this.credentials(allowed(), true); return read();
    }
  }
  /** Fixed Google report endpoints; aggregate observations only, no visitor identity. */
  async analyticsRead(productId: string, config: AnalyticsState, signal: AbortSignal) {
    this.online();
    const allowed = () => {
      const account = this.requireAccount(productId, config.accountId);
      if (account.provider !== 'ga4' || account.status !== 'verified') throw new Error('Verify this business Google Analytics connection first.');
      return account;
    };
    let credential = await this.credentials(allowed());
    const read = () => new Ga4Reader(credential.accessToken, this.transport, signal, allowed).report(config.propertyId, config.hostname, this.app.clock.now());
    let result;
    try { result = await read(); }
    catch (error) {
      if (!credential.refreshToken || !(error instanceof Error) || !error.message.startsWith('Provider returned HTTP 401.')) throw error;
      signal.throwIfAborted(); credential = await this.credentials(allowed(), true); result = await read();
    }
    signal.throwIfAborted(); allowed();
    const secrets = [credential.accessToken, credential.refreshToken, credential.clientSecret, credential.developerToken].filter((s): s is string => Boolean(s));
    const redact = (campaign: string) => secrets.some(s => campaign.includes(s)) ? '(redacted)' : campaign;
    let funnel: { status: 'available' | 'unavailable'; rows: Awaited<ReturnType<Ga4Reader['funnel']>>['rows']; limitations: string[] };
    try {
      const events = await new Ga4Reader(credential.accessToken, this.transport, signal, allowed).funnel(config.propertyId, config.hostname, result);
      funnel = { ...events, status: 'available', rows: events.rows.map(row => ({ ...row, campaign: redact(row.campaign) })) };
    } catch {
      signal.throwIfAborted(); allowed();
      funnel = { status: 'unavailable', rows: [], limitations: ['Funnel event report unavailable. Traffic data is separate; retry sync to refresh events.'] };
    }
    signal.throwIfAborted(); allowed();
    return { ...result, funnel, rows: result.rows.map(row => ({ ...row, campaign: redact(row.campaign) })) };
  }
  /** Main-process Gmail delivery; credentials never enter saved messages or model input. */
  async deliverSalesReply(job: SalesReply, signal: AbortSignal, beforeSend: () => void, accepted: (id: string) => void, continueAttempt: () => void) {
    const adapter = await this.salesReplyAdapter(job, signal, true);
    const check = async (next: () => void) => { await this.app.prospects?.assertContact(job.productId, job.to, signal); signal.throwIfAborted(); next(); };
    return adapter instanceof OutlookReplyDelivery ? adapter.send(job, () => check(beforeSend), accepted, () => check(continueAttempt)) : adapter.send(job, () => check(beforeSend), accepted);
  }
  async reconcileSalesReply(job: SalesReply, signal: AbortSignal) { const adapter = await this.salesReplyAdapter(job, signal); return adapter.reconcile(job); }
  async deliverOutreach(job: OutreachJob, signal: AbortSignal, beforeWrite: () => void, accepted: (id: string) => void, continueAttempt: () => void) {
    const adapter = await this.outreachAdapter(job, signal, true);
    const check = async (next: () => void) => { await this.app.prospects?.assertContact(job.productId, job.to, signal); signal.throwIfAborted(); next(); };
    return adapter.send(job, () => check(beforeWrite), accepted, () => check(continueAttempt));
  }
  async reconcileOutreach(job: OutreachJob, signal: AbortSignal) { const adapter = await this.outreachAdapter(job, signal); return adapter.reconcile(job); }
  private async outreachAdapter(job: OutreachJob, signal: AbortSignal, sending = false) {
    this.online(); const account = this.requireAccount(job.productId, job.accountId);
    if (!['gmail', 'outlook'].includes(account.provider) || account.status !== 'verified' || account.identity.toLowerCase() !== (job.mailbox ?? job.from)) throw new Error('Reconnect the original outreach inbox.');
    if (sending && account.provider === 'gmail' && job.from !== account.identity.toLowerCase()) await this.verifyGmailSender(job.productId, job.accountId, job.from);
    const credential = await this.credentials(account); signal.throwIfAborted();
    const allowed = () => { const current = this.requireAccount(job.productId, job.accountId); if (current.provider !== account.provider || current.status !== 'verified' || current.identity.toLowerCase() !== (job.mailbox ?? job.from)) throw new Error('The outreach inbox changed.'); if (sending && (this.app.sales?.sender(job.productId, job.accountId) ?? current.identity.toLowerCase()) !== job.from) throw new Error('The outreach sender changed.'); };
    return new OutreachDelivery(account.provider as 'gmail' | 'outlook', credential.accessToken, this.transport, signal, allowed, job.followUp ? this.app.outreach?.history(job) ?? [] : []);
  }
  private async salesReplyAdapter(job: SalesReply, signal: AbortSignal, needsHistory = false) {
    this.online(); const account = this.requireAccount(job.productId, job.accountId);
    if (!['gmail', 'outlook'].includes(account.provider) || account.status !== 'verified' || account.identity.toLowerCase() !== (job.mailbox ?? job.from)) throw new Error('Reconnect the original inbox to handle this reply.');
    if (needsHistory && account.provider === 'gmail' && job.from !== account.identity.toLowerCase()) await this.verifyGmailSender(job.productId, job.accountId, job.from);
    const credential = await this.credentials(account); signal.throwIfAborted();
    const history = needsHistory && job.followUp ? this.app.salesReplies?.confirmedThreadHistory(job) : [];
    if (needsHistory && job.followUp && !history) throw new Error('Sales sequence history is unavailable.');
    const allowed = () => { const current = this.requireAccount(job.productId, job.accountId); if (current.provider !== account.provider || current.status !== 'verified' || current.identity.toLowerCase() !== (job.mailbox ?? job.from)) throw new Error('The original inbox changed.'); if (needsHistory && (this.app.sales?.sender(job.productId, job.accountId) ?? current.identity.toLowerCase()) !== job.from) throw new Error('The reply sender changed.'); };
    return account.provider === 'outlook' ? new OutlookReplyDelivery(credential.accessToken, this.transport, signal, allowed, history) : new GmailReplyDelivery(credential.accessToken, this.transport, signal, allowed, history);
  }
  /** Read-only inbox access for Sales. */
  async inboxRead(productId: string, accountId: string, since: number, until: number, cursor: string, signal: AbortSignal, allowed: () => void, recipient?: string) {
    this.online(); const account = this.requireAccount(productId, accountId);
    if (!['gmail', 'outlook'].includes(account.provider) || account.status !== 'verified') throw new Error('Verify this business inbox before syncing.');
    let credential = await this.credentials(account);
    const read = () => new InboxReader(account, credential.accessToken, this.transport, signal, () => { this.requireAccount(productId, accountId); allowed(); }, [credential.refreshToken ?? '', credential.clientSecret ?? '', credential.developerToken ?? ''], recipient).page(since, until, cursor);
    let result;
    try { result = await read(); }
    catch (error) {
      if (!credential.refreshToken || !(error instanceof Error) || !error.message.startsWith('Provider returned HTTP 401.')) throw error;
      credential = await this.credentials(this.requireAccount(productId, accountId), true); result = await read();
    }
    signal.throwIfAborted(); this.requireAccount(productId, accountId); allowed(); return result;
  }
  async authorizeXPosting(productId: string, id: string) {
    const account = this.requireAccount(productId, id);
    if (account.provider !== 'x' || !account.identity) throw new Error('Choose an identified X account.');
    await this.beginOAuth('x', productId, account.label, 'publish', id);
  }
  async beginOAuth(provider: ProviderId, productId: string, label: string, access: 'read' | 'publish' = 'read', replacingId?: string) {
    this.online(); requireProduct(this.app, productId);
    if (replacingId && (provider !== 'x' || this.requireAccount(productId, replacingId).provider !== 'x')) throw new Error('Only an existing X connection can use this authorization upgrade.');
    if (this.pending || this.opening) throw new Error('Finish or cancel the current browser sign-in first.');
    const spec = OAUTH[provider]; const config = this.oauthConfig(provider);
    if (!spec || !config) throw new Error('Save this provider’s developer app configuration first.');
    this.opening = true;
    try {
      const state = randomBytes(32).toString('base64url'); const verifier = randomBytes(48).toString('base64url');
      const server = createServer((req, res) => {
        res.setHeader('content-type', 'text/plain; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.setHeader('referrer-policy', 'no-referrer');
        const url = new URL(req.url ?? '/', CALLBACK_URL); const flow = this.pending;
        if (req.method !== 'GET' || req.headers.host !== '127.0.0.1:43821' || url.pathname !== '/oauth/callback' || !flow || url.searchParams.get('state') !== flow.state || flow.expiresAt <= this.app.clock.now()) { res.writeHead(400); res.end('Invalid or expired authorization. Return to Signal.'); return; }
        if (url.searchParams.has('error')) { this.cancelOAuth(); this.message = 'Authorization was declined. No account was linked.'; res.end(this.message); return; }
        const code = url.searchParams.get('code'); if (!code || code.length > 8000) { res.writeHead(400); res.end('Missing authorization code.'); return; }
        this.pending = null; clearTimeout(flow.timer); this.opening = true; // Consume state before exchanging code; reject replays.
        void this.completeOAuth(flow, code).then(() => { this.message = 'Account linked. Return to Connections to review its access check.'; res.end(this.message); }).catch(() => { this.message = 'Authorization could not be completed. Check the app configuration and try again.'; res.writeHead(400); res.end(this.message); }).finally(() => { server.close(); this.opening = false; });
      });
      server.requestTimeout = 10000; server.headersTimeout = 10000;
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(43821, '127.0.0.1', () => resolve()); });
      const timer = setTimeout(() => { this.cancelOAuth(); this.message = 'Browser sign-in expired. Try connecting again.'; }, 5 * 60000); timer.unref();
      this.pending = { provider, productId, label, state, verifier, expiresAt: this.app.clock.now() + 5 * 60000, server, timer, config, epoch: ++this.authEpoch, ...(replacingId ? { replacingId } : {}) };
      const scopes = [...spec.scopes, ...(access === 'publish' ? PUBLISH_SCOPES[provider] ?? [] : [])];
      const url = new URL(spec.authorize); const values: Record<string, string> = { client_id: config.clientId, response_type: 'code', redirect_uri: CALLBACK_URL, state, scope: scopes.join(provider === 'pinterest' ? ',' : ' '), ...spec.extra };
      if (spec.pkce) { values.code_challenge = createHash('sha256').update(verifier).digest('base64url'); values.code_challenge_method = 'S256'; }
      for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
      this.message = 'Finish sign-in in your browser. Signal never asks for your provider password.';
      await this.openBrowser(url.toString());
    } catch { this.cancelOAuth(); throw new Error('Could not start browser sign-in. Check your app setup and that callback port 43821 is available.'); }
    finally { this.opening = false; }
  }
  private async completeOAuth(flow: Pending, code: string) {
    const spec = OAUTH[flow.provider]!;
    const data = tokenSchema.parse(await this.json(spec.token, { method: 'POST', ...oauthBody(flow.provider, flow.config, { grant_type: 'authorization_code', code, redirect_uri: CALLBACK_URL, ...(spec.pkce ? { code_verifier: flow.verifier } : {}) }) }));
    if (flow.epoch !== this.authEpoch) throw new Error('Authorization was cancelled.');
    const account: ConnectedAccount = { id: newId(), productId: flow.productId, provider: flow.provider, label: flow.label, site: '', username: '', identity: '', status: 'saved', detail: 'Authorized; checking account access.', checkedAt: null, expiresAt: data.expires_in ? this.app.clock.now() + data.expires_in * 1000 : null, refreshable: Boolean(data.refresh_token), grantedScopes: data.scope ? data.scope.split(/[ ,]+/) : [], createdAt: this.app.clock.now() };
    if (flow.replacingId) {
      const credential: AccountCredential = { accessToken: data.access_token, ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}), ...flow.config };
      const checked = await probeAccount(account, credential, this.transport, false);
      if (flow.epoch !== this.authEpoch) throw new Error('Authorization was cancelled.');
      const current = this.requireAccount(flow.productId, flow.replacingId);
      if (checked.identity.toLowerCase() !== current.identity.toLowerCase() || !account.grantedScopes.includes('tweet.write')) throw new Error('Authorize posting for the same X account.');
      const family = connectionCredentialId(current);
      this.vault.set(`account.${family}`, JSON.stringify(credential));
      this.app.db.transaction(() => {
        for (const linked of this.accounts().filter(a => connectionCredentialId(a) === family)) this.save({ ...linked, status: 'verified', detail: 'X posting permission authorized. Configure publishing in Operations.', grantedScopes: account.grantedScopes, expiresAt: account.expiresAt, refreshable: account.refreshable, checkedAt: this.app.clock.now() });
      }, { behavior: 'immediate' });
      return;
    }
    this.persist(account, { accessToken: data.access_token, ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}), ...flow.config });
    await this.verify(account.productId, account.id);
  }
  cancelOAuth() { this.authEpoch++; if (this.pending) { clearTimeout(this.pending.timer); this.pending.server.close(); this.pending = null; } this.message = 'Browser sign-in cancelled.'; }
  providerName(id: ProviderId) { return accountProvider(id).name; }
}
import { SearchConsoleReader } from '../seo/search-console.js';
import type { SeoState } from '../../shared/seo.js';
