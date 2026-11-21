import type { GuideStep } from './marketing-guide.js';

export interface SalesDiagnosis {
  productId: string;
  observedAt: number;
  stage: 'access' | 'measurement' | 'reach' | 'activation' | 'purchase';
  next: GuideStep;
  evidence: string[];
  sessions: number | null;
  published30Days: number;
  recovery?: { taskId: string; status: string; attempts: number };
}
