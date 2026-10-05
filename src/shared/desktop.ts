import { z } from 'zod';

export const desktopSettingsSchema = z.object({ keepRunningOnClose: z.boolean().default(false), startAtLogin: z.boolean().default(false), preventSleep: z.boolean().default(false), recoverRuntime: z.boolean().default(true) }).strict();
export type DesktopSettings = z.infer<typeof desktopSettingsSchema>;
export interface RuntimeHealth { status: 'idle' | 'checking' | 'ready' | 'recovering' | 'attention' | 'stopped'; detail: string; checkedAt: number | null; nextCheckAt: number | null; failures: number; }
export interface DesktopView { settings: DesktopSettings; trayAvailable: boolean; hidden: boolean; loginSupported: boolean; loginEnabled: boolean; preventingSleep: boolean; runningBusinesses: number; runtime: RuntimeHealth; offline: boolean; }
export const desktopActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('settings'), value: desktopSettingsSchema }).strict(),
  z.object({ type: z.literal('hide') }).strict(), z.object({ type: z.literal('show') }).strict(),
  z.object({ type: z.literal('pause-all') }).strict(), z.object({ type: z.literal('retry-runtime') }).strict(),
  z.object({ type: z.literal('quit') }).strict(),
]);
export type DesktopAction = z.infer<typeof desktopActionSchema>;
