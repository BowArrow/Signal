import { z } from 'zod';
import type { ConnectedAccount } from './connections.js';
import type { VideoAsset } from './video.js';

export const youtubePolicySchema = z.object({
  enabled: z.boolean(), accountId: z.string().max(100),
  privacy: z.enum(['private', 'unlisted', 'public']), dailyLimit: z.number().int().min(1).max(3),
  autoQueue: z.boolean(), madeForKids: z.boolean(), containsSyntheticMedia: z.boolean(),
}).strict();
export type YoutubePolicyInput = z.infer<typeof youtubePolicySchema>;
export interface YoutubePolicy extends YoutubePolicyInput { productId: string; revision: number; configuredAt: number; channelId: string; channelTitle: string; }
export const youtubeMetadataSchema = z.object({
  title: z.string().trim().min(1).max(100).refine(s => !/[<>]/.test(s)),
  description: z.string().trim().max(5000).refine(s => !/[<>]/.test(s) && new TextEncoder().encode(s).length <= 5000, 'YouTube descriptions must fit 5,000 UTF-8 bytes.'),
}).strict();
export type YoutubeMetadata = z.infer<typeof youtubeMetadataSchema>;
export interface YoutubeDelivery {
  id: string; productId: string; sourceId: string; accountId: string; channelId: string; revision: number;
  asset: VideoAsset; approvedAt: number; metadata: YoutubeMetadata;
  privacy: YoutubePolicy['privacy']; madeForKids: boolean; containsSyntheticMedia: boolean;
  status: 'queued' | 'uploading' | 'processing' | 'delivered' | 'attention' | 'cancelled';
  createdAt: number; updatedAt: number; startedAt?: number; bytesSent: number; failures: number; nextCheckAt: number;
  leaseId?: string; leaseUntil: number; videoId?: string; detail: string;
  receipt?: { id: string; url: string; privacy: YoutubePolicy['privacy']; confirmedAt: number };
}
export interface YoutubeView { policies: YoutubePolicy[]; jobs: YoutubeDelivery[]; accounts: Pick<ConnectedAccount, 'id' | 'productId' | 'label' | 'status' | 'grantedScopes'>[]; }
export function youtubeCanUpload(account: Pick<ConnectedAccount, 'grantedScopes'>) {
  return account.grantedScopes.some(s => ['youtube.upload', 'youtube', 'youtube.force-ssl', 'youtubepartner'].some(scope => s === 'https://www.googleapis.com/auth/' + scope));
}
