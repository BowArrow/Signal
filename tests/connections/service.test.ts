import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { settings } from '../../src/core/db/schema.js';
import { ConnectionService, CALLBACK_URL, type CredentialVault } from '../../src/core/connections/service.js';
import { ACCOUNT_PROVIDERS, type ConnectedAccount, type ProviderId } from '../../src/shared/connections.js';
import { probeAccount } from '../../src/core/connections/providers.js';
import { publicAddress, publicOrigin } from '../../src/core/connections/network.js';

// OAuth callback tests share the registered localhost port and must run in one worker.
describe('account connections', () => {
class MemoryVault implements CredentialVault {
  data = new Map<string, string>(); available() { return true; } get(key: string) { return this.data.get(key); } set(key: string, value: string) { this.data.set(key, value); } delete(key: string) { this.data.delete(key); }
}
let app: App; let vault: MemoryVault; let service: ConnectionService; let browser: string[];
const response = (value: unknown) => Response.json(value);
beforeEach(() => { vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); app = createApp({ databaseUrl: ':memory:', logger: silentLogger }); vault = new MemoryVault(); browser = []; service = new ConnectionService(app, vault, async url => { browser.push(url); }, vi.fn(async () => response({ emailAddress: 'owner@example.org' }))); service.view(); });
afterEach(() => { service.cancelOAuth(); app.close(); vi.unstubAllEnvs(); __setConfigForTests(null); });
const firstProduct = () => service.view().products[0]!.id;
it('keeps credentials out of SQLite and renderer views, scopes actions, and deletes saved tokens on disconnect', async () => {
  await service.connect({ provider: 'gmail', productId: firstProduct(), label: 'Sales inbox', credential: 'private-access-token' });
  const account = service.accounts()[0]!;
  expect(account.status).toBe('verified');
  expect(JSON.stringify(service.view())).not.toContain('private-access-token');
  expect(JSON.stringify(app.db.select().from(settings).all())).not.toContain('private-access-token');
  const other = service.view().products[1]!.id;
  await expect(service.verify(other, account.id)).rejects.toThrow('not found');
  expect(() => service.disconnect(other, account.id)).toThrow('not found');
  service.disconnect(account.productId, account.id); expect(service.accounts()).toHaveLength(0); expect(vault.get(`account.${account.id}`)).toBeUndefined();
});
it('rejects private destinations and pins website publishing to the selected business', async () => {
  for (const value of ['http://example.org', 'https://127.0.0.1', 'https://[::1]', 'https://user:password@example.org', 'https://example.org/path', 'https://localhost']) expect(() => publicOrigin(value)).toThrow();
  for (const value of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.2.1', '100.64.0.1', '::ffff:127.0.0.1', 'fe80::1']) expect(publicAddress(value)).toBe(false);
  expect(publicAddress('8.8.8.8')).toBe(true);
  const send = vi.fn(async (_url: string | URL | Request) => response({ error: 'Post not found' }));
  const c = new ConnectionService(app, vault, undefined, send);
  await c.connect({ productId: firstProduct(), provider: 'signal-blog', label: 'Website', site: 'https://attacker.example', credential: 'private-token' });
  expect(String(send.mock.calls[0]?.[0])).toContain('https://siplemona.de/');
});
it('keeps failures actionable without exposing remote bodies, reflected credentials, or caller tokens', async () => {
  const send = vi.fn(async () => new Response('secret-value reflected by provider', { status: 401 }));
  const c = new ConnectionService(app, vault, undefined, send);
  await c.connect({ provider: 'gmail', productId: firstProduct(), label: 'Inbox', credential: 'secret-value' });
  expect(c.accounts()[0]).toMatchObject({ status: 'attention' });
  expect(JSON.stringify(c.view())).not.toContain('secret-value');
  send.mockImplementation(async () => response({ emailAddress: 'secret-value' }));
  await c.verify(firstProduct(), c.accounts()[0]!.id);
  expect(c.accounts()[0]!.identity).toBe('[redacted]');
  const longToken = 'private-'.repeat(200);
  send.mockImplementation(async () => response({ emailAddress: longToken }));
  await c.connect({ provider: 'gmail', productId: firstProduct(), label: 'Long token', credential: longToken });
  expect(c.accounts().find(a => a.label === 'Long token')!.identity).toBe('[redacted]');
});
it('does not make remote calls for expired imported tokens or in offline mode', async () => {
  const send = vi.fn(async () => response({ emailAddress: 'owner@example.org' }));
  const c = new ConnectionService(app, vault, undefined, send);
  await c.connect({ provider: 'gmail', productId: firstProduct(), label: 'Expired', credential: 'token', expiresAt: 1 });
  expect(send).not.toHaveBeenCalled(); expect(c.accounts()[0]!.status).toBe('attention');
  vi.stubEnv('SIGNAL_OFFLINE', '1'); __setConfigForTests(null); const offline = createApp({ databaseUrl: ':memory:', logger: silentLogger });
  try { const s = new ConnectionService(offline, vault, undefined, send); const p = s.view().products[0]!.id; await s.connect({ provider: 'gmail', productId: p, label: 'Offline', credential: 'test-only' }); expect(s.accounts()[0]!.status).toBe('saved'); await expect(s.verify(p, s.accounts()[0]!.id)).rejects.toThrow('Offline'); expect(send).not.toHaveBeenCalled(); } finally { offline.close(); }
});
it('validates OAuth state, uses S256, consumes the callback once, and rotates refresh tokens once for concurrent reads', async () => {
  let refreshes = 0;
  const transport: typeof fetch = vi.fn(async (url, init) => {
    if (String(url).includes('/token')) {
      const body = new URLSearchParams(String(init?.body));
      if (body.get('grant_type') === 'refresh_token') { refreshes++; await new Promise(resolve => setTimeout(resolve, 20)); return response({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600 }); }
      expect(body.get('code_verifier')).toHaveLength(64); expect(body.get('redirect_uri')).toBe(CALLBACK_URL);
      return response({ access_token: 'original-access', refresh_token: 'original-refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.readonly' });
    }
    return response({ emailAddress: 'sales@example.org' });
  });
  service = new ConnectionService(app, vault, async url => { browser.push(url); }, transport);
  service.configureOAuth('gmail', { clientId: 'desktop-client', clientSecret: '', developerToken: '' });
  await service.beginOAuth('gmail', firstProduct(), 'Sales');
  const auth = new URL(browser[0]!); expect(auth.searchParams.get('code_challenge_method')).toBe('S256'); expect(auth.searchParams.get('scope')).not.toContain('gmail.send');
  expect((await fetch(`${CALLBACK_URL}?state=wrong&code=test`)).status).toBe(400); expect(service.view().pending).not.toBeNull();
  const callback = `${CALLBACK_URL}?state=${auth.searchParams.get('state')}&code=test-code`;
  expect((await fetch(callback)).status).toBe(200);
  const account = service.accounts()[0]!; expect(account.status).toBe('verified');
  app.db.update(settings).set({ value: { ...account, expiresAt: 1 } }).where(eq(settings.key, `connections.account.${account.id}`)).run();
  await Promise.all([service.verify(account.productId, account.id), service.verify(account.productId, account.id)]);
  expect(refreshes).toBe(1); expect(vault.get(`account.${account.id}`)).toContain('rotated-refresh'); expect(JSON.stringify(service.view())).not.toContain('rotated');
});
it('cancels authorization during a slow token exchange without saving a late account', async () => {
  let entered: () => void = () => {}; let release: () => void = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; });
  const send: typeof fetch = async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return response({ access_token: 'late-token', expires_in: 3600 }); };
  service = new ConnectionService(app, vault, async url => { browser.push(url); }, send);
  service.configureOAuth('gmail', { clientId: 'client', clientSecret: '', developerToken: '' });
  await service.beginOAuth('gmail', firstProduct(), 'Sales', 'publish');
  const auth = new URL(browser[0]!); expect(auth.searchParams.get('scope')).toContain('gmail.send');
  const callback = fetch(`${CALLBACK_URL}?state=${auth.searchParams.get('state')}&code=test`);
  await started; service.cancelOAuth(); release(); expect((await callback).status).toBe(400);
  expect(service.accounts()).toHaveLength(0); expect([...vault.data.keys()].some(key => key.startsWith('account.'))).toBe(false);
});
it('does not resurrect a disconnected account when a read finishes late', async () => {
  let release: () => void = () => {}; let entered: () => void = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; });
  const send = vi.fn(async () => response({ emailAddress: 'owner@example.org' }));
  const c = new ConnectionService(app, vault, undefined, send); await c.connect({ provider: 'gmail', productId: firstProduct(), label: 'Inbox', credential: 'test-token' });
  const account = c.accounts()[0]!;
  send.mockImplementation(async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return response({ emailAddress: 'owner@example.org' }); });
  const check = c.verify(account.productId, account.id); await started; c.disconnect(account.productId, account.id); release(); await check;
  expect(c.accounts()).toHaveLength(0); expect(vault.get(`account.${account.id}`)).toBeUndefined();
});
it('reads inbox headers without sending or marking messages read', async () => {
  const methods: string[] = [];
  const send: typeof fetch = async (url, init) => { methods.push(init?.method ?? 'GET'); return response(String(url).includes('/profile') ? { emailAddress: 'sales@example.org' } : String(url).includes('?labelIds=') ? { messages: [{ id: 'abc' }] } : { payload: { headers: [{ name: 'Subject', value: 'Can I try your product?' }, { name: 'From', value: 'buyer@example.org' }] } }); };
  const c = new ConnectionService(app, vault, undefined, send); await c.connect({ provider: 'gmail', productId: firstProduct(), label: 'Inbox', credential: 'test-token' });
  const result = await c.verify(firstProduct(), c.accounts()[0]!.id, true);
  expect(result.rows[0]).toEqual({ title: 'Can I try your product?', detail: 'buyer@example.org' }); expect(methods.every(m => m === 'GET')).toBe(true);
});

