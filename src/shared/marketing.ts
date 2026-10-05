import { z } from 'zod';

const text = z.string().trim().min(1).max(4000);
const cents = z.number().int().min(0).max(100_000_000);
export const localUrl = z.string().url().refine((s) => {
  const u = new URL(s);
  return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && !u.username && !u.password && !u.search && !u.hash;
}, 'Use a local HTTP server on localhost or 127.0.0.1');
export const marketingSettingsSchema = z.object({
  model: z.string().trim().min(1).max(150),
  enabled: z.boolean(), intervalHours: z.number().int().min(1).max(168),
  voice: text, reinvestPct: z.number().int().min(0).max(100),
  reserveCents: cents, capCents: cents,
  comfyUrl: localUrl, searxUrl: z.union([z.literal(''), localUrl]),
}).strict();
export type MarketingSettings = z.infer<typeof marketingSettingsSchema>;
export const memoryInputSchema = z.object({
  title: z.string().trim().min(1).max(200), body: text,
  kind: z.enum(['product', 'audience', 'observation', 'hypothesis', 'lesson', 'preference', 'source']),
  source: text, confidence: z.number().min(0).max(1),
  supersedesId: z.string().optional(),
}).strict();
export const requestInputSchema = z.object({
  title: z.string().trim().min(1).max(160), problem: text, rationale: text,
  acceptance: z.array(text).min(1).max(8), evidence: z.array(text).min(1).max(8),
  workaround: text, metric: text, priority: z.enum(['now', 'next', 'later']),
  channelKey: z.string().max(80),
}).strict();
export type EngineeringInput = z.infer<typeof requestInputSchema>;
export const draftInputSchema = z.object({
  title: z.string().trim().min(1).max(160), body: text,
  kind: z.enum(['reply', 'article', 'email', 'social', 'demo']),
  targetUrl: z.string().url().or(z.literal('')), evidence: z.array(text).max(8),
}).strict();
export const cashInputSchema = z.object({
  reference: z.string().trim().min(1).max(160),
  kind: z.enum(['settled_surplus', 'adjustment', 'spend']), amountCents: cents,
  note: text,
}).strict();
export const marketingActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chat'), productId: text, message: text }).strict(),
  z.object({ type: z.literal('cycle'), productId: text }).strict(),
  z.object({ type: z.literal('settings'), value: marketingSettingsSchema }).strict(),
  z.object({ type: z.literal('cash'), productId: text, value: cashInputSchema }).strict(),
  z.object({ type: z.literal('memory'), productId: text, value: memoryInputSchema }).strict(),
  z.object({ type: z.literal('forget'), productId: text, id: text }).strict(),
  z.object({ type: z.literal('requestStatus'), productId: text, id: text, status: z.enum(['proposed', 'accepted', 'building', 'shipped', 'dismissed']) }).strict(),
  z.object({ type: z.literal('draftStatus'), productId: text, id: text, status: z.enum(['draft', 'approved', 'published', 'rejected']), publishedUrl: z.string().url().optional() }).strict(),
  z.object({ type: z.literal('draftEdit'), productId: text, id: text, body: text }).strict(),
  z.object({ type: z.literal('workflow'), productId: text, name: text, workflow: z.record(z.unknown()) }).strict(),
  z.object({ type: z.literal('media'), productId: text, workflowId: text, prompt: text }).strict(),
  z.object({ type: z.literal('reserve'), productId: text, amountCents: cents, reference: text, note: text }).strict(),
  z.object({ type: z.literal('release'), productId: text, id: text }).strict(),
]);
export type MarketingAction = z.infer<typeof marketingActionSchema>;
export interface MemoryView {
  id: string; productId: string; title: string; body: string; kind: string; source: string;
  confidence: number; status: string; createdAt: number; supersedesId: string | null;
}
export interface MarketingView {
  settings: MarketingSettings;
  products: { id: string; name: string; url: string; currency: string; budget: BudgetView }[];
  messages: { id: string; productId: string; role: string; body: string; taskId: string | null; createdAt: number }[];
  memories: MemoryView[];
  edges: { id: string; productId: string; fromId: string; toId: string; relation: string }[];
  requests: { id: string; productId: string; status: string; value: EngineeringInput; createdAt: number }[];
  drafts: { id: string; productId: string; status: string; value: z.infer<typeof draftInputSchema>; publishedUrl: string | null; createdAt: number }[];
  cash: { id: string; productId: string; kind: string; amountCents: number; reference: string; note: string; createdAt: number }[];
  commitments: { id: string; productId: string; amountCents: number; reference: string; note: string; status: string }[];
  tools: { id: string; productId: string; taskId: string; name: string; status: string; result: string; createdAt: number }[];
  workflows: { id: string; productId: string; name: string }[];
  media: { id: string; productId: string; promptId: string | null; status: string; prompt: string; error: string | null; outputs: { filename: string; subfolder: string; type: string; nodeId: string }[]; createdAt: number }[];
  tasks: { id: string; productId: string; status: string; error: string | null; updatedAt: number }[];
}
export interface BudgetView {
  surplusCents: number; allocationCents: number; committedCents: number;
  spentCents: number; availableCents: number; tier: 'bootstrap' | 'organic' | 'funded-tests' | 'repeatable';
  explanation: string;
}
