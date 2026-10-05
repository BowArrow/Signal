import { createHash } from 'node:crypto';
import { z } from 'zod';
import { buyerIntent } from '../../shared/buyer-intent.js';
import { boundedJson } from '../connections/network.js';
import type { DemandFinding } from '../../shared/discovery.js';
import { blueskyPostUrl } from '../../shared/bluesky-url.js';

export const blueskyReferenceSchema = z.object({ uri: z.string().regex(/^at:\/\/did:(?:plc|web):[A-Za-z0-9._:%-]+\/app\.bsky\.feed\.post\/[A-Za-z0-9._~-]{1,100}$/), cid: z.string().regex(/^b[a-z2-7]{20,150}$/), authorDid: z.string().regex(/^did:(?:plc|web):[A-Za-z0-9._:%-]+$/) }).strict();
const postSchema = z.object({ uri: z.string(), cid: z.string(), author: z.object({ did: z.string() }), record: z.object({ $type: z.literal('app.bsky.feed.post'), text: z.string().max(3000), createdAt: z.string().datetime({ offset: true }), reply: z.unknown().optional() }), viewer: z.object({ replyDisabled: z.boolean().optional() }).optional(), labels: z.array(z.unknown()).optional() });
export async function searchBlueskyRequests(token: string, query: string, now: number, signal: AbortSignal, allowed: () => void, transport: typeof fetch): Promise<DemandFinding[]> {
  z.string().min(3).max(160).parse(query); signal.throwIfAborted(); allowed();
  const url = new URL('https://bsky.social/xrpc/app.bsky.feed.searchPosts');
  url.search = new URLSearchParams({ q: query, sort: 'latest', limit: '100', since: new Date(now - 7 * 86400000).toISOString() }).toString();
  const findings = new Map<string, DemandFinding>();
  const cursors = new Set<string>();
  // A single short page of broad keywords is dominated by news and promotions.
  // Read a bounded window, preserving cancellation and account checks per page.
  for (let page = 0; page < 3; page++) {
  signal.throwIfAborted(); allowed();
  const response = await transport(url, { method: 'GET', redirect: 'error', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
  const result = z.object({ posts: z.array(z.unknown()).max(100), cursor: z.string().max(2000).optional() }).parse(await boundedJson(response));
  signal.throwIfAborted(); allowed();
  for (const raw of result.posts) {
    const parsed = postSchema.safeParse(raw); if (!parsed.success) continue; const post = parsed.data;
    const ref = blueskyReferenceSchema.safeParse({ uri: post.uri, cid: post.cid, authorDid: post.author.did });
    // Initial reach is limited to original, unrestricted requests.
    if (!ref.success || post.record.reply || post.viewer?.replyDisabled || post.labels?.length || !post.uri.startsWith(`at://${post.author.did}/`)) continue;
    const postedAt = Date.parse(post.record.createdAt); if (postedAt < now - 7 * 86400000 || postedAt > now + 60000) continue;
    const text = post.record.text;
    if (buyerIntent(text) === 'insufficient-context') continue;
    if (/\b(?:no (?:ads|bots|promotion|AI)|do not (?:pitch|promote)|don['’]t (?:pitch|promote))\b/i.test(text)) continue;
    const postUrl = blueskyPostUrl(post.uri); if (!postUrl) continue;
    findings.set(post.uri, { id: createHash('sha256').update(post.uri).digest('hex').slice(0, 24), kind: 'bluesky', url: postUrl, title: text.slice(0, 240), excerpt: text, postedAt, observedAt: now, query: `bluesky:${query}`, requestLanguage: true, reply: ref.data });
  }
  if (!result.posts.length || !result.cursor || cursors.has(result.cursor)) break;
  cursors.add(result.cursor); url.searchParams.set('cursor', result.cursor);
  }
  return [...findings.values()];
}