const fixtures: Record<ProviderId, Record<string, unknown>> = {
  gmail: { emailAddress: 'owner@example.org' }, outlook: { mail: 'owner@example.org' }, youtube: { items: [{ id: 'channel', snippet: { title: 'Channel' } }] }, linkedin: { name: 'Owner' }, x: { data: { username: 'owner' } }, facebook: { id: '1234', name: 'Business', category: 'Software', can_post: true }, instagram: { username: 'owner' }, threads: { username: 'owner' }, tiktok: { data: { user: { display_name: 'Owner' } }, error: { code: 'ok' } }, pinterest: { username: 'owner' }, reddit: { name: 'owner' }, bluesky: { handle: 'owner.bsky.social' }, mastodon: { acct: 'owner' }, discord: { username: 'Bot', bot: true }, slack: { ok: true, team: 'Team', user: 'Bot' }, resend: { data: [{ name: 'example.org', status: 'verified' }] }, brevo: { email: 'owner@example.org' }, mailchimp: { account_name: 'Owner' }, stripe: { livemode: false, available: [{ amount: 100, currency: 'usd' }] }, ga4: { accountSummaries: [{ propertySummaries: [{ displayName: 'Product', property: 'properties/1' }] }] }, 'search-console': { siteEntry: [{ siteUrl: 'https://example.org', permissionLevel: 'siteOwner' }] }, posthog: { results: [{ name: 'Product', id: 1 }] }, hubspot: { results: [{ properties: { email: 'buyer@example.org' } }] }, wordpress: { name: 'Owner' }, 'signal-blog': { slug: 'signal-connection-check' }, 'meta-ads': { data: [{ name: 'Business', id: 'act_1' }] }, 'google-ads': { resourceNames: ['customers/1'] }, cloudflare: { success: true, result: [{ name: 'example.org', status: 'active' }] },
};
it.each(ACCOUNT_PROVIDERS)('validates $name using an authenticated read on its pinned endpoint', async p => {
  const account: ConnectedAccount = { id: 'id', provider: p.id, productId: firstProduct(), label: 'test', site: p.id === 'posthog' ? 'https://us.posthog.com' : p.id === 'signal-blog' ? 'https://siplemona.de' : 'https://example.org', username: 'owner', identity: '', status: 'saved', detail: '', checkedAt: null, expiresAt: null, refreshable: false, grantedScopes: [], createdAt: 1 };
  const send: typeof fetch = vi.fn(async (url, init) => { expect(String(url)).toMatch(/^https:\/\//); expect(init?.redirect).toBe('error'); expect(init?.method ?? 'GET').toBe(p.id === 'slack' ? 'POST' : 'GET'); expect(Object.keys(init?.headers ?? {}).length).toBeGreaterThan(0); return response(fixtures[p.id]); });
  expect((await probeAccount(account, { accessToken: p.id === 'mailchimp' ? 'private-us21' : 'private', developerToken: 'developer' }, send)).identity).not.toBe('');
});

const google = { clientId: 'signal-fixture.apps.googleusercontent.com', clientSecret: 'desktop-client-fixture' };
const download = { installed: { client_id: google.clientId, client_secret: google.clientSecret } };
it('starts bundled Google authorization with PKCE, scopes only the chosen service, and stores the refresh client', async () => {
  let browser = '';
  const send = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes('/token')) {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('client_id')).toBe(google.clientId);
      expect(body.get('client_secret')).toBe(google.clientSecret);
      expect(body.get('code_verifier')).toHaveLength(64);
      return Response.json({ access_token: 'access-fixture', refresh_token: 'refresh-fixture', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.readonly' });
    }
    return Response.json({ emailAddress: 'owner@example.org' });
  });
  service = new ConnectionService(app, vault, async url => { browser = url; }, send, { google });
  await service.beginOAuth('gmail', service.view().products[0]!.id, 'Gmail');
  const auth = new URL(browser);
  expect(auth.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly');
  expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
  expect(auth.searchParams.get('client_id')).toBe(google.clientId);
  expect(auth.searchParams.get('client_secret')).toBeNull();
  expect((await fetch(`${CALLBACK_URL}?state=${auth.searchParams.get('state')}&code=fixture`)).status).toBe(200);
  const account = service.accounts()[0]!;
  expect(account.status).toBe('verified'); expect(account.refreshable).toBe(true);
  expect(JSON.parse(vault.get(`account.${account.id}`)!)).toMatchObject({ clientId: google.clientId, clientSecret: google.clientSecret });
});
it('preserves existing manual clients and requires an Ads developer token even with shared Google setup', async () => {
  let browser = '';
  service = new ConnectionService(app, vault, async url => { browser = url; }, undefined, { outlook: { clientId: 'bundled-outlook' }, google });
  service.configureOAuth('outlook', { clientId: 'custom-outlook', clientSecret: '', developerToken: '' });
  await service.beginOAuth('outlook', service.view().products[0]!.id, 'Inbox');
  expect(new URL(browser).searchParams.get('client_id')).toBe('custom-outlook'); service.cancelOAuth();
  expect(service.view().oauthConfigured).not.toContain('google-ads');
  service.configureOAuth('google-ads', { ...google, developerToken: 'ads-token' });
  service.importGoogleClient(download);
  expect(service.view().oauthConfigured).toContain('google-ads');
});

});

