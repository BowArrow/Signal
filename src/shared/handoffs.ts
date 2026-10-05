import { z } from 'zod';
import { ownerReplySchema } from './sales-replies.js';

export interface SalesHandoff {
  id: string; productId: string; kind: 'message' | 'reply' | 'sequence'; sourceId: string;
  messageId: string; accountId: string; contact: string; subject: string; detail: string;
  fingerprint: string; revision: number; uncertain: boolean;
  status: 'open' | 'snoozed' | 'waiting' | 'resolved'; dueAt: number; createdAt: number; updatedAt: number;
  resolution: string; history: { at: number; action: string; note: string }[];
}
export interface HandoffSummary { open: number; due: number; waiting: number; uncertain: number; }
export interface HandoffView {
  offline: boolean; cases: (SalesHandoff & { canReply: boolean; canRetry: boolean; canReconcile: boolean; messageBody: string })[];
  counts: { productId: string; summary: HandoffSummary }[];
}
const target = { productId: z.string().min(1), id: z.string().min(1), revision: z.number().int().positive() };
export const handoffActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snooze'), ...target, until: z.number().int().nonnegative(), note: z.string().trim().min(5).max(2000) }).strict(),
  z.object({ type: z.literal('resolve'), ...target, outcome: z.enum(['answered-externally', 'no-response-needed', 'uncertainty-acknowledged']), note: z.string().trim().min(5).max(2000) }).strict(),
  z.object({ type: z.literal('retry'), ...target }).strict(),
  z.object({ type: z.literal('reconcile'), ...target }).strict(),
  z.object({ type: z.literal('reply'), ...target, body: ownerReplySchema }).strict(),
]);
export type HandoffAction = z.infer<typeof handoffActionSchema>;
