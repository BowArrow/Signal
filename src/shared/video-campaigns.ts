import { z } from 'zod';

export const videoCampaignPolicySchema = z.object({
  enabled: z.boolean(), intervalHours: z.number().int().min(24).max(168),
  objective: z.string().trim().min(20).max(1200),
}).strict();
export type VideoCampaignPolicy = z.infer<typeof videoCampaignPolicySchema> & { productId: string };
export interface VideoCampaignCycle {
  id: string; productId: string; objective: string; createdAt: number;
  shotTaskId: string; adTaskId?: string;
  completedAt?: number;
}
export interface VideoCampaignStatus {
  productId: string; enabled: boolean; ready: boolean; detail: string;
  cycle?: VideoCampaignCycle; shotId?: string; adId?: string;
}
export interface VideoCampaignView { policies: VideoCampaignPolicy[]; statuses: VideoCampaignStatus[]; }
