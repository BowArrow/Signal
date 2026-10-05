import { z } from 'zod';
import type { RuntimeHealth } from './desktop.js';
import type { ConnectedAccount } from './connections.js';
import type { ConversationSnapshot } from './conversations.js';
import { discoveryPolicySchema, type DemandFinding, type DiscoverySnapshot } from './discovery.js';

export const DELIVERY_PROVIDERS = ['signal-blog', 'bluesky', 'linkedin', 'x', 'facebook'] as const;
export function hasPublishingPermission(account: Pick<ConnectedAccount, 'provider' | 'grantedScopes' | 'facebookPage'>): boolean {
  return account.provider === 'linkedin' ? account.grantedScopes.includes('w_member_social')
    : account.provider === 'x' ? account.grantedScopes.includes('tweet.write') : account.provider === 'facebook' ? account.facebookPage?.canPost === true : true;
}
export const operationPolicySchema = z.object({
  mode: z.enum(['publishing', 'acquisition']).optional(),
  ownedAudience: z.boolean().optional(),
  testChannels: z.boolean().optional(),
  replyToRequests: z.boolean().optional(),
  publicReplyLimit: z.number().int().min(1).max(10).optional(),
  objective: z.string().trim().min(10).max(2000),
  accountIds: z.array(z.string().min(1)).max(10).refine(ids => new Set(ids).size === ids.length),
  intervalHours: z.number().int().min(1).max(168),
  dailyLimit: z.number().int().min(1).max(10),
  imageWorkflowId: z.string().min(1).max(200).optional(),
  discovery: discoveryPolicySchema.optional(),
}).strict();
export type OperationPolicy = z.infer<typeof operationPolicySchema>;
export interface OperationLearning {
  version: 1; cycle: number; decidedAt: number; windowStart: number;
  mode: 'explore' | 'build-on' | 'test-interest'; accountId: string; reason: string;
  revenueObservedAt: number | null;
  accounts: { accountId: string; campaigns: number; paidCampaigns: number; retainedPayments: number; paymentsPerCampaign: number }[];
  reference?: { id: string; title: string; description: string; retainedPayments: number };
  traffic?: OperationTraffic;
}
export interface OperationTraffic {
  status: 'usable' | 'unavailable'; detail: string; observedAt: number | null;
  startDate?: string; endDate?: string; timeZone?: string;
  accounts: { accountId: string; campaigns: number; observedCampaigns: number; engagedCampaigns: number; sessions: number; engagedSessions: number; engagedPerCampaign: number }[];
  reference?: { id: string; title: string; description: string; sessions: number; engagedSessions: number };
}
export interface OperationState extends OperationPolicy {
  demandEvidence?: DemandFinding[];
  targetAccountId?: string | null;
  learning?: OperationLearning;
  productId: string; running: boolean; revision: number; authorizedAt: number | null;
  lastCycleAt: number | null; taskId: string | null;
}
export const deliveryInputSchema = z.object({
  demand: z.object({ findingId: z.string().min(1).max(80), reason: z.string().trim().min(20).max(800) }).strict().optional(),
  accountId: z.string().min(1), title: z.string().trim().min(5).max(160),
  description: z.string().trim().min(20).max(320),
  body: z.string().trim().min(20).max(12000),
  evidence: z.array(z.string().url().max(2000)).min(1).max(8),
  visual: z.object({ prompt: z.string().trim().min(40).max(2000) }).strict().optional(),
}).strict();
export type DeliveryInput = z.infer<typeof deliveryInputSchema>;
export interface Delivery extends DeliveryInput {
  reply?: { uri: string; cid: string; authorDid: string; text: string };
  publicationAttempt?: { author: string; startedAt: number; id?: string };
  demandEvidence?: DemandFinding[];
  learning?: OperationLearning;
  image?: {
    workflowId: string; mediaId: string; phase: 'pending' | 'rendering' | 'reviewing' | 'ready' | 'attention';
    detail: string; reviewAttempts: number;
    renderAttempts?: number; feedback?: string; renderPrompt?: string;
    asset?: { sha256: string; width: number; height: number; bytes: number; mime: 'image/jpeg'; alt: string; reviewedAt: number; model: string };
  };
  id: string; productId: string; taskId: string; provider: typeof DELIVERY_PROVIDERS[number];
  revision: number; fingerprint: string; recordKey: string; slug: string; author: string;
  status: 'queued' | 'dispatching' | 'retry' | 'published' | 'attention' | 'cancelled';
  createdAt: number; updatedAt: number; nextAttemptAt: number; attempts: number;
  leaseUntil: number; leaseId: string; detail: string;
  receipt: { id: string; url: string; confirmedAt: number } | null;
}
export interface OperationsView {
  outreachActivity?: { productId: string; leads: number; candidates: number; eligible: number; sent48h: number; pending: number; attention: number; blockers: string[]; draftsForReview?: number; placementsForReview?: number }[];
  conversations?: ConversationSnapshot[];
  acquisitionQueue?: { productId: string; count: number; nextAt: number | null }[];
  acquisition?: AcquisitionCycle[];
  discovery?: DiscoverySnapshot[];
  readiness?: OperationReadiness[];
  prospectSources?: { productId: string; audienceName: string; enabled: boolean; status: string; provider?: 'mailchimp' | 'signal-blog' }[];
  outreachPolicies?: { productId: string; enabled: boolean; dailyLimit: number; followUpDays?: number[] }[];
  imageWorkflows?: { id: string; productId: string; name: string }[];
  handoffs?: { productId: string; open: number; due: number; waiting: number; uncertain: number }[];
  runtimeHealth?: RuntimeHealth;
  emailReplies?: { productId: string; enabled: boolean; dailyLimit: number; followUpDays: number[] }[];
  products: { id: string; name: string }[];
  states: OperationState[]; accounts: ConnectedAccount[]; deliveries: Delivery[];
  tasks: { id: string; productId: string; status: string; error: string | null }[];
  offline: boolean;
}
/** Pending/uncertain work keeps its slot until reconciled, regardless of age. */
export function operationSlots(deliveries: Delivery[], productId: string, now: number): (number | null)[] {
  return deliveries.filter(j => j.productId === productId).flatMap(j => {
    if (['queued', 'dispatching', 'retry', 'attention'].includes(j.status)) return [null];
    const times = [j.receipt?.confirmedAt, j.status === 'cancelled' && j.attempts > 0 ? j.updatedAt : undefined].filter((at): at is number => at !== undefined);
    const at = times.length ? Math.max(...times) : null;
    return at !== null && at > now - 86400000 ? [at + 86400000] : [];
  });
}
export interface AcquisitionCycle {
  learning?: OperationLearning;
  productId: string; taskId: string; revision: number; checkedAt: number;
  status: 'researching' | 'no-fit' | 'awaiting-access' | 'ready' | 'attention';
  detail: string; sourceUrl: string;
  assessments: { findingId: string; suitable: boolean; reason: string; requestQuote: string; productQuote: string; assessedAt?: number }[];
  selectedFindingId?: string;
  accountId?: string;
}
export interface OperationReadiness {
  productId: string; ready: boolean; needsAgents: boolean;
  activities: { label: string; ready: boolean; detail: string }[];
  blockers: string[];
}
export const operationActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('track-conversation'), productId: z.string(), id: z.string(), tracking: z.boolean() }).strict(),
  z.object({ type: z.literal('refresh-conversation'), productId: z.string(), id: z.string() }).strict(),
  z.object({ type: z.literal('review-conversation'), productId: z.string(), id: z.string(), uris: z.array(z.string().max(1000)).max(50) }).strict(),
  z.object({ type: z.literal('configure'), productId: z.string(), value: operationPolicySchema }).strict(),
  z.object({ type: z.literal('run'), productId: z.string() }).strict(),
  z.object({ type: z.literal('pause'), productId: z.string() }).strict(),
  z.object({ type: z.literal('research'), productId: z.string() }).strict(),
  z.object({ type: z.literal('cancel'), productId: z.string(), id: z.string(), acceptUncertain: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('retry'), productId: z.string(), id: z.string() }).strict(),
]);
export type OperationAction = z.infer<typeof operationActionSchema>;
