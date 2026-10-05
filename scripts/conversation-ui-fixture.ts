import type { App } from '../src/core/app.js';
import { settings } from '../src/core/db/schema.js';
import type { Delivery } from '../src/shared/operations.js';
import type { ConversationSnapshot } from '../src/shared/conversations.js';

export function seedConversations(app: App, productId: string) {
  const now = Date.now();
  for (const unavailable of [false, true]) {
    const id = unavailable ? 'removed-thread' : 'active-thread';
    const uri = 'at://did:plc:fixture/app.bsky.feed.post/' + id;
    const job: Delivery = { id, productId, accountId: 'fixture-blue', taskId: id, provider: 'bluesky', revision: 1,
      fingerprint: id, recordKey: id, slug: id, author: 'Lemonade team', status: 'published', attempts: 1,
      createdAt: now, updatedAt: now, nextAttemptAt: now, leaseUntil: 0, leaseId: '',
      title: unavailable ? 'Earlier reply, now unavailable' : 'Comparing project documents',
      description: 'A conversation about a specific document task.', body: 'Start with one report and check the cited source. (Lemonade team)',
      evidence: ['https://siplemona.de/'], detail: 'Publication receipt retained.',
      reply: { uri: 'at://did:plc:buyer/app.bsky.feed.post/question', cid: 'fixture', authorDid: 'did:plc:buyer', text: 'My project notes and reports are in different files. How can I compare them without re-reading everything?' },
      receipt: { id: uri, url: 'https://bsky.app/profile/did:plc:fixture/post/' + id, confirmedAt: now },
    };
    const snapshot: ConversationSnapshot = { productId, deliveryId: id, status: unavailable ? 'unavailable' : 'current',
      ...(unavailable ? { archivedAt: now, archiveReason: 'not-found' as const } : {}),
      checkedAt: now, lastAttemptAt: now, detail: unavailable ? 'The published reply is no longer available publicly. The original send receipt is retained.' : 'Checked public responses.',
      reviewedUris: [], replies: unavailable ? [] : [{ uri: 'at://did:plc:buyer/app.bsky.feed.post/reply', url: 'https://bsky.app/profile/did:plc:buyer/post/reply', authorDid: 'did:plc:buyer', handle: 'buyer.bsky.social', text: 'Can I compare PDF and Word files together?', postedAt: now, originalAuthor: true }],
    };
    app.db.insert(settings).values({ key: 'operations.delivery.' + id, value: job }).run();
    app.db.insert(settings).values({ key: 'operations.conversation.' + id, value: snapshot }).run();
  }
}
