import { z } from 'zod';
import type { ConnectedAccount } from './connections.js';

export const audienceId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const prospectProvider = z.enum(['mailchimp', 'signal-blog']);
export const prospectConfigSchema = z.object({
  accountId: z.string().min(1).max(100), listId: audienceId, enabled: z.boolean(),
  businessConfirmed: z.boolean(), marketingPermissionId: z.string().trim().max(100),
  provider: prospectProvider.optional(),
}).strict().refine(v => !v.enabled || v.businessConfirmed, 'Confirm this audience belongs to the selected business.').refine(v => v.provider !== 'signal-blog' || (v.listId === 'website' && v.marketingPermissionId === ''), 'Website requests use the website source and its recorded consent.');
export type ProspectConfig = z.infer<typeof prospectConfigSchema>;
export interface ProspectState extends ProspectConfig {
  productId: string; revision: number; audienceName: string;
  status: 'idle' | 'syncing' | 'partial' | 'current' | 'attention'; detail: string;
  watermark: number; scanSince: number; scanUntil: number | null; offset: number;
  lastCompleteAt: number | null; lastFullAt: number | null; nextAttemptAt: number;
  scanned: number; added: number; suppressed: number;
  websiteCursor?: number; websiteHead?: number | null;
}
export interface MailchimpAudience { id: string; name: string }
export interface MailchimpMember {
  id: string; email: string; name: string; listId: string; status: string;
  oneToOne: boolean; optedAt: string; changedAt: string;
  permissions: { id: string; enabled: boolean }[];
  notes?: string; campaignId?: string; consentText?: string;
}
export interface ProspectView { offline: boolean; accounts: ConnectedAccount[]; sources: ProspectState[] }
export const prospectActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('configure'), productId: z.string().min(1), value: prospectConfigSchema }).strict(),
  z.object({ type: z.literal('sync'), productId: z.string().min(1), provider: prospectProvider.optional() }).strict(),
]);
export type ProspectAction = z.infer<typeof prospectActionSchema>;
