import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { settings } from '../../src/core/db/schema.js';
import { ConnectionService, type CredentialVault } from '../../src/core/connections/service.js';
import { parseConnectionApps, parseGoogleDesktopClient } from '../../src/core/connections/app-config.js';

const google = { clientId: 'signal-fixture.apps.googleusercontent.com', clientSecret: 'desktop-client-fixture' };
const download = { installed: { client_id: google.clientId, client_secret: google.clientSecret, project_id: 'signal-fixture', auth_uri: 'https://accounts.google.com/o/oauth2/auth', token_uri: 'https://oauth2.googleapis.com/token', redirect_uris: ['http://localhost'] } };
let app: App; let service: ConnectionService; let values: Map<string, string>; let vault: CredentialVault;
beforeEach(() => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null);
  app = createApp({ databaseUrl: ':memory:', logger: silentLogger }); values = new Map();
  vault = { available: () => true, get: key => values.get(key), set: (key, value) => { values.set(key, value); }, delete: key => { values.delete(key); } };
  service = new ConnectionService(app, vault); service.view();
});
afterEach(() => { service.cancelOAuth(); app.close(); vi.unstubAllEnvs(); __setConfigForTests(null); });

it('enables Google services with one import, without exposing client credentials or granting mailbox access', () => {
  service.importGoogleClient(download);
  const view = service.view();
  expect(view.oauthConfigured).toEqual(expect.arrayContaining(['gmail', 'youtube', 'ga4', 'search-console']));
  expect(view.oauthConfigured).not.toContain('google-ads');
  expect(view.oauthConfigured).not.toContain('outlook');
  expect(view.accounts).toHaveLength(0);
  expect(JSON.stringify(view)).not.toContain(google.clientSecret);
  expect(JSON.stringify(view)).not.toContain(google.clientId);
  expect(JSON.stringify(app.db.select().from(settings).all())).not.toContain(google.clientSecret);
  expect(new ConnectionService(app, vault).view().oauthManaged).toContain('gmail');
});
it.each([
  { web: download.installed }, { type: 'service_account', private_key: 'private-fixture' },
  { installed: { ...download.installed, token_uri: 'https://attacker.example/token' } },
  { installed: { ...download.installed, auth_uri: 'https://attacker.example/authorize' } },
  { installed: { ...download.installed, client_id: 'not-google' } },
  { installed: { ...download.installed, client_secret: '' } },
])('rejects unsupported Google credential downloads without leaking their contents: %#', input => {
  expect(() => service.importGoogleClient(input)).toThrow('Google Desktop app');
  expect(values.size).toBe(0);
  expect(() => parseGoogleDesktopClient(input)).not.toThrow(/private-fixture|desktop-client-fixture/);
});
it('refuses confidential-provider secrets and arbitrary providers in the distributed manifest', () => {
  expect(() => parseConnectionApps({ linkedin: { clientId: 'a', clientSecret: 'private' } })).toThrow('native/public');
  expect(() => parseConnectionApps({ outlook: { clientId: 'a', clientSecret: 'private' } })).toThrow('native/public');
  expect(() => parseConnectionApps({ google: { ...google, accessToken: 'private' } })).toThrow('native/public');
  expect(parseConnectionApps({ google, outlook: { clientId: 'microsoft-public' }, x: { clientId: 'x-public' }, reddit: { clientId: 'reddit-installed' } })).toHaveProperty('google.clientId', google.clientId);
});
it('lists accepted and pending Gmail aliases without activating sending or crossing business boundaries', async () => {
  const send = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(init?.method ?? 'GET').toBe('GET'); expect(init?.redirect).toBe('error');
    return Response.json(String(url).endsWith('/settings/sendAs') ? { sendAs: [
      { sendAsEmail: 'owner@example.org', isPrimary: true, verificationStatus: 'accepted' },
      { sendAsEmail: 'sales@example.org', verificationStatus: 'accepted' },
      { sendAsEmail: 'pending@example.org', verificationStatus: 'pending' },
    ] } : { emailAddress: 'owner@example.org' });
  });
  service = new ConnectionService(app, vault, undefined, send);
  const productId = service.view().products[0]!.id;
  await service.connect({ provider: 'gmail', productId, label: 'Inbox', credential: 'private-token' });
  const account = service.accounts()[0]!;
  const result = await service.gmailAliases(productId, account.id);
  expect(result.rows).toHaveLength(3);
  expect(result.rows[1]!.detail).toContain('Select this address in Sales');
  expect(result.rows[2]!.detail).toBe('Not verified for sending in Gmail.');
  expect(service.accounts()[0]).toEqual(account);
  await expect(service.gmailAliases(service.view().products[1]!.id, account.id)).rejects.toThrow('not found');
});
