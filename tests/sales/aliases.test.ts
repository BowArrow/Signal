import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { fixedClock, DAY } from '../../src/core/lib/clock.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { ConnectionService, type CredentialVault } from '../../src/core/connections/service.js';
import { SalesService } from '../../src/core/sales/service.js';
import { settings } from '../../src/core/db/schema.js';

const primary = 'owner@example.org'; const lemonade = 'sales@aionx.aionapp.org'; const cinegen = 'sales@outreach.cinegenaimedia.com';
let app: App; let sales: SalesService; let connections: ConnectionService; let clock: ReturnType<typeof fixedClock>;
let first: string; let second: string; let firstAccount: string; let secondAccount: string;
let accepted: boolean; let records: ReturnType<typeof mail>[]; let send: ReturnType<typeof vi.fn<typeof fetch>>;
function mail(id: string, to: string, extra: { name: string; value: string }[] = [], body = 'Can I try this product?') {
  return { id, threadId: `thread-${id}`, internalDate: String(clock.now() - 1000), labelIds: ['INBOX'], payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'buyer@example.org' }, { name: 'To', value: to }, { name: 'Message-ID', value: `<${id}@example.org>` }, ...extra], body: { data: Buffer.from(body).toString('base64url') } } };
}
beforeEach(async () => {
  vi.stubEnv('SIGNAL_OFFLINE', '0'); __setConfigForTests(null); clock = fixedClock(1789700000000); app = createApp({ databaseUrl: ':memory:', clock, logger: silentLogger }); accepted = true; records = [];
  const stored = new Map<string, string>(); const vault: CredentialVault = { available: () => true, get: key => stored.get(key), set: (key, value) => { stored.set(key, value); }, delete: key => { stored.delete(key); } };
  send = vi.fn(async (input, init) => {
    expect(init?.method ?? 'GET').toBe('GET'); const url = new URL(String(input));
    if (url.pathname.endsWith('/profile')) return Response.json({ emailAddress: primary });
    if (url.pathname.endsWith('/settings/sendAs')) return Response.json({ sendAs: [{ sendAsEmail: primary, isPrimary: true }, { sendAsEmail: lemonade, verificationStatus: accepted ? 'accepted' : 'pending' }, { sendAsEmail: cinegen, verificationStatus: 'accepted' }] });
    // Return even nonmatching records to prove the local header guard, not only q.
    if (url.pathname.endsWith('/messages')) return Response.json({ messages: records.map(row => ({ id: row.id })) });
    const found = records.find(row => url.pathname.endsWith(`/${row.id}`));
    if (found) return Response.json(found); throw new Error('Unexpected request');
  });
  connections = new ConnectionService(app, vault, undefined, send); app.connections = connections;
  [first, second] = connections.view().products.map(p => p.id) as [string, string];
  await connections.connect({ provider: 'gmail', productId: first, label: 'Gmail', credential: 'fixture-private-token' }); firstAccount = connections.accounts()[0]!.id;
  await connections.reuseGmail(first, firstAccount, second); secondAccount = connections.accounts().find(a => a.productId === second)!.id;
  sales = new SalesService(app); app.sales = sales;
});
afterEach(async () => { await sales.stop(); app.close(); vi.unstubAllEnvs(); __setConfigForTests(null); });
const config = (accountId: string, senderEmail?: string) => ({ accountId, since: clock.now() - DAY, autoSync: true, aiTriage: false, ...(senderEmail ? { senderEmail } : {}) });
it('reuses one Gmail account without OAuth or plaintext credential copies in metadata', async () => {
  expect(connections.accounts()).toHaveLength(2); expect(firstAccount).not.toBe(secondAccount);
  expect(connections.accounts().map(a => a.identity)).toEqual([primary, primary]);
  expect(JSON.stringify(app.db.select().from(settings).all())).not.toContain('fixture-private-token');
  await expect(connections.reuseGmail(first, firstAccount, second)).rejects.toThrow('already linked');
  await expect(connections.reuseGmail(second, firstAccount, second)).rejects.toThrow('not found');
  connections.disconnect(first, firstAccount);
  expect((await connections.gmailSenders(second, secondAccount)).some(row => row.email === cinegen && row.verified)).toBe(true);
});
it('routes two aliases separately and scopes opt-outs without reading unrelated message bodies into storage', async () => {
  await sales.configureVerified(first, config(firstAccount, lemonade)); await sales.configureVerified(second, config(secondAccount, cinegen));
  records = [mail('lemonade', lemonade, [], 'Please stop contacting me.'), mail('cinegen', cinegen), mail('personal', primary)];
  await sales.sync(first, firstAccount); await sales.sync(second, secondAccount);
  expect(sales.messages(first).map(row => row.providerId)).toEqual(['lemonade']); expect(sales.messages(second).map(row => row.providerId)).toEqual(['cinegen']);
  expect(sales.isSuppressed(first, 'buyer@example.org')).toBe(true); expect(sales.isSuppressed(second, 'buyer@example.org')).toBe(false);
  expect(sales.sender(first, firstAccount)).toBe(lemonade); expect(sales.sender(second, secondAccount)).toBe(cinegen);
  expect(send.mock.calls.some(([url]) => new URL(String(url)).searchParams.get('q')?.includes(`to:${lemonade}`))).toBe(true);
});
it.each(['cc', 'bcc', 'two-to', 'duplicate-to', 'wrong-to', 'missing-to'])('does not route ambiguous or different-address mail: %s', async kind => {
  await sales.configureVerified(first, config(firstAccount, lemonade));
  const record = mail('ambiguous', kind === 'two-to' ? `${lemonade}, ${cinegen}` : kind === 'wrong-to' ? cinegen : lemonade);
  if (kind === 'cc' || kind === 'bcc') record.payload.headers.push({ name: kind, value: cinegen });
  if (kind === 'duplicate-to') record.payload.headers.push({ name: 'To', value: lemonade });
  if (kind === 'missing-to') record.payload.headers = record.payload.headers.filter(header => header.name !== 'To');
  records = [record]; await sales.sync(first, firstAccount); expect(sales.messages(first)).toHaveLength(0);
});
it('rejects pending, missing, unverified and stale sender choices', async () => {
  expect(() => sales.configure(first, config(firstAccount, lemonade))).toThrow('Refresh Gmail');
  accepted = false; await expect(sales.configureVerified(first, config(firstAccount, lemonade))).rejects.toThrow('Refresh Gmail');
  await expect(sales.configureVerified(first, config(firstAccount, 'invented@example.org'))).rejects.toThrow('Refresh Gmail');
  accepted = true; await connections.gmailSenders(first, firstAccount); clock.advance(16 * 60000);
  expect(() => sales.configure(first, config(firstAccount, lemonade))).toThrow('Refresh Gmail');
});
it('retains the whole-inbox collision guard and rejects duplicate sender routes', async () => {
  sales.configure(first, config(firstAccount));
  await expect(sales.configureVerified(second, config(secondAccount, cinegen))).rejects.toThrow('already configured');
  await sales.configureVerified(first, config(firstAccount, lemonade));
  await expect(sales.configureVerified(second, config(secondAccount, lemonade))).rejects.toThrow('already configured');
  expect(() => sales.configure(second, config(secondAccount))).toThrow('already configured');
  await sales.configureVerified(second, config(secondAccount, cinegen)); expect(sales.sources()).toHaveLength(2);
});
it('accepts the authenticated primary address when Google omits its verification status', async () => {
  await sales.configureVerified(first, config(firstAccount, primary));
  expect(sales.sender(first, firstAccount)).toBe(primary);
});
