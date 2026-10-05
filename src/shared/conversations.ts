export interface ConversationReply {
  uri: string; url: string; authorDid: string; handle: string;
  text: string; postedAt: number; originalAuthor: boolean;
}
export interface ConversationSnapshot {
  productId: string; deliveryId: string;
  archivedAt?: number | null;
  archiveReason?: 'owner' | 'not-found' | null;
  status: 'not-checked' | 'current' | 'unavailable' | 'error';
  checkedAt: number | null; lastAttemptAt: number | null;
  detail: string; replies: ConversationReply[]; reviewedUris: string[];
}
export { blueskyPostUrl } from './bluesky-url.js';
