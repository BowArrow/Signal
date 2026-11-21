import { z } from 'zod/v4';

export const qualificationSchema = z.strictObject({
  qualified: z.boolean(), icp_score: z.number().int().min(0).max(100),
  angle_tag: z.enum(['data_privacy', 'saas_cost_consolidation', 'local_workflow_speed', 'none']),
  specific_pain_point: z.string().max(180),
  recommended_cta: z.enum(['send_guide_link', 'offer_15m_demo', 'direct_trial_download']),
  reasoning: z.string().max(250),
});
export const criticSchema = z.strictObject({
  passed: z.boolean(), word_count: z.number().int().nonnegative(), contains_ai_cliches: z.boolean(),
  references_source_signal: z.boolean(), has_low_friction_cta: z.boolean(),
  violations: z.array(z.string().max(300)).max(10), rewrite_instruction: z.string().max(800).nullable(),
});
export const pipelineDraftSchema = z.strictObject({ subject: z.string().min(5).max(140), body: z.string().min(30).max(1800), product_quote: z.string().min(20).max(400) });
export const replyTriageSchema = z.strictObject({
  intent: z.enum(['INTERESTED_READY', 'OBJECTION_SECURITY', 'OBJECTION_PRICE', 'OBJECTION_TIMING', 'REFERRAL', 'UNSUBSCRIBE_OR_NEGATIVE', 'OTHER']),
  confidence: z.number().min(0).max(1), suggested_reply: z.string().max(2200),
  next_stage: z.enum(['MEETING_BOOKED', 'CHECKOUT_SENT', 'OUTREACH_ACTIVE', 'NURTURE_LATER', 'DISQUALIFIED']),
  requires_human_approval: z.boolean(),
});
export const feedbackRulesSchema = z.strictObject({ rules: z.array(z.string().min(10).max(250)).min(5).max(10) });
export const pipelineStages = ['DISCOVERED', 'ENRICHED', 'QUALIFIED', 'DRAFT_READY', 'OUTREACH_ACTIVE', 'REPLIED', 'MEETING_BOOKED', 'CHECKOUT_SENT', 'CLOSED_WON', 'NURTURE_LATER', 'DISQUALIFIED'] as const;
export type PipelineStage = typeof pipelineStages[number];
export const intentLeadSchema = z.strictObject({
  email: z.email().max(254), name: z.string().trim().min(1).max(200),
  sourceSignal: z.string().trim().min(20).max(1000), sourceUrl: z.url().max(2000),
});
export type IntentLead = z.infer<typeof intentLeadSchema>;
export interface PipelineLead extends IntentLead {
  id: string; productId: string; stage: PipelineStage; revision: number; createdAt: number; updatedAt: number;
  detail: string; requested: boolean; attempts: number; nextAt: number; lease: { token: string; until: number } | null;
  sourceObservedAt?: number;
  qualification?: z.infer<typeof qualificationSchema>;
  draft?: z.infer<typeof pipelineDraftSchema> & { originalBody: string; critic: z.infer<typeof criticSchema>; criticPassed: boolean; observedAt: number; productUrl: string };
  deliveryId?: string; lastMessageId?: string; triage?: z.infer<typeof replyTriageSchema>;
  history: { stage: PipelineStage; at: number; reason: string }[];
}
export interface PipelineInbox {
  productId: string; accountId: string; sender: string; dkimSelector: string; warmupStartedAt: number;
  checkedAt: number | null; spf: boolean; dkim: boolean; dmarc: boolean; detail: string;
}
export interface EmailVerification { email: string; checkedAt: number; status: string; subStatus: string; valid: boolean; }
export interface PipelineRun { id: string; productId: string; leadId: string | null; stage: string; model: string; schemaValid: boolean; retry: number; latencyMs: number; error: string | null; at: number; }
export interface PipelineFeedback { id: string; productId: string; messageId: string; originalDraft: string; finalSent: string; at: number; }
export interface PipelineView {
  offline: boolean; leads: PipelineLead[]; inboxes: PipelineInbox[]; runs: PipelineRun[];
  metrics: { productId: string; leads: number; schemaPassRate: number | null; retries: number; sent: number; positiveReplies: number; positiveReplyRate: number | null; won: number; revenue: number | null; currency: string | null;
    angles: { angle: string; leads: number; sent: number; positiveReplies: number; revenue: number | null; currency: string | null }[] }[];
  verifierConfigured: boolean;
}
const target = { productId: z.string().min(1), id: z.string().min(1), revision: z.number().int().positive() };
export const pipelineActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ingest'), productId: z.string().min(1), value: intentLeadSchema }),
  z.strictObject({ type: z.literal('retry'), ...target }),
  z.strictObject({ type: z.literal('pause'), ...target }),
  z.strictObject({ type: z.literal('edit'), ...target, subject: z.string().trim().min(5).max(140), body: z.string().trim().min(30).max(1800) }),
  z.strictObject({ type: z.literal('approve'), ...target, policyRevision: z.number().int(), sender: z.email(), reviewed: z.literal(true) }),
  z.strictObject({ type: z.literal('verify-email'), ...target }),
  z.strictObject({ type: z.literal('approve-reply'), ...target, body: z.string().trim().min(20).max(2200), reviewed: z.literal(true) }),
  z.strictObject({ type: z.literal('configure-inbox'), productId: z.string().min(1), accountId: z.string().min(1), sender: z.email(), dkimSelector: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), warmupStartedAt: z.number().int().nonnegative() }),
  z.strictObject({ type: z.literal('check-dns'), productId: z.string().min(1), accountId: z.string().min(1) }),
  z.strictObject({ type: z.literal('suppress-domain'), productId: z.string().min(1), domain: z.string().regex(/^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/), reason: z.string().trim().min(5).max(500) }),
  z.strictObject({ type: z.literal('distill'), productId: z.string().min(1) }),
]);
export type PipelineAction = z.infer<typeof pipelineActionSchema>;