describe('shared social accounts and X authorization', () => {
let app: App; let service: ConnectionService; let secrets: Map<string, string>;
let source: ConnectedAccount; let target: string; let browser: string;
let transport: ReturnType<typeof vi.fn<typeof fetch>>;
const save = (account: ConnectedAccount) => app.db.insert(settings).values({ key: 'connections.account.' + account.id, value: account }).onConflictDoUpdate({ target: settings.key, set: { value: account } }).run();
beforeEach(() => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null);
  app = createApp({ databaseUrl: ':memory:', logger: silentLogger }); secrets = new Map(); browser = '';
  transport = vi.fn(async () => Response.json({ data: { id: 'user1', username: 'AIonX' } }));
  service = new ConnectionService(app, { available: () => true, get: key => secrets.get(key), set: (key, value) => { secrets.set(key, value); }, delete: key => { secrets.delete(key); } }, async url => { browser = url; }, transport);
  const products = service.view().products; target = products[1]!.id;
  source = { id: 'brand-x', provider: 'x', productId: products[0]!.id, label: 'Lemonade X', identity: 'AIonX', site: '', username: '', status: 'verified', detail: '', checkedAt: 1, expiresAt: Date.now() + 3600000, refreshable: true, grantedScopes: ['tweet.read', 'users.read', 'offline.access'], createdAt: 1 };
  save(source); secrets.set('account.' + source.id, JSON.stringify({ accessToken: 'original-access', refreshToken: 'original-refresh', clientId: 'client' }));
});
afterEach(() => { service.cancelOAuth(); app.close(); vi.unstubAllEnvs(); __setConfigForTests(null); });

