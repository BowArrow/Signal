import { beforeEach, expect, it, vi } from 'vitest';
import { searchBlueskyRequests } from '../../src/core/operations/bluesky-discovery.js';
import { deliver } from '../../src/core/operations/delivery.js';
import type { Delivery } from '../../src/shared/operations.js';
import type { ConnectedAccount } from '../../src/shared/connections.js';

const buyer = 'did:plc:buyer', actor = 'did:plc:business', cid = 'bafyre' + 'a'.repeat(40);
const uri = `at://${buyer}/app.bsky.feed.post/abc123`;
const text = 'Can anyone recommend a tool for working with my local PDF documents on Windows?';
const account = { id: 'account', provider: 'bluesky' } as ConnectedAccount;
let now: number, post: Record<string, unknown>, job: Delivery, written: Record<string, unknown> | undefined, writes: number, loseResponse: boolean, paused: boolean;
let transport: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  now = Date.now(); written = undefined; writes = 0; loseResponse = false; paused = false;
  post = { uri, cid, author: { did: buyer }, record: { $type: 'app.bsky.feed.post', text, createdAt: new Date(now - 60000).toISOString() } };
  job = { id: 'delivery', productId: 'product', accountId: 'account', provider: 'bluesky', recordKey: 'ourreply', body: 'Our app: Try one document and check the cited passage. https://siplemona.de/', createdAt: now, reply: { uri, cid, authorDid: buyer, text } } as Delivery;
  transport = vi.fn(async (input, init) => {
    const url = new URL(String(input)); expect(url.origin).toBe('https://bsky.social'); expect(init?.redirect).toBe('error');
    if (url.pathname.endsWith('searchPosts')) return Response.json({ posts: [post] });
    if (url.pathname.endsWith('getSession')) return Response.json({ did: actor });
    if (url.pathname.endsWith('getPostThread')) return Response.json({ thread: { post } });
    if (url.pathname.endsWith('getRecord')) return written ? Response.json({ uri: `at://${actor}/app.bsky.feed.post/ourreply`, value: written }) : Response.json({ error: 'RecordNotFound' }, { status: 404 });
    if (url.pathname.endsWith('createRecord')) {
      expect(init?.method).toBe('POST'); writes++; written = JSON.parse(String(init?.body)).record;
      if (loseResponse) throw Error('Response lost after acceptance');
      return Response.json({ uri: `at://${actor}/app.bsky.feed.post/ourreply`, cid });
    }
    throw Error('Unexpected endpoint');
  });
});
const search = () => searchBlueskyRequests('fixture', 'recommend PDF', now, new AbortController().signal, () => {}, transport);
const send = () => deliver(account, { accessToken: 'fixture' }, job, transport, new AbortController().signal, () => { if (paused) throw Error('Paused'); });

it('searches through the connected endpoint and attaches an immutable original-post reference', async () => {
  expect(await search()).toMatchObject([{ kind: 'bluesky', url: `https://bsky.app/profile/${buyer}/post/${uri.split('/').at(-1)}`, excerpt: text, reply: { uri, cid, authorDid: buyer } }]); expect(writes).toBe(0);
  expect(String(transport.mock.calls[0]![0])).toContain('since=');
});
it('keeps a concrete work problem without requiring a canned recommendation question', async () => {
  (post.record as Record<string, unknown>).text = 'My project notes and reports are scattered across different apps. I need to find the original sources.';
  expect(await search()).toHaveLength(1); expect(writes).toBe(0);
});
it('excludes the casual summarize question at discovery', async () => {
  (post.record as Record<string, unknown>).text = "What's happening? Can someone summarize?";
  expect(await search()).toEqual([]); expect(writes).toBe(0);
});
it('finds requests beyond a first page of news and deduplicates repeated posts', async () => {
  transport.mockResolvedValueOnce(Response.json({ posts: [{ ...post, record: { ...(post.record as object), text: 'News about PDFs.' } }], cursor: 'page2' }));
  transport.mockResolvedValueOnce(Response.json({ posts: [post, post], cursor: 'page2' }));
  expect(await search()).toHaveLength(1);
  expect(transport).toHaveBeenCalledTimes(2);
  expect(String(transport.mock.calls[1]![0])).toContain('cursor=page2');
  expect(writes).toBe(0);
});
it('bounds pagination and checks account access before reading the next page', async () => {
  let count = 0;
  transport.mockImplementation(async () => Response.json({ posts: [post], cursor: String(++count) }));
  expect(await search()).toHaveLength(1); expect(count).toBe(3);
  count = 0;
  await expect(searchBlueskyRequests('fixture', 'recommend PDF', now, new AbortController().signal, () => { if (count === 1) throw Error('Account disconnected'); }, transport)).rejects.toThrow('Account disconnected');
  expect(count).toBe(1);
});
it.each(['reply', 'restricted', 'labelled', 'stale', 'invalid-id', 'not-a-request', 'no-pitches'] as const)('excludes %s search results', async kind => {
  const record = post.record as Record<string, unknown>;
  if (kind === 'reply') record.reply = { root: { uri, cid } };
  if (kind === 'restricted') post.viewer = { replyDisabled: true };
  if (kind === 'labelled') post.labels = [{ val: 'spam' }];
  if (kind === 'stale') record.createdAt = new Date(now - 8 * 86400000).toISOString();
  if (kind === 'invalid-id') post.uri = 'https://evil.example';
  if (kind === 'not-a-request') record.text = 'We launched another PDF app today.';
  if (kind === 'no-pitches') record.text = text + ' No promotion please.';
  expect(await search()).toEqual([]); expect(writes).toBe(0);
});
it('posts an actual reply with parent and root, then reconciles it without another write', async () => {
  expect(await send()).toMatchObject({ id: `at://${actor}/app.bsky.feed.post/ourreply`, url: `https://bsky.app/profile/${actor}/post/ourreply` });
  expect(written?.reply).toEqual({ root: { uri, cid }, parent: { uri, cid } });
  await send(); expect(writes).toBe(1);
});
it('reconciles a lost response without duplicating the reply', async () => {
  loseResponse = true; await expect(send()).rejects.toThrow('interrupted'); await send(); expect(writes).toBe(1);
});
it.each(['changed-cid', 'changed-text', 'restricted', 'gate', 'blocked', 'labelled', 'stale', 'future', 'self', 'paused'] as const)('does not post to a %s request', async kind => {
  if (kind === 'changed-cid') post.cid = 'bafyre' + 'b'.repeat(40);
  if (kind === 'changed-text') (post.record as Record<string, unknown>).text = 'Please stop replying.';
  if (kind === 'restricted') post.viewer = { replyDisabled: true };
  if (kind === 'gate') post.threadgate = { record: { allow: [] } };
  if (kind === 'blocked') post.author = { did: buyer, viewer: { blockedBy: true } };
  if (kind === 'labelled') post.labels = [{ val: 'spam' }];
  if (kind === 'stale') (post.record as Record<string, unknown>).createdAt = new Date(now - 8 * 86400000).toISOString();
  if (kind === 'future') (post.record as Record<string, unknown>).createdAt = new Date(now + 86400000).toISOString();
  if (kind === 'self') job.reply!.authorDid = actor;
  if (kind === 'paused') paused = true;
  await expect(send()).rejects.toThrow(); expect(writes).toBe(0);
});
it('refuses to reconcile a different target as this reply', async () => {
  await send(); (written!.reply as { parent: { cid: string } }).parent.cid = 'different'; await expect(send()).rejects.toThrow('intended public request'); expect(writes).toBe(1);
});
