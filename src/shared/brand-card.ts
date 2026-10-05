import { z } from 'zod';

export const BRAND_CARD_WORKFLOW = 'signal-brand-card-v1';
export const brandCardSchema = z.object({
  brand: z.string().trim().min(1).max(100), title: z.string().trim().min(5).max(160),
  description: z.string().trim().min(20).max(320), domain: z.string().min(1).max(253),
  theme: z.enum(['lemonade', 'cinegen', 'neutral']),
}).strict();
export type BrandCardContent = z.infer<typeof brandCardSchema>;