it('shares a single credential, preserves business scope, renames all links and removes credentials only after the last disconnect', async () => {
  const linked = await service.shareSocial(source.productId, source.id, target);
  expect(linked).toMatchObject({ productId: target, credentialId: source.id, grantedScopes: source.grantedScopes });
  expect(secrets.size).toBe(1);
  service.rename(target, linked.id, ' AIonX X ');
  expect(service.accounts().map(a => a.label)).toEqual(['AIonX X', 'AIonX X']);
  expect(() => service.rename(target, source.id, 'Wrong')).toThrow('not found');
  service.disconnect(source.productId, source.id);
  await service.verify(target, linked.id);
  expect(service.accounts()[0]!.status).toBe('verified'); expect(secrets.size).toBe(1);
  service.disconnect(target, linked.id); expect(secrets.size).toBe(0);
});

it('rejects empty or oversized names without changing connections', () => {
  for (const label of ['', '   ', 'x'.repeat(121)]) expect(() => service.rename(source.productId, source.id, label)).toThrow();
  expect(service.accounts()[0]!.label).toBe(source.label);
});
it('links one Stripe credential to both businesses without copying or exposing the key', async () => {
  save({ ...source, provider: 'stripe', label: 'AIonX Stripe', expiresAt: null, refreshable: false });
  const linked = await service.shareAccount(source.productId, source.id, target);
  expect(linked).toMatchObject({ provider: 'stripe', productId: target, credentialId: source.id });
  expect(secrets.size).toBe(1); expect(JSON.stringify(service.view())).not.toContain('original-access');
  await expect(service.shareAccount(source.productId, source.id, target)).rejects.toThrow('already');
  service.disconnect(source.productId, source.id); expect(secrets.size).toBe(1);
});
it('updates and invalidates Facebook posting capability for every business sharing the token', async () => {
  save({ ...source, provider: 'facebook', expiresAt: null, refreshable: false });
  const linked = await service.shareSocial(source.productId, source.id, target);
  transport.mockResolvedValue(Response.json({ id: '1234', name: 'AIonX', category: 'Software', can_post: true }));
  await service.verify(source.productId, source.id);
  expect(service.accounts().every(a => a.facebookPage?.id === '1234' && a.facebookPage.canPost)).toBe(true);
  transport.mockResolvedValue(Response.json({ error: { message: 'original-access' } }, { status: 401 }));
  await service.verify(target, linked.id);
  expect(service.accounts().every(a => a.status === 'attention' && a.facebookPage?.canPost === false)).toBe(true);
  expect(JSON.stringify(service.view())).not.toContain('original-access');
});

