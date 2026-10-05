import { z } from 'zod';

export const CHANNELS = [
  [
    'blogs',
    'Targeting blogs',
    'A useful guest article or a small niche sponsorship.',
  ],
  [
    'publicity',
    'Publicity',
    'An evidence-backed story for a relevant journalist.',
  ],
  [
    'unconventional-pr',
    'Unconventional PR',
    'A memorable demonstration or exceptional customer experience.',
  ],
  [
    'sem',
    'Search engine marketing',
    'A tightly scoped test of high-intent search ads.',
  ],
  [
    'social-ads',
    'Social and display ads',
    'One audience, a few creatives, a fixed spending cap.',
  ],
  [
    'offline-ads',
    'Offline ads',
    'A trackable placement where the intended buyers spend time.',
  ],
  [
    'seo',
    'Search engine optimization',
    'Answer a specific buying or implementation question.',
  ],
  [
    'content',
    'Content marketing',
    'Teach a useful workflow and measure qualified interest.',
  ],
  [
    'email',
    'Email marketing',
    'Help opted-in subscribers reach their first useful outcome.',
  ],
  [
    'viral',
    'Viral marketing',
    'Give satisfied users a useful reason to invite someone.',
  ],
  [
    'engineering',
    'Engineering as marketing',
    'A small free tool that solves an adjacent problem.',
  ],
  [
    'partnerships',
    'Business development',
    'A complementary partner with a shared audience.',
  ],
  [
    'sales',
    'Sales',
    'Learn from a small number of relevant buyer conversations.',
  ],
  [
    'affiliates',
    'Affiliate programs',
    'A measurable referral offer for a small partner cohort.',
  ],
  [
    'platforms',
    'Existing platforms',
    'A helpful presence where buyers already look for solutions.',
  ],
  [
    'trade-shows',
    'Trade shows',
    'Validate buyer interest before committing to a booth.',
  ],
  [
    'events',
    'Offline events',
    'A small workshop for a clearly defined audience.',
  ],
  [
    'speaking',
    'Speaking engagements',
    'Teach a practical session to prospective buyers.',
  ],
  [
    'community',
    'Community building',
    'Help members solve a recurring problem together.',
  ],
] as const;
export type ChannelKey = (typeof CHANNELS)[number][0];
export const channelKeySchema = z.enum(
  CHANNELS.map((c) => c[0]) as [ChannelKey, ...ChannelKey[]],
);
const text = z.string().trim().min(1).max(4000);
const count = z.number().int().min(0).max(1_000_000_000);

export const growthSettingsSchema = z
  .object({
    baseUrl: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      }, 'Use a local loopback model endpoint, such as http://127.0.0.1:11434/v1'),
    model: z.string().trim().min(1).max(200),
    pipelineModel: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .default('qwen2.5-coder:7b'),
    enabled: z.boolean(),
    autoPlan: z.boolean().default(true),
    intervalMinutes: z.number().int().min(15).max(10080),
  })
  .strict();
export type GrowthSettings = z.infer<typeof growthSettingsSchema>;
export const goalSchema = z
  .object({
    description: text,
    targetCustomers: z.number().int().min(1).max(1_000_000),
    maxCacCents: count,
    experimentBudgetCents: count,
    testDays: z.number().int().min(1).max(30),
    minVisitors: z.number().int().min(1).max(1_000_000),
    minCustomers: z.number().int().min(1).max(1_000_000),
  })
  .strict();
export type GrowthGoal = z.infer<typeof goalSchema>;
export const ideaSchema = z
  .object({
    hypothesis: text,
    audience: text,
    test: text,
    successSignal: text,
    estimatedCostCents: count,
    estimatedHours: z.number().min(0).max(1000),
    potentialCustomers: count,
    confidence: z.number().min(0).max(1),
    rationale: text,
    evidenceIds: z.array(z.string()).max(12),
  })
  .strict();
export type ChannelIdea = z.infer<typeof ideaSchema>;
export const resultSchema = z
  .object({
    visitors: count,
    leads: count,
    customers: count,
    spendCents: count,
    revenueCents: count,
    audienceFit: z.enum(['unknown', 'poor', 'good']),
    source: text,
    notes: z.string().trim().max(4000),
  })
  .strict()
  .refine(
    (r) => r.customers <= r.leads && r.leads <= r.visitors,
    'Customers must not exceed leads, and leads must not exceed visitors',
  );
export type ExperimentResult = z.infer<typeof resultSchema>;
export const assetSchema = z
  .object({
    title: text,
    body: z.string().trim().min(40).max(20000),
    checklist: z.array(text).min(1).max(10),
  })
  .strict();
export type GrowthAsset = z.infer<typeof assetSchema>;
export const analysisSchema = z
  .object({
    summary: text,
    nextActions: z.array(text).min(1).max(8),
    caveats: z.array(text).max(8),
  })
  .strict();
export type GrowthAnalysis = z.infer<typeof analysisSchema>;
export type GrowthTaskKind =
  'research' | 'campaign' | 'analysis' | 'opportunities' | 'marketing' | 'studio' | 'ad-concepts';
export interface GrowthChannelView {
  evidence: { id: string; title: string; url: string }[];
  id: string;
  key: ChannelKey;
  name: string;
  hint: string;
  ring: 'outer' | 'middle' | 'inner';
  idea: ChannelIdea | null;
}
export interface GrowthExperimentView {
  updatedAt: number;
  id: string;
  channelId: string;
  channelName: string;
  title: string;
  status: 'planned' | 'running' | 'completed';
  goal: GrowthGoal;
  startedAt: number | null;
  endsAt: number | null;
  result: ExperimentResult | null;
  trackedUrl: string;
  evaluation: {
    verdict: 'unmeasured' | 'insufficient' | 'promising' | 'stop';
    reason: string;
    cacCents: number | null;
  };
}
export interface GrowthTaskView {
  id: string;
  kind: GrowthTaskKind;
  targetId: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  output: Record<string, unknown> | null;
  error: string | null;
  model: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface GrowthDashboard {
  settings: GrowthSettings;
  products: {
    id: string;
    name: string;
    currency: string;
    goal: GrowthGoal;
    channels: GrowthChannelView[];
    experiments: GrowthExperimentView[];
    tasks: GrowthTaskView[];
  }[];
}
export type GrowthAction =
  | { type: 'settings'; value: GrowthSettings }
  | { type: 'goal'; productId: string; value: GrowthGoal }
  | { type: 'research'; productId: string; refresh?: boolean }
  | { type: 'analysis'; productId: string }
  | { type: 'opportunities'; productId: string }
  | { type: 'shortlist'; channelId: string }
  | { type: 'remove'; channelId: string }
  | { type: 'focus'; channelId: string }
  | { type: 'start'; experimentId: string }
  | { type: 'campaign'; experimentId: string }
  | { type: 'results'; experimentId: string; value: ExperimentResult }
  | { type: 'cancel'; taskId: string }
  | { type: 'retry'; taskId: string };
