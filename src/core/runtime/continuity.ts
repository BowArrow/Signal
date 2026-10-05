import { eq } from 'drizzle-orm';
import type { App } from '../app.js';
import { settings } from '../db/schema.js';
import { runtimeSettings } from './settings.js';
import { growthSettings } from '../growth/store.js';
import { marketingSettings } from '../marketing/store.js';
import { desktopSettingsSchema, type DesktopSettings, type RuntimeHealth } from '../../shared/desktop.js';
import type { RuntimeView } from '../../shared/runtime.js';

const KEY = 'desktop.settings.v1';
export function desktopSettings(app: App): DesktopSettings { return desktopSettingsSchema.parse(app.db.select().from(settings).where(eq(settings.key, KEY)).get()?.value ?? {}); }
export function saveDesktopSettings(app: App, input: unknown) { const value = desktopSettingsSchema.parse(input); app.db.insert(settings).values({ key: KEY, value, updatedAt: app.clock.now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: app.clock.now() } }).run(); return value; }
export function runningBusinesses(app: App) { return app.connections?.view().products.filter(p => app.operations?.state(p.id).running) ?? []; }
export function pauseAllOperations(app: App) { for (const product of app.connections?.view().products ?? []) app.operations?.pause(product.id); }
export interface ManagedRuntime { status(): Promise<RuntimeView['local']>; start(): Promise<void>; stop(): void; }

export class RuntimeSupervisor {
  private state: RuntimeHealth = { status: 'idle', detail: 'No active local operation needs recovery.', checkedAt: null, nextCheckAt: null, failures: 0 };
  private active: Promise<void> | null = null; private stopped = false; private held = false; private revision = 0;
  constructor(private readonly app: App, private readonly runtime: ManagedRuntime) {}
  view() { return { ...this.state }; }
  private needed() { return this.app.env.SIGNAL_OFFLINE !== '1' && runtimeSettings(this.app).provider === 'local' && desktopSettings(this.app).recoverRuntime && (runtimeSettings(this.app).autoStart || growthSettings(this.app).enabled || marketingSettings(this.app).enabled || runningBusinesses(this.app).some(p => this.app.operations?.readiness(p.id).needsAgents)); }
  private requiredModels() {
    const growth = growthSettings(this.app); const marketing = marketingSettings(this.app); const running = runningBusinesses(this.app);
    if (!running.length && runtimeSettings(this.app).autoStart) return [...new Set([growth.model, growth.pipelineModel, marketing.model, ...(runtimeSettings(this.app).localVisionModel ? [runtimeSettings(this.app).localVisionModel!] : [])])];
    return [...new Set([...running.flatMap(p => this.app.operations?.agentModels(p.id) ?? []), ...(growth.enabled ? [growth.model, growth.pipelineModel] : []), ...(marketing.enabled ? [marketing.model] : [])])];
  }
  hold() { this.held = true; this.revision++; this.state = { ...this.state, status: 'stopped', nextCheckAt: null, detail: 'Automatic recovery is paused. Start the runtime or Run an operation to resume.' }; }
  resume() { if (this.stopped) return; this.held = false; this.revision++; this.state = { ...this.state, status: 'idle', nextCheckAt: null, failures: 0, detail: 'Runtime check requested.' }; }
  recheck() { if (!this.stopped && !this.held) this.state = { ...this.state, nextCheckAt: null }; }
  async stop() { this.stopped = true; this.hold(); this.runtime.stop(); await this.active; }
  readyForAgents() { void this.tick().catch(() => this.app.logger.warn('Runtime check could not complete.')); return runtimeSettings(this.app).provider === 'openai' || (!this.held && (!this.needed() || this.state.status === 'ready')); }
  async tick() {
    if (this.stopped || this.held) return;
    if (this.active) return this.active;
    if (!this.needed()) { this.state = { ...this.state, status: 'idle', nextCheckAt: null, failures: 0, detail: runtimeSettings(this.app).provider === 'openai' ? 'GPT uses the configured API key and request limits.' : 'No active local operation needs recovery.' }; return; }
    if (this.state.nextCheckAt !== null && this.state.nextCheckAt > this.app.clock.now()) return;
    const revision = this.revision;
    this.active = this.check(revision).finally(() => { this.active = null; }); return this.active;
  }
  private async check(revision: number) {
    const allowed = () => !this.stopped && !this.held && revision === this.revision && this.needed();
    this.state = { ...this.state, status: 'checking', detail: 'Checking the local agent runtime.' };
    try {
      let local = await this.runtime.status(); if (!allowed()) return;
      if (!local.ok) { this.state = { ...this.state, status: 'recovering', detail: 'Starting the installed local runtime.' }; await this.runtime.start(); if (!allowed()) return; local = await this.runtime.status(); if (!allowed()) return; }
      if (!local.ok) throw new Error('Local runtime is unavailable.');
      const missing = this.requiredModels().filter(m => !local.models.includes(m));
      this.state = { status: missing.length ? 'attention' : 'ready', detail: missing.length ? `Choose or install the configured models in Settings: ${missing.join(', ')}. No model was downloaded automatically.` : 'Configured local models are available.', checkedAt: this.app.clock.now(), nextCheckAt: this.app.clock.now() + 30000, failures: 0 };
    } catch {
      if (!allowed()) return;
      const failures = this.state.failures + 1; const delay = Math.min(15 * 60000, 30000 * 2 ** Math.min(failures - 1, 5));
      this.state = { status: 'attention', detail: 'Local runtime recovery failed. Check Ollama installation and the saved endpoint. Signal will retry with a delay; no provider or model was changed.', checkedAt: this.app.clock.now(), nextCheckAt: this.app.clock.now() + delay, failures };
    }
  }
}