it('rejects duplicate sharing, unknown businesses and product-specific website/inbox credentials', async () => {
  await expect(service.shareSocial(source.productId, source.id, source.productId)).rejects.toThrow();
  await expect(service.shareSocial(source.productId, source.id, 'missing')).rejects.toThrow();
  for (const provider of ['signal-blog', 'gmail', 'stripe', 'ga4'] as const) {
    save({ ...source, provider }); await expect(service.shareSocial(source.productId, source.id, target)).rejects.toThrow('social');
  }
  save(source); await service.shareSocial(source.productId, source.id, target);
  await expect(service.shareSocial(source.productId, source.id, target)).rejects.toThrow('already');
  expect(service.accounts()).toHaveLength(2);
});

it('serializes concurrent sharing requests so the target gets only one link', async () => {
  const result = await Promise.allSettled([service.shareSocial(source.productId, source.id, target), service.shareSocial(source.productId, source.id, target)]);
  expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(service.accounts()).toHaveLength(2);
});

it('rotates one session across simultaneous business reads and updates both expiries and scopes', async () => {
  const linked = await service.shareSocial(source.productId, source.id, target);
  for (const a of service.accounts()) save({ ...a, expiresAt: 1 });
  let refreshes = 0;
  transport.mockImplementation(async (url, init) => {
    if (String(url).includes('/token')) { refreshes++; await new Promise(r => setTimeout(r, 10)); return Response.json({ access_token: 'rotated', refresh_token: 'rotated-refresh', expires_in: 3600, scope: 'tweet.read tweet.write users.read offline.access' }); }
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer rotated'); return Response.json({ data: { username: 'AIonX' } });
  });
  await Promise.all([service.verify(source.productId, source.id), service.verify(target, linked.id)]);
  expect(refreshes).toBe(1); expect(secrets.size).toBe(1);
  for (const a of service.accounts()) { expect(a.expiresAt).toBeGreaterThan(Date.now()); expect(a.grantedScopes).toContain('tweet.write'); }
});

