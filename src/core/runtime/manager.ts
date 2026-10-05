import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { App } from '../app.js';
import { growthSettings } from '../growth/store.js';
import { OpenAiCompatibleClient } from '../llm/openai-compatible.js';
import type { RuntimeView } from '../../shared/runtime.js';
import { runtimeSettings } from './settings.js';

export class LocalRuntime {
  private child: ChildProcess | null = null;
  private starting: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private lastError = '';
  private lifecycle = 0;
  download: RuntimeView['download'] = null;
  constructor(private readonly app: App) {}
  async status(): Promise<RuntimeView['local']> {
    const result = await new OpenAiCompatibleClient(growthSettings(this.app).baseUrl, this.app.logger, { localDevice: runtimeSettings(this.app).localDevice, offline: this.app.env.SIGNAL_OFFLINE === '1' }).ping();
    return { ...result, models: result.models ?? [], managed: Boolean(this.child), detail: result.ok ? `${result.detail}. ${this.child ? 'Managed by Signal.' : 'Connected to your existing server.'}` : this.lastError || result.detail };
  }
  async start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this.startInternal(this.lifecycle);
    try { await this.starting; } finally { this.starting = null; }
  }
  private async startInternal(lifecycle: number) {
    const allowed = () => { if (lifecycle !== this.lifecycle) throw new Error('Local runtime startup was cancelled.'); };
    if (this.app.env.SIGNAL_OFFLINE === '1') throw new Error('Offline test mode: runtime launch is disabled.');
    const status = await this.status(); allowed(); if (status.ok) return;
    const base = new URL(growthSettings(this.app).baseUrl);
    if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname) || base.port !== '11434' || base.pathname.replace(/\/$/, '') !== '/v1') throw new Error('Managed Ollama requires http://localhost:11434/v1 or http://127.0.0.1:11434/v1. Other local servers can be connected without launching a managed runtime.');
    const installed = process.platform === 'win32' ? join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Ollama', 'ollama.exe') : '';
    const executable = installed && existsSync(installed) ? installed : 'ollama';
    this.lastError = '';
    const child = spawn(executable, ['serve'], { windowsHide: true, shell: false, stdio: 'ignore', env: {
      ...process.env, OLLAMA_HOST: `${base.hostname}:${base.port || '80'}`, OLLAMA_NO_CLOUD: '1',
      OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_CONTEXT_LENGTH: '16384',
    } });
    this.child = child;
    child.once('error', () => { this.lastError = 'Ollama could not start. Install Ollama, then try Start local runtime again.'; if (this.child === child) this.child = null; });
    child.once('exit', () => { if (this.child === child) this.child = null; });
    for (let attempt = 0; attempt < 20; attempt++) {
      allowed();
      if (this.lastError) throw new Error(this.lastError);
      const status = await this.status(); allowed(); if (status.ok) return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Ollama is still starting. Refresh runtime status in a moment.');
  }
  stop() {
    this.lifecycle++; this.controller?.abort();
    const owned = this.child; this.child = null;
    if (!owned || owned.exitCode !== null || owned.signalCode !== null) return;
    // Ollama's Windows model runner survives killing only its parent and retains
    // GPU memory. Limit tree termination to the still-live server we launched.
    if (process.platform === 'win32' && owned.pid) {
      const result = spawnSync('taskkill', ['/PID', String(owned.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore', timeout: 10000 });
      if (result.status !== 0) owned.kill();
    } else owned.kill();
  }
  cancelDownload() { this.controller?.abort(); }
  async pull(model: string): Promise<void> {
    if (this.controller) throw new Error('A model download is already in progress.');
    if (/:cloud$|-cloud$/.test(model)) throw new Error('Choose a local model. Use the GPT provider for cloud work.');
    if (this.app.env.SIGNAL_OFFLINE === '1') throw new Error('Offline test mode');
    const controller = new AbortController(); this.controller = controller;
    try { await this.start(); } catch (error) { if (this.controller === controller) this.controller = null; throw error; }
    if (controller.signal.aborted) { this.controller = null; return; }
    this.download = { model, status: 'starting', completed: 0, total: 0 };
    const run = async () => {
      try {
        const response = await fetch(new URL('/api/pull', growthSettings(this.app).baseUrl), {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true }),
        });
        if (!response.ok || !response.body) throw new Error(`Model download returned HTTP ${response.status}`);
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '';
        const line = (text: string) => {
          if (!text.trim()) return;
          const item = JSON.parse(text) as { status?: string; completed?: number; total?: number; error?: string };
          if (item.error) throw new Error(item.error.slice(0, 250));
          this.download = { model, status: item.status ?? 'downloading', completed: item.completed ?? 0, total: item.total ?? 0 };
        };
        try { while (true) { const chunk = await reader.read(); if (chunk.done) break; pending += decoder.decode(chunk.value, { stream: true }); if (pending.length > 1000000) throw new Error('Invalid model download response'); const lines = pending.split('\n'); pending = lines.pop() ?? ''; for (const item of lines) line(item); } line(pending); }
        finally { await reader.cancel(); }
        if (this.download?.status !== 'success') throw new Error('Download ended before model verification completed. Retry the download to resume.');
      } catch (error) { this.download = { model, status: controller.signal.aborted ? 'cancelled' : 'failed', completed: 0, total: 0, error: String(error).slice(0, 350) }; }
      finally { this.controller = null; }
    };
    void run();
  }
}
