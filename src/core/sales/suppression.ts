import { createHash } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import type { App } from '../app.js';
import { settings } from '../db/schema.js';
import { mailboxAddress } from './inbox.js';
import { pipelineSuppressed } from './pipeline-deliverability.js';

export function suppressionKey(productId: string, email: string) { return 'sales.suppression.' + createHash('sha256').update(`${productId}:${email}`).digest('hex'); }
export function isSalesSuppressed(app: App, productId: string, email: string) {
  const normalized = mailboxAddress(email);
  return Boolean(normalized && (pipelineSuppressed(app, normalized) || app.db.select().from(settings).where(eq(settings.key, suppressionKey(productId, normalized))).get()
    || app.db.select().from(settings).where(like(settings.key, 'sales.suppression.%')).all().some(row => (row.value as { email?: string }).email?.toLowerCase() === normalized)));
}
