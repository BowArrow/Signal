import { z } from 'zod';

export const adDirectorBriefSchema = z.object({
  objective: z.string().trim().min(15).max(800),
  audience: z.string().trim().max(400),
  ratio: z.enum(['9:16', '16:9', '1:1']),
}).strict();
export type AdDirectorBrief = z.infer<typeof adDirectorBriefSchema>;
export const adConceptSchema = z.object({
  title: z.string().trim().min(3).max(100),
  approach: z.enum(['demonstration', 'visual-metaphor', 'relatable-scene']),
  buyerProblem: z.string().trim().min(15).max(400),
  insight: z.string().trim().min(20).max(500),
  evidence: z.array(z.object({ sourceId: z.string(), quote: z.string().trim().min(15).max(350) }).strict()).min(1).max(3),
  hook: z.string().trim().min(5).max(90),
  scene: z.string().trim().min(40).max(1500),
  productDemo: z.string().trim().min(30).max(700),
  narration: z.string().trim().min(20).max(400),
  headline: z.string().trim().min(3).max(60),
  callToAction: z.string().trim().min(3).max(40),
  hypothesis: z.string().trim().min(20).max(500),
  measure: z.string().trim().min(20).max(500),
}).strict();
export const adConceptsSchema = z.object({
  concepts: z.array(adConceptSchema).length(3),
  recommendedIndex: z.number().int().min(0).max(2),
  reason: z.string().trim().min(20).max(600),
}).strict();
export type AdConcept = z.infer<typeof adConceptSchema>;
export interface AdResearchSource { id: string; kind: 'product' | 'audience'; url: string; title: string; body: string; observedAt: number; }
export interface AdDirectorPlan {
  id: string; productId: string; taskId: string; brief: AdDirectorBrief;
  status: 'queued' | 'researching' | 'ready' | 'attention'; detail: string;
  createdAt: number; updatedAt: number; sources: AdResearchSource[];
  result?: z.infer<typeof adConceptsSchema>;
  productions: { conceptIndex: number; shotId: string; adId?: string }[];
}
