import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { App } from '../app.js';
import { settings } from '../db/schema.js';
import { requireProduct } from '../marketing/store.js';
import { boundedJson } from '../connections/network.js';
import type { Delivery } from '../../shared/operations.js';
import { blueskyPostUrl, type ConversationReply, type ConversationSnapshot } from '../../shared/conversations.js';

const PREFIX = 'operations.conversation.';
const INTERVAL = 15 * 60000;
const nodeSchema = z.object({
  post: z.object({ uri: z.string(), author: z.object({ did: z.string(), handle: z.string().max(253) }),
    record: z.object({ text: z.string().max(3000), createdAt: z.string().datetime({ offset: true }),
      reply: z.object({ parent: z.object({ uri: z.string() }) }).optional() }) }),
  replies: z.array(z.unknown()).max(1000).optional(),
});

/** Read-only monitoring of confirmed replies. No accounts, inboxes or leads are created. */
export class ConversationTracker {
  private active = new Map<string, { productId: string; controller: AbortController; promise: Promise<void> }>();
  constructor(private readonly app: App, private readonly deliveries: () => Delivery[], private readonly transport: typeof fetch = fetch) {}
  private eligible() { return this.deliveries().filter(d => d.provider === 'bluesky' && d.status === 'published' && d.reply && d.receipt && blueskyPostUrl(d.receipt.id)); }
  private job(productId: string, id: string) {
    requireProduct(this.app, productId);
    const job = this.eligible().find(d => d.id === id && d.productId === productId);
    if (!job) throw new Error('Confirmed conversation not found for this business.');
    return job;
  }
  snapshot(job: Delivery): ConversationSnapshot {
    const row = this.app.db.select().from(settings).where(eq(settings.key, PREFIX + job.id)).get()?.value as ConversationSnapshot | undefined;
    return row?.productId === job.productId && row.deliveryId === job.id ? row : {
      productId: job.productId, deliveryId: job.id, status: 'not-checked', checkedAt: null, lastAttemptAt: null,
      detail: 'Reply was published. Responses have not been checked yet.', replies: [], reviewedUris: [],
    };
  }
  view() { return this.eligible().slice(0, 100).map(job => this.snapshot(job)); }
  track(productId: string, id: string, tracking: boolean) {
    const snapshot = this.snapshot(this.job(productId, id));
    this.active.get(id)?.controller.abort();
    this.save({ ...snapshot, archivedAt: tracking ? null : this.app.clock.now(),
      archiveReason: tracking ? null : 'owner',
      ...(tracking ? { lastAttemptAt: null } : {}),
      detail: tracking ? 'Tracking resumed. Waiting for the next response check.' : 'Tracking stopped by you. The publication receipt and saved responses remain in history.' });
  }
  private missing(job: Delivery, now: number) {
    this.save({ ...this.snapshot(job), lastAttemptAt: now, status: 'unavailable', archivedAt: now, archiveReason: 'not-found',
      detail: 'Bluesky reports this reply was not found. Tracking stopped automatically. The publication receipt is retained; Signal will not repost it.' });
  }
  private save(snapshot: ConversationSnapshot) {
    this.app.db.insert(settings).values({ key: PREFIX + snapshot.deliveryId, value: snapshot, updatedAt: this.app.clock.now() })
      .onConflictDoUpdate({ target: settings.key, set: { value: snapshot, updatedAt: this.app.clock.now() } }).run();
  }
  reviewed(productId: string, id: string, uris: string[]) {
    const snapshot = this.snapshot(this.job(productId, id));
    const visible = new Set(snapshot.replies.map(reply => reply.uri));
    if (uris.some(uri => !visible.has(uri))) throw new Error('Only observed responses can be marked reviewed.');
    this.save({ ...snapshot, reviewedUris: [...new Set([...snapshot.reviewedUris, ...uris])].slice(-100) });
  }
  async tick() {
    if (this.app.env.SIGNAL_OFFLINE === '1' || this.active.size) return;
    const now = this.app.clock.now();
    const next = this.eligible().filter(job => this.snapshot(job).archivedAt == null && this.app.operations?.state(job.productId).running && job.receipt!.confirmedAt > now - 30 * 86400000)
      .sort((a, b) => (this.snapshot(a).lastAttemptAt ?? 0) - (this.snapshot(b).lastAttemptAt ?? 0))
      .find(job => this.snapshot(job).lastAttemptAt === null || now - this.snapshot(job).lastAttemptAt! >= INTERVAL);
    if (next) await this.refresh(next.productId, next.id);
  }
  refresh(productId: string, id: string): Promise<void> {
    if (this.app.env.SIGNAL_OFFLINE === '1') return Promise.reject(new Error('Turn off offline mode to check conversations.'));
    const job = this.job(productId, id);
    if (this.snapshot(job).archivedAt != null) return Promise.resolve();
    const existing = this.active.get(id); if (existing) return existing.promise;
    // A manual refresh still respects a short cooldown.
    if (this.snapshot(job).lastAttemptAt !== null && this.app.clock.now() - this.snapshot(job).lastAttemptAt! < 60000) return Promise.resolve();
    const controller = new AbortController();
    const promise = this.read(job, controller.signal).finally(() => { this.active.delete(id); });
    this.active.set(id, { productId, controller, promise }); return promise;
  }
  private async read(job: Delivery, signal: AbortSignal) {
    const before = this.snapshot(job), now = this.app.clock.now();
    this.save({ ...before, lastAttemptAt: now });
    try {
      const uri = job.receipt!.id;
      const url = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread');
      url.search = new URLSearchParams({ uri, depth: '2', parentHeight: '0' }).toString();
      const response = await this.transport(url, { method: 'GET', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
      if (response.status === 400 || response.status === 404) {
        const error = await boundedJson(new Response(response.body, { status: 200 }));
        if (['NotFound', 'RecordNotFound'].includes(String(error['error']))) {
          signal.throwIfAborted();
          this.missing(job, now); return;
        }
        throw new Error('Thread lookup failed');
      }
      const data = await boundedJson(response);
      signal.throwIfAborted(); this.job(job.productId, job.id);
      const root = nodeSchema.safeParse(data['thread']);
      if (!root.success) {
        const unavailable = z.object({ $type: z.enum(['app.bsky.feed.defs#notFoundPost', 'app.bsky.feed.defs#blockedPost']) }).safeParse(data['thread']);
        if (!unavailable.success) throw new Error('Malformed conversation response');
        if (unavailable.data.$type === 'app.bsky.feed.defs#notFoundPost') { this.missing(job, now); return; }
        this.save({ ...this.snapshot(job), lastAttemptAt: now, status: 'unavailable', detail: 'The public thread is unavailable. Showing the last saved responses, if any.' }); return;
      }
      if (root.data.post.uri !== uri) throw new Error('Conversation identity mismatch');
      const ownDid = uri.split('/')[2]!;
      if (root.data.post.author.did !== ownDid) throw new Error('Conversation author mismatch');
      const incoming = new Map<string, ConversationReply>();
      const pending = (root.data.replies ?? []).map(raw => ({ raw, parent: uri, depth: 1 }));
      let visited = 0;
      while (pending.length && visited++ < 100) {
        const item = pending.shift()!, parsed = nodeSchema.safeParse(item.raw); if (!parsed.success) continue;
        const node = parsed.data, post = node.post, link = blueskyPostUrl(post.uri), postedAt = Date.parse(post.record.createdAt);
        if (!link || !post.uri.startsWith('at://' + post.author.did + '/') || post.record.reply?.parent.uri !== item.parent || postedAt > now + 60000) continue;
        if (post.author.did !== ownDid && incoming.size < 50) incoming.set(post.uri, { uri: post.uri, url: link, authorDid: post.author.did, handle: post.author.handle, text: post.record.text, postedAt, originalAuthor: post.author.did === job.reply!.authorDid });
        if (item.depth < 2) pending.push(...(node.replies ?? []).slice(0, 100).map(raw => ({ raw, parent: post.uri, depth: item.depth + 1 })));
      }
      // Keep already reviewed IDs if a user marked an older response during the fetch.
      this.save({ ...this.snapshot(job), status: 'current', lastAttemptAt: now, checkedAt: now,
        replies: [...incoming.values()].sort((a, b) => a.postedAt - b.postedAt),
        detail: 'Checked public responses up to two reply levels. This is a bounded view; open the live thread for the full conversation.' });
    } catch {
      if (!signal.aborted) this.save({ ...this.snapshot(job), lastAttemptAt: now, status: 'error', detail: 'Could not refresh the public thread. Saved responses remain visible; try again later.' });
    }
  }
  pause(productId: string) { for (const active of this.active.values()) if (active.productId === productId) active.controller.abort(); }
  async stop() { for (const active of this.active.values()) active.controller.abort(); await Promise.allSettled([...this.active.values()].map(active => active.promise)); }
}
