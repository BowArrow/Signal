import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { App } from '../app.js';
import { settings } from '../db/schema.js';
import { mailboxAddress } from './inbox.js';

export function suppressionKey(productId: string, email: string) { return 'sales.suppression.' + createHash('sha256').update(`${productId}:${email}`).digest('hex'); }
export function isSalesSuppressed(app: App, productId: string, email: string) {
  const normalized = mailboxAddress(email);
  return Boolean(normalized && app.db.select().from(settings).where(eq(settings.key, suppressionKey(productId, normalized))).get());
}