it.each([false, true])('does not resurrect a disconnected source after refresh; last link removed=%s', async removeLast => {
  const linked = await service.shareSocial(source.productId, source.id, target);
  save({ ...source, expiresAt: 1 });
  let release!: () => void; let entered!: () => void;
  const started = new Promise<void>(r => { entered = r; });
  transport.mockImplementation(async url => {
    if (String(url).includes('/token')) { entered(); await new Promise<void>(r => { release = r; }); return Response.json({ access_token: 'rotated', refresh_token: 'new-refresh', expires_in: 3600 }); }
    return Response.json({ data: { username: 'AIonX' } });
  });
  const pending = service.verify(source.productId, source.id); await started;
  service.disconnect(source.productId, source.id); if (removeLast) service.disconnect(target, linked.id);
  release(); await pending;
  expect(service.accounts().some(a => a.id === source.id)).toBe(false);
  expect(secrets.size).toBe(removeLast ? 0 : 1);
  if (!removeLast) expect(secrets.get('account.' + source.id)).toContain('new-refresh');
});

it.each(['allowed', 'wrong-user', 'missing-scope', 'cancelled'] as const)('upgrades X posting without changing business links or accepting a different account: %s', async scenario => {
  await service.shareSocial(source.productId, source.id, target);
  service.configureOAuth('x', { clientId: 'client', clientSecret: '', developerToken: '' });
  transport.mockImplementation(async url => String(url).includes('/token') ? Response.json({ access_token: 'posting-access', refresh_token: 'posting-refresh', expires_in: 3600, scope: scenario === 'missing-scope' ? 'tweet.read' : 'tweet.read tweet.write users.read offline.access' }) : Response.json({ data: { username: scenario === 'wrong-user' ? 'AnotherAccount' : 'AIonX' } }));
  await service.authorizeXPosting(source.productId, source.id);
  const auth = new URL(browser); expect(auth.searchParams.get('scope')).toContain('tweet.write'); expect(auth.searchParams.get('scope')).not.toContain('dm.');
  if (scenario === 'cancelled') {
    const response = await fetch(CALLBACK_URL + '?state=' + auth.searchParams.get('state') + '&error=access_denied'); expect(response.status).toBe(200);
  } else {
    const response = await fetch(CALLBACK_URL + '?state=' + auth.searchParams.get('state') + '&code=fixture'); expect(response.status).toBe(scenario === 'allowed' ? 200 : 400);
  }
  expect(service.accounts()).toHaveLength(2);
  expect(secrets.get('account.' + source.id)).toContain(scenario === 'allowed' ? 'posting-access' : 'original-access');
  for (const a of service.accounts()) expect(a.grantedScopes.includes('tweet.write')).toBe(scenario === 'allowed');
});

});
