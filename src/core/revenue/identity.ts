import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Exact normalized mailbox only: no name, domain, plus-tag or Gmail-dot guessing. */
export function purchaseContactHash(accountId: string, email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  if (!z.string().email().max(254).safeParse(normalized).success) return null;
  return createHash('sha256').update(JSON.stringify(['signal-purchase-contact-v1', accountId, normalized])).digest('hex');
}

export function purchaseIdentity(accountId: string, emails: unknown[]) {
  const supplied = emails.filter(value => value !== null && value !== undefined && value !== '');
  const hashes = supplied.map(value => purchaseContactHash(accountId, value));
  const unique = new Set(hashes);
  return { contactHash: hashes.length > 0 && !unique.has(null) && unique.size === 1 ? hashes[0]! : null,
    contactMatch: !hashes.length ? 'missing' as const : unique.has(null) || unique.size !== 1 ? 'conflicting' as const : 'available' as const };
}
