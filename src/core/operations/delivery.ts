import { z } from 'zod';
import twitterText from 'twitter-text';
import type { ConnectedAccount } from '../../shared/connections.js';
import type { Delivery } from '../../shared/operations.js';
import type { AccountCredential } from '../connections/providers.js';
import { boundedJson } from '../connections/network.js';
import { imageCid, imageDigest } from './images.js';
import { blueskyReferenceSchema } from './bluesky-discovery.js';
import { blueskyPostUrl } from '../../shared/bluesky-url.js';

export class DeliveryError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); }
}
export interface PublicationJournal {
  started(author: string): void;
  rejected(): void;
  accepted(id: string): void;
}
const object = z.record(z.unknown());
/** Immutable IDs and read-before-write reconciliation make retries safe after a lost response. */
export async function deliver(account: ConnectedAccount, credential: AccountCredential, job: Delivery, transport: typeof fetch, signal: AbortSignal, canWrite: () => void, loadImage?: () => Buffer, journal?: PublicationJournal): Promise<{ id: string; url: string }> {
  const request = async (url: string, body?: unknown) => {
    signal.throwIfAborted();
    if (body !== undefined) canWrite();
    try {
      return await transport(url, { method: body === undefined ? 'GET' : account.provider === 'signal-blog' ? 'PUT' : 'POST', redirect: 'error', headers: { authorization: `Bearer ${credential.accessToken}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
    } catch { throw new DeliveryError('Delivery was interrupted. Reconcile the same publication before retrying.', true); }
  };
  const read = async (response: Response) => {
    if (!response.ok) throw new DeliveryError(`Delivery provider returned HTTP ${response.status}.`, response.status === 429 || response.status >= 500 || response.status === 409);
    try { return await boundedJson(response); } catch { throw new DeliveryError('Delivery response could not be confirmed. Reconciliation is required.', true); }
  };
  if (account.provider === 'facebook') {
    const pageId = account.facebookPage?.id;
    if (!pageId || !/^\d{1,30}$/.test(pageId) || !account.facebookPage?.canPost) throw new DeliveryError('Check this Facebook Page in Connections before posting.');
    if (job.image || job.visual) throw new DeliveryError('Facebook currently supports text and links; remove the image request.');
    if (job.body.length > 5000) throw new DeliveryError('Keep Facebook campaign posts within 5,000 characters.');
    const validId = (id: string) => new RegExp(`^${pageId}_\\d{1,30}$`).test(id);
    const receipt = (id: string) => ({ id, url: `https://www.facebook.com/permalink.php?story_fbid=${id.split('_')[1]}&id=${pageId}` });
    if (job.publicationAttempt?.id) {
      if (job.publicationAttempt.author !== pageId || !validId(job.publicationAttempt.id)) throw new DeliveryError('Saved Facebook receipt does not match this Page.');
      return receipt(job.publicationAttempt.id);
    }
    if (job.publicationAttempt) throw new DeliveryError('Facebook may already have accepted this post. Check the Page; Signal will not resend an uncertain post.');
    const profile = await read(await request('https://graph.facebook.com/v24.0/me?fields=id,name,category,can_post'));
    if (profile.id !== pageId || typeof profile.category !== 'string' || !profile.category || profile.can_post !== true) throw new DeliveryError('Facebook Page identity or posting capability changed. Check this connection again.');
    if (!journal) throw new DeliveryError('A persistent publication record is required before posting to Facebook.');
    signal.throwIfAborted(); canWrite(); journal.started(pageId);
    let response: Response;
    try {
      response = await transport(`https://graph.facebook.com/v24.0/${pageId}/feed`, { method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${credential.accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ message: job.body, published: true }), signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
    } catch { throw new DeliveryError('Facebook delivery was interrupted after sending began. Check the Page; Signal will not resend this uncertain post.'); }
    let result: Record<string, unknown> | undefined;
    try { result = await boundedJson(new Response(response.body, { status: 200 })); } catch { /* Preserve the uncertain attempt. */ }
    const error = z.object({ code: z.number().int() }).safeParse(result?.error);
    // Only documented authentication, permission, parameter and rate-limit errors
    // clear the send marker. Duplicate and server errors remain uncertain.
    if (!response.ok && error.success && [4, 10, 17, 32, 100, 190, 200, 613].includes(error.data.code) && [400, 401, 403, 429].includes(response.status)) {
      journal.rejected(); throw new DeliveryError(`Facebook rejected publication (code ${error.data.code}). Check the Page token, pages_manage_posts permission and Page posting access.`, [4, 17, 32, 613].includes(error.data.code));
    }
    if (!response.ok || typeof result?.id !== 'string' || !validId(result.id)) throw new DeliveryError('Facebook did not return a valid publication receipt. Check the Page; Signal will not resend this uncertain post.');
    journal.accepted(result.id); return receipt(result.id);
  }
  if (account.provider === 'x') {
    if (!account.grantedScopes.includes('tweet.write')) throw new DeliveryError('Reconnect X with publishing access before posting.');
    if (job.image || job.visual) throw new DeliveryError('X currently supports text and links; remove the image request.');
    if (!twitterText.parseTweet(job.body).valid) throw new DeliveryError('X posts must fit within 280 weighted characters including links.');
    const idSchema = z.string().regex(/^\d{1,30}$/);
    const receipt = (id: string) => ({ id, url: `https://x.com/i/web/status/${id}` });
    if (job.publicationAttempt?.id) {
      if (!idSchema.safeParse(job.publicationAttempt.id).success) throw new DeliveryError('Saved X receipt is invalid. Review this publication.');
      return receipt(job.publicationAttempt.id);
    }
    if (job.publicationAttempt) throw new DeliveryError('X may already have accepted this post. Check your profile, then stop retrying this delivery. Signal will not resend an uncertain post.');
    const profile = await read(await request('https://api.x.com/2/users/me'));
    const user = z.object({ id: idSchema }).safeParse(profile.data);
    if (!user.success) throw new DeliveryError('X did not identify the signed-in user. Reconnect this account.');
    if (!journal) throw new DeliveryError('A persistent publication record is required before posting to X.');
    signal.throwIfAborted(); canWrite(); journal.started(user.data.id);
    let response: Response;
    try {
      response = await transport('https://api.x.com/2/tweets', { method: 'POST', redirect: 'error',
        headers: { authorization: `Bearer ${credential.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ text: job.body }), signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      });
    } catch { throw new DeliveryError('X delivery was interrupted after the send began. Check your profile; Signal will not resend this uncertain post.'); }
    // A 403 can also represent duplicate content. Preserve uncertainty for that
    // response rather than treating every forbidden response as safe to resend.
    if ([400, 401, 402, 404, 429].includes(response.status)) {
      void response.body?.cancel().catch(() => {});
      journal.rejected(); throw new DeliveryError(`X rejected publication (HTTP ${response.status}). Check publishing access, API credits or the account limit.`, response.status === 429);
    }
    let result: Record<string, unknown> | undefined;
    try { if (response.status === 201) result = await boundedJson(response); else await response.body?.cancel(); } catch { /* Keep the durable uncertain attempt. */ }
    const accepted = z.object({ id: idSchema }).safeParse(result?.data);
    if (!accepted.success) throw new DeliveryError('X did not provide a valid publication receipt. Check your profile; Signal will not resend this uncertain post.');
    journal.accepted(accepted.data.id);
    return receipt(accepted.data.id);
  }
  if (account.provider === 'linkedin') {
    if (!account.grantedScopes.includes('w_member_social')) throw new DeliveryError('Reconnect LinkedIn with publishing access before posting.');
    if (job.image || job.visual) throw new DeliveryError('LinkedIn currently supports text and links; remove the image request.');
    if (job.body.length > 3000) throw new DeliveryError('LinkedIn posts must fit within 3,000 characters including tracking links.');
    const receipt = (id: string) => ({ id, url: `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}/` });
    if (job.publicationAttempt?.id) {
      if (!/^urn:li:(?:share|ugcPost):\d{1,30}$/.test(job.publicationAttempt.id)) throw new DeliveryError('Saved LinkedIn receipt is invalid. Review this publication.');
      return receipt(job.publicationAttempt.id);
    }
    if (job.publicationAttempt) throw new DeliveryError('LinkedIn may already have accepted this post. Check your LinkedIn profile, then stop retrying this delivery. Signal will not resend an uncertain post.');
    const profile = await read(await request('https://api.linkedin.com/v2/userinfo'));
    const subject = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).safeParse(profile.sub);
    if (!subject.success) throw new DeliveryError('LinkedIn did not identify the signed-in member. Reconnect this account.');
    if (!journal) throw new DeliveryError('A persistent publication record is required before posting to LinkedIn.');
    const author = `urn:li:person:${subject.data}`;
    const body = JSON.stringify({ author, lifecycleState: 'PUBLISHED',
      specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: job.body }, shareMediaCategory: 'NONE' } },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    });
    signal.throwIfAborted(); canWrite(); journal.started(author);
    let response: Response;
    try {
      response = await transport('https://api.linkedin.com/v2/ugcPosts', { method: 'POST', redirect: 'error',
        headers: { authorization: `Bearer ${credential.accessToken}`, 'content-type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' }, body,
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      });
    } catch { throw new DeliveryError('LinkedIn delivery was interrupted after the send began. Check your profile; Signal will not resend this uncertain post.'); }
    void response.body?.cancel().catch(() => {});
    // These explicit rejections establish that this request did not create a post.
    // Conflict, duplicate, server-error, malformed and lost responses stay uncertain.
    if ([400, 401, 403, 404, 429].includes(response.status)) {
      journal.rejected(); throw new DeliveryError(`LinkedIn rejected publication (HTTP ${response.status}). Check publishing permission or the account limit.`, response.status === 429);
    }
    const id = response.headers.get('x-restli-id');
    if (response.status !== 201 || !id || !/^urn:li:(?:share|ugcPost):\d{1,30}$/.test(id)) throw new DeliveryError('LinkedIn did not provide a valid publication receipt. Check your profile; Signal will not resend this uncertain post.');
    journal.accepted(id);
    return receipt(id);
  }
  if (account.provider === 'signal-blog') {
    if (!['https://siplemona.de', 'https://cinegenaimedia.com'].includes(account.site)) throw new DeliveryError('Unknown website destination.');
    const endpoint = `${account.site}/api/content/posts`;
    const prior = await request(`${endpoint}?slug=${encodeURIComponent(job.slug)}`);
    if (prior.ok) {
      const post = await read(prior);
      if (post.slug !== job.slug || post.title !== job.title || post.description !== job.description || post.author !== job.author || post.body !== job.body || post.status !== 'published') throw new DeliveryError('The destination already contains different content. Review it before changing anything.');
      return { id: job.slug, url: `${account.site}/writing/${job.slug}` };
    }
    if (prior.status !== 404) await read(prior);
    let missing: unknown;
    try { missing = await prior.json(); } catch { throw new DeliveryError('Website lookup did not confirm a missing article.', true); }
    if (object.parse(missing).error !== 'Post not found') throw new DeliveryError('Website lookup did not confirm a missing article.');
    const result = await read(await request(endpoint, { slug: job.slug, title: job.title, description: job.description, author: job.author, body: job.body, status: 'published', expectedVersion: 0 }));
    if (result.slug !== job.slug || result.status !== 'published' || !Number.isInteger(result.version) || Number(result.version) < 1) throw new DeliveryError('Website did not confirm publication. Reconciliation is required.', true);
    return { id: job.slug, url: `${account.site}/writing/${job.slug}` };
  }
  if (account.provider === 'bluesky') {
    const endpoint = 'https://bsky.social/xrpc/';
    const session = await read(await request(`${endpoint}com.atproto.server.getSession`));
    const did = z.string().regex(/^did:(plc|web):[A-Za-z0-9._:%-]+$/).parse(session.did);
    const target = job.reply ? blueskyReferenceSchema.parse({ uri: job.reply.uri, cid: job.reply.cid, authorDid: job.reply.authorDid }) : undefined;
    if (target && (target.authorDid === did || !target.uri.startsWith(`at://${target.authorDid}/`))) throw new DeliveryError('The request belongs to this account or has an invalid author.');
    const reply = target ? { root: { uri: target.uri, cid: target.cid }, parent: { uri: target.uri, cid: target.cid } } : undefined;
    const uri = `at://${did}/app.bsky.feed.post/${job.recordKey}`;
    const url = blueskyPostUrl(uri);
    if (!url) throw new DeliveryError('Invalid Bluesky post identifier.');
    const asset = job.image?.asset;
    if (job.visual && (!asset || job.image?.phase !== 'ready')) throw new DeliveryError('Campaign image has not passed visual review.');
    const embed = asset ? { $type: 'app.bsky.embed.images', images: [{ alt: asset.alt, image: { $type: 'blob', ref: { $link: imageCid(asset.sha256) }, mimeType: asset.mime, size: asset.bytes }, aspectRatio: { width: asset.width, height: asset.height } }] } : undefined;
    const lookup = `${endpoint}com.atproto.repo.getRecord?${new URLSearchParams({ repo: did, collection: 'app.bsky.feed.post', rkey: job.recordKey })}`;
    const prior = await request(lookup);
    if (prior.ok) {
      const record = await read(prior); const value = object.parse(record.value);
      if (record.uri !== uri || value.text !== job.body || value.createdAt !== new Date(job.createdAt).toISOString()) throw new DeliveryError('A different Bluesky record occupies this publication ID.');
      if (reply) {
        const ref = z.object({ uri: z.string(), cid: z.string() }); const existing = z.object({ root: ref, parent: ref }).safeParse(value.reply);
        if (!existing.success || JSON.stringify(existing.data) !== JSON.stringify(reply)) throw new DeliveryError('The existing reply does not match the intended public request.');
      } else if (value.reply !== undefined) throw new DeliveryError('An unexpected reply exists on this Bluesky post.');
      if (embed) {
        const parsed = z.object({ $type: z.literal('app.bsky.embed.images'), images: z.array(z.object({ alt: z.string(), image: z.object({ $type: z.literal('blob'), ref: z.object({ $link: z.string() }), mimeType: z.string(), size: z.number() }), aspectRatio: z.object({ width: z.number(), height: z.number() }) })).length(1) }).safeParse(value.embed);
        if (!parsed.success || JSON.stringify(parsed.data) !== JSON.stringify(embed)) throw new DeliveryError('The existing Bluesky image does not match the approved campaign.');
      } else if (value.embed !== undefined) throw new DeliveryError('An unexpected embed exists on this Bluesky post.');
      return { id: uri, url };
    }
    if (![400, 404].includes(prior.status)) await read(prior);
    let missing: unknown;
    try { missing = await prior.json(); } catch { throw new DeliveryError('Bluesky lookup did not confirm a missing post.', true); }
    if (object.parse(missing).error !== 'RecordNotFound') throw new DeliveryError('Bluesky lookup did not confirm a missing post.');
    if (target) {
      const thread = await read(await request(`${endpoint}app.bsky.feed.getPostThread?${new URLSearchParams({ uri: target.uri, depth: '1', parentHeight: '0' })}`));
      const post = z.object({ thread: z.object({ post: z.object({ uri: z.string(), cid: z.string(), author: z.object({ did: z.string(), viewer: z.object({ blockedBy: z.boolean().optional(), blocking: z.string().optional(), muted: z.boolean().optional() }).optional() }), record: z.object({ text: z.string(), createdAt: z.string(), reply: z.unknown().optional() }), viewer: z.object({ replyDisabled: z.boolean().optional(), threadMuted: z.boolean().optional() }).optional(), threadgate: z.object({ record: z.object({ allow: z.unknown().optional() }).optional() }).optional(), labels: z.array(z.unknown()).optional() }) }) }).safeParse(thread);
      if (!post.success) throw new DeliveryError('The original request is deleted, blocked or unavailable.');
      const current = post.data.thread.post;
      if (current.uri !== target.uri || current.cid !== target.cid || current.author.did !== target.authorDid || current.record.text !== job.reply!.text || current.record.reply || current.viewer?.replyDisabled || current.viewer?.threadMuted || current.threadgate?.record?.allow !== undefined || current.author.viewer?.blockedBy || current.author.viewer?.blocking || current.author.viewer?.muted || current.labels?.length) throw new DeliveryError('The public request changed or does not permit this reply.');
      if (!Number.isFinite(Date.parse(current.record.createdAt)) || Date.parse(current.record.createdAt) < Date.now() - 7 * 86400000 || Date.parse(current.record.createdAt) > Date.now() + 60000) throw new DeliveryError('The public request is no longer recent.');
      if (job.image) throw new DeliveryError('Initial public replies do not attach promotional images.');
    }
    if (asset && embed) {
      canWrite(); signal.throwIfAborted(); const bytes = loadImage?.();
      if (!bytes || bytes.length !== asset.bytes || bytes.length > 1000000 || imageDigest(bytes) !== asset.sha256) throw new DeliveryError('The saved campaign image is missing or changed.');
      let uploaded: Response;
      try { uploaded = await transport(`${endpoint}com.atproto.repo.uploadBlob`, { method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${credential.accessToken}`, 'content-type': asset.mime }, body: new Uint8Array(bytes), signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) }); }
      catch { throw new DeliveryError('Image upload was interrupted. The same image and post ID will be reconciled.', true); }
      const result = await read(uploaded);
      const blob = z.object({ $type: z.literal('blob'), ref: z.object({ $link: z.string() }), mimeType: z.string(), size: z.number() }).safeParse(result.blob);
      if (!blob.success || JSON.stringify(blob.data) !== JSON.stringify(embed.images[0]!.image)) throw new DeliveryError('The provider did not confirm the exact approved image.');
    }
    const facets = [...job.body.matchAll(/https:\/\/[^\s<>]+/g)].map(match => ({ index: { byteStart: Buffer.byteLength(job.body.slice(0, match.index), 'utf8'), byteEnd: Buffer.byteLength(job.body.slice(0, match.index! + match[0].length), 'utf8') }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: match[0] }] }));
    const result = await read(await request(`${endpoint}com.atproto.repo.createRecord`, { repo: did, collection: 'app.bsky.feed.post', rkey: job.recordKey, validate: true, record: { $type: 'app.bsky.feed.post', text: job.body, createdAt: new Date(job.createdAt).toISOString(), facets, ...(embed ? { embed } : {}), ...(reply ? { reply } : {}) } }));
    if (result.uri !== uri || typeof result.cid !== 'string' || !result.cid) throw new DeliveryError('Bluesky did not confirm the requested post. Reconciliation is required.', true);
    return { id: uri, url };
  }
  throw new DeliveryError('This account does not have a delivery adapter yet.');
}
