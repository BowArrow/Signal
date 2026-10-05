import { eq } from 'drizzle-orm';
import type { App } from '../app.js';
import { settings } from '../db/schema.js';
import { runtimeSettingsSchema } from '../../shared/runtime.js';

export function runtimeSettings(app: Pick<App, 'db'>) {
  const row = app.db.select().from(settings).where(eq(settings.key, 'runtime.provider.v1')).get();
  return runtimeSettingsSchema.parse(row?.value ?? {});
}
export function saveRuntimeSettings(app: App, input: unknown) {
  const value = runtimeSettingsSchema.parse(input);
  app.db.insert(settings).values({ key: 'runtime.provider.v1', value, updatedAt: app.clock.now() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: app.clock.now() } }).run();
  return value;
}
function usageKey(app: App) { return `runtime.cloud.calls.${new Date(app.clock.now()).toISOString().slice(0, 10)}`; }
export function cloudCallsToday(app: App): number {
  const row = app.db.select().from(settings).where(eq(settings.key, usageKey(app))).get();
  return typeof row?.value === 'number' ? row.value : 0;
}
export function reserveCloudCall(app: App): void {
  app.db.transaction(() => {
    const count = cloudCallsToday(app);
    if (count >= runtimeSettings(app).dailyCallLimit) throw new Error('Daily GPT call limit reached. Change the limit in Settings or use the local runtime.');
    app.db.insert(settings).values({ key: usageKey(app), value: count + 1, updatedAt: app.clock.now() })
      .onConflictDoUpdate({ target: settings.key, set: { value: count + 1, updatedAt: app.clock.now() } }).run();
  });
}
