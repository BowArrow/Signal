import { z } from 'zod';

export const runtimeSettingsSchema = z.object({
  provider: z.enum(['local', 'openai']).default('local'),
  localDevice: z.enum(['auto', 'cpu']).default('auto'),
  openaiModel: z.string().trim().min(1).max(160).default('gpt-5-mini'),
  localVisionModel: z.string().trim().max(160).optional(),
  maxOutputTokens: z.number().int().min(1000).max(16000).default(6000),
  dailyCallLimit: z.number().int().min(1).max(1000).default(30),
  autoStart: z.boolean().default(false),
}).strict();
export type RuntimeSettings = z.infer<typeof runtimeSettingsSchema>;
export interface RuntimeView {
  settings: RuntimeSettings;
  hasApiKey: boolean;
  secureStorage: boolean;
  local: { ok: boolean; detail: string; models: string[]; managed: boolean };
  download: { model: string; status: string; completed: number; total: number; error?: string } | null;
  cloudCallsToday: number;
}
export const runtimeActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('settings'), value: runtimeSettingsSchema }).strict(),
  z.object({ type: z.literal('key'), value: z.string().trim().max(512) }).strict(),
  z.object({ type: z.literal('start') }).strict(),
  z.object({ type: z.literal('stop') }).strict(),
  z.object({ type: z.literal('pull'), model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,150}$/) }).strict(),
  z.object({ type: z.literal('cancelDownload') }).strict(),
]);
export type RuntimeAction = z.infer<typeof runtimeActionSchema>;
