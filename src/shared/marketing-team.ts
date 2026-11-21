import { z } from 'zod';
import type { OperationPolicy } from './operations.js';
import type { Delivery } from './operations.js';

const text = z.string().trim().min(1).max(4000);
export const TEAM_ROLES = [
  { id: 'research', name: 'Buyer researcher', job: 'Find specific buyer problems and verify the product facts.', output: 'Buyer evidence' },
  { id: 'strategy', name: 'Growth strategist', job: 'Choose one audience, offer and measurable acquisition experiment.', output: 'Experiment brief' },
  { id: 'copy', name: 'Copywriter', job: 'Write finished campaign copy with a clear next step.', output: 'Campaign copy' },
  { id: 'creative', name: 'Creative director', job: 'Prepare a demonstrable concept, script and shot list.', output: 'Creative brief' },
  { id: 'distribution', name: 'Distribution planner', job: 'Choose a real placement and explain the route to publication.', output: 'Placement plan' },
  { id: 'sales', name: 'Sales specialist', job: 'Prepare relevant follow-ups and answers to buying objections.', output: 'Sales playbook' },
  { id: 'analyst', name: 'Revenue analyst', job: 'Check the evidence, measurement gaps and next decision.', output: 'Measurement review' },
] as const;
export const teamRoleSchema = z.enum(['research', 'strategy', 'copy', 'creative', 'distribution', 'sales', 'analyst']);
export type TeamRole = z.infer<typeof teamRoleSchema>;
export const teamBriefSchema = z.object({
  objective: text, audience: text, offer: text,
  references: z.array(z.string().url().max(2000).refine(v => /^https?:\/\//.test(v), 'Use an HTTP or HTTPS source')).max(8),
  constraints: text,
}).strict();
export type TeamBrief = z.infer<typeof teamBriefSchema>;
export const teamArtifactSchema = z.object({
  status: z.enum(['ready', 'blocked']), title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(600), body: z.string().trim().min(40).max(12000),
  evidenceIds: z.array(z.string().min(1)).min(1).max(12), nextAction: text,
  draft: z.object({ title: z.string().trim().min(1).max(160), body: text,
    kind: z.enum(['reply', 'article', 'email', 'social', 'demo']), targetUrl: z.string().url().or(z.literal('')),
  }).strict().nullable(),
  experiment: z.object({ audience: text, channel: text, hypothesis: text, action: text,
    successMetric: text, stopRule: text, durationDays: z.number().int().min(1).max(30),
    cashBudgetCents: z.literal(0),
  }).strict().nullable(),
}).strict();
export type TeamArtifact = z.infer<typeof teamArtifactSchema>;
export interface TeamEvidence { id: string; role: TeamRole; tool: string; status: 'done' | 'failed'; at: number; result: string; }
export interface TeamStep { role: TeamRole; taskId: string | null; status: 'waiting' | 'queued' | 'running' | 'done' | 'blocked' | 'failed'; artifact: TeamArtifact | null; draftId: string | null; error: string | null; }
export interface TeamRun {
  id: string; productId: string; brief: TeamBrief; createdAt: number; updatedAt: number;
  status: 'running' | 'paused' | 'attention' | 'review' | 'approved' | 'cancelled';
  revision: number; feedback: string; steps: TeamStep[]; evidence: TeamEvidence[];
  deliveryIds?: string[];
  launchDurationDays?: number;
  changes?: { at: number; detail: string }[];
  monitor?: TeamMonitor;
  execution?: { status: 'active' | 'paused' | 'complete'; approvedAt: number; endsAt: number; operationRevision: number; policy: OperationPolicy; detail: string };
  outcomes?: { published: number; sessions: number | null; analyticsAt: number | null; payments: number | null; collectedCents: number | null; revenueAt: number | null; currency: string; detail: string };
}
export interface TeamMonitor {
  observedAt: number;
  worker: { status: 'online' | 'offline' | 'unknown'; heartbeatAt: number | null };
  state: 'working' | 'waiting' | 'attention' | 'paused' | 'review' | 'complete' | 'offline';
  headline: string; detail: string; next: string; nextAt: number | null;
  lastActivityAt: number | null;
  blockers: string[];
  activity: { id: string; at: number; role: string; title: string; detail: string; status: string }[];
  tasks: { id: string; role: string; status: string; model: string | null; updatedAt: number; detail: string }[];
  deliveries: Delivery[];
  usage: { used: number; limit: number; resetsAt: number } | null;
}
export const teamSettingsSchema = z.object({ accountIds: z.array(z.string().min(1)).min(1).max(10).refine(ids => new Set(ids).size === ids.length), dailyLimit: z.number().int().min(1).max(10), intervalHours: z.number().int().min(1).max(168), durationDays: z.number().int().min(1).max(30) }).strict();
export type TeamSettings = z.infer<typeof teamSettingsSchema>;
export const teamActionSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('update-brief'), runId: text, expectedRevision: z.number().int(), brief: teamBriefSchema }).strict(),
  z.object({ command: z.literal('update-settings'), runId: text, expectedRevision: z.number().int(), operationRevision: z.number().int(), value: teamSettingsSchema }).strict(),
  z.object({ command: z.literal('link-delivery'), runId: text, deliveryId: text }).strict(),
  z.object({ command: z.literal('start'), brief: teamBriefSchema }).strict(),
  z.object({ command: z.literal('pause'), runId: text }).strict(),
  z.object({ command: z.literal('resume'), runId: text }).strict(),
  z.object({ command: z.literal('cancel'), runId: text }).strict(),
  z.object({ command: z.literal('approve'), runId: text, operationRevision: z.number().int().min(0), durationDays: z.number().int().min(1).max(30) }).strict(),
  z.object({ command: z.literal('revise'), runId: text, role: teamRoleSchema, feedback: text }).strict(),
]);
export type TeamAction = z.infer<typeof teamActionSchema>;
