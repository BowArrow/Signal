import { z } from 'zod';
import { channelKeySchema, type ChannelKey } from './growth.js';

const text = z.string().trim().min(1).max(4000);
export const ASSET_KINDS = ['landing-page', 'article', 'email', 'social', 'sales-message', 'video-script', 'image-prompt', 'press-pitch', 'event-plan'] as const;
export const brandSchema = z.object({
  audience: text, problem: text, offer: text, proof: text, voice: text,
  constraints: text, visualStyle: text,
}).strict();
export type BrandProfile = z.infer<typeof brandSchema>;
export const briefSchema = z.object({
  title: z.string().trim().min(1).max(160), channel: channelKeySchema,
  objective: text, audience: text, offer: text,
  formats: z.array(z.enum(ASSET_KINDS)).min(1).max(6).refine(values => new Set(values).size === values.length, 'Choose each format once'),
  experimentId: z.string().max(100).default(''),
}).strict();
export type CampaignBrief = z.infer<typeof briefSchema>;
export const studioCopySchema = z.object({
  title: z.string().trim().min(1).max(200), body: z.string().trim().min(80).max(20000),
  rationale: text, evidence: z.array(z.string().max(1000)).max(12),
  reviewNotes: z.array(text).min(1).max(8),
}).strict();
export type StudioCopy = z.infer<typeof studioCopySchema>;
export const leadSchema = z.object({
  name: z.string().trim().min(1).max(200), contact: z.string().max(300),
  stage: z.enum(['discovered', 'contacted', 'replied', 'qualified', 'trial', 'customer', 'lost']),
  permission: z.enum(['unknown', 'opted-in', 'existing-conversation', 'do-not-contact']),
  source: text, notes: z.string().max(4000), followUpAt: z.number().int().min(0).nullable(), campaignId: z.string().max(100),
}).strict();
export type StudioLead = z.infer<typeof leadSchema>;
export const outcomeSchema = z.object({
  reference: z.string().trim().min(1).max(200), campaignId: z.string().min(1).max(100),
  kind: z.enum(['visits', 'leads', 'activations', 'sale', 'refund', 'spend', 'retained']),
  count: z.number().int().min(1).max(100000000), amountCents: z.number().int().min(0).max(100000000),
  source: text, occurredAt: z.number().int().min(0),
}).strict().superRefine((value, ctx) => {
  if (!['sale', 'refund', 'spend'].includes(value.kind) && value.amountCents !== 0) ctx.addIssue({ code: 'custom', message: 'Only sales, refunds and spend have monetary amounts.' });
});
export type StudioOutcome = z.infer<typeof outcomeSchema>;
export const studioActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('brand'), productId: text, value: brandSchema }).strict(),
  z.object({ type: z.literal('campaign'), productId: text, value: briefSchema }).strict(),
  z.object({ type: z.literal('generate'), productId: text, id: text }).strict(),
  z.object({ type: z.literal('edit'), productId: text, id: text, body: z.string().trim().min(80).max(20000) }).strict(),
  z.object({ type: z.literal('review'), productId: text, id: text, approved: z.boolean(), checks: z.array(z.enum(['claims', 'voice', 'destination'])).max(3) }).strict(),
  z.object({ type: z.literal('schedule'), productId: text, id: text, dueAt: z.number().int().min(0).nullable(), destination: z.string().max(1000) }).strict(),
  z.object({ type: z.literal('published'), productId: text, id: text, url: z.string().url(), note: text }).strict(),
  z.object({ type: z.literal('lead'), productId: text, id: z.string().optional(), value: leadSchema }).strict(),
  z.object({ type: z.literal('outcomes'), productId: text, values: z.array(outcomeSchema).min(1).max(500) }).strict(),
]);
export type StudioAction = z.infer<typeof studioActionSchema>;
export interface StudioAssetView {
  id: string; productId: string; campaignId: string; kind: typeof ASSET_KINDS[number]; copy: StudioCopy;
  status: string; warnings: string[]; dueAt: number | null; destination: string; publishedUrl: string | null;
}
export interface StudioCampaignView {
  id: string; productId: string; brief: CampaignBrief; trackedUrl: string; createdAt: number;
  task: { id: string; status: string; error: string | null } | null;
  totals: { visits: number; leads: number; activations: number; sales: number; retained: number; revenueCents: number; refundCents: number; spendCents: number };
}
export interface StudioView {
  products: { id: string; name: string; currency: string; url: string; brand: BrandProfile }[];
  campaigns: StudioCampaignView[]; assets: StudioAssetView[];
  leads: { id: string; productId: string; value: StudioLead }[];
  outcomes: { id: string; productId: string; value: StudioOutcome }[];
}
export interface ChannelPlaybook {
  channel: ChannelKey; bestFor: string; firstTest: string; steps: string[];
  materials: typeof ASSET_KINDS[number][]; measure: string; stopRule: string; sourceUrls: string[];
}
