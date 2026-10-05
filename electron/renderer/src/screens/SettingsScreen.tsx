import { useCallback, useEffect, useState } from 'react';
import type { RuntimeAction, RuntimeSettings, RuntimeView } from '../../../../src/shared/runtime.js';
import type { GrowthSettings } from '../../../../src/shared/growth.js';
import { DesktopSettings } from '../components/DesktopSettings.js';
import '../styles/growth.css';
import '../styles/marketing.css';

export function SettingsScreen({ onToast }: { onToast: (message: string, kind?: 'ok' | 'warn') => void }) {
  const [data, setData] = useState<RuntimeView | null>(null);
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [local, setLocal] = useState<GrowthSettings | null>(null);
  const [operator, setOperator] = useState('');
  const [key, setKey] = useState(''); const [model, setModel] = useState('gemma4:e4b');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { const value = await window.signal.runtime(); setData(value); setSettings(old => old ?? value.settings); setError(''); }
    catch (e) { setError(String(e)); }
  }, []);
  useEffect(() => { void refresh(); void Promise.all([window.signal.growth(), window.signal.marketing()]).then(([growth, marketing]) => { setLocal(growth.settings); setOperator(marketing.settings.model); }).catch(e => setError(String(e))); const timer = setInterval(() => void refresh(), 5000); return () => clearInterval(timer); }, [refresh]);
  const act = async (action: RuntimeAction) => { setBusy(true); try { const value = await window.signal.runtimeAction(action); setData(value); onToast('Runtime updated'); return true; } catch (e) { onToast(String(e), 'warn'); return false; } finally { setBusy(false); } };
  if (!settings || !data || !local) return <div className="page"><h1>Settings</h1><p role="status">{error || 'Checking your runtime…'}</p></div>;
  return <div className="page growth-page">
    <div className="page-head"><div><h1 className="page-title">Settings</h1><p className="page-lede">Choose where your agents work and manage the models they use.</p></div><button className="btn" onClick={() => void refresh()}>Refresh status</button></div>
    {error && <p role="alert">{error}</p>}
    <DesktopSettings onToast={onToast} />
    <form className="card marketing-request" onSubmit={e => { e.preventDefault(); void act({ type: 'settings', value: settings }); }}>
      <h2>Agent provider</h2><label>Run agents with<select aria-label="Agent provider" value={settings.provider} onChange={e => setSettings({ ...settings, provider: e.target.value as RuntimeSettings['provider'] })}><option value="local">Local models on this computer</option><option value="openai">GPT with my OpenAI API key</option></select></label>
      <p className="growth-muted">This selection applies to marketing, campaign research, writing, analysis, and the agent-run opportunity pipeline. GPT sends the task’s product context and evidence to OpenAI and uses your API billing.</p>
      <div className="marketing-form-grid"><label>GPT model ID<input aria-label="GPT model ID" value={settings.openaiModel} onChange={e => setSettings({ ...settings, openaiModel: e.target.value })} required /></label><label>Maximum GPT calls per UTC day<input type="number" min={1} max={1000} value={settings.dailyCallLimit} onChange={e => setSettings({ ...settings, dailyCallLimit: Number(e.target.value) })} /></label><label>Maximum output tokens per call<input type="number" min={1000} max={16000} value={settings.maxOutputTokens} onChange={e => setSettings({ ...settings, maxOutputTokens: Number(e.target.value) })} /></label></div>
      <p>{data.cloudCallsToday} GPT calls attempted today. The call cap limits requests; it is not a dollar budget.</p>
      <label>Local image-review model<input aria-label="Local image-review model" list="installed-models" value={settings.localVisionModel ?? ''} onChange={e => setSettings({ ...settings, localVisionModel: e.target.value })} placeholder="Use the marketing operator model" /></label>
      <p className="growth-muted">Choose an installed vision model to inspect campaign images. This can differ from the writing model. With GPT selected, image review uses the configured GPT model.</p>
      <label>Local model processing<select aria-label="Local model processing" value={settings.localDevice} onChange={e => setSettings({ ...settings, localDevice: e.target.value as RuntimeSettings['localDevice'] })}><option value="auto">Automatic — allow GPU acceleration</option><option value="cpu">CPU only — Ollama agents</option></select></label>
      <p className="growth-muted">CPU only runs local writing, research, sales and image-review models without GPU offload. It requires Ollama on this computer at port 11434 and can be much slower; each call may run for up to 15 minutes. ComfyUI image/video generation and other applications use their own device settings.</p>
      <label className="marketing-check"><input type="checkbox" checked={settings.autoStart} onChange={e => setSettings({ ...settings, autoStart: e.target.checked })} />Start the local runtime when Signal opens</label>
      <button className="btn btn-primary" disabled={busy}>Save provider settings</button>
      <p className="growth-muted">Changing provider settings or API keys pauses Operations. Stopping the runtime also pauses Operations and automatic recovery; use Start or Run to resume.</p>
      <button type="button" className="btn" disabled={busy} onClick={() => void window.signal.growthRuntime().then(result => onToast(result.detail, result.ok ? 'ok' : 'warn')).catch(e => onToast(String(e), 'warn'))}>Test saved provider</button>
    </form>
    <form className="card marketing-request" onSubmit={e => { e.preventDefault(); void act({ type: 'key', value: key }).then(ok => { if (ok) setKey(''); }); }}>
      <h2>OpenAI API key</h2><p>{data.hasApiKey ? 'A key is configured. Its value is never returned to this screen.' : 'No API key configured.'}</p>
      <label>API key<input aria-label="OpenAI API key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} placeholder="sk-…" /></label>
      <p className="growth-muted">{data.secureStorage ? 'Stored using OS encryption in your Signal profile.' : 'OS encrypted storage is unavailable. Set OPENAI_API_KEY in the environment.'}</p>
      <div className="growth-actions"><button className="btn" disabled={busy || !key || !data.secureStorage}>Save API key</button><button type="button" className="btn" disabled={busy || !data.hasApiKey} onClick={() => void act({ type: 'key', value: '' })}>Remove saved key</button></div>
    </form>
    <section className="card marketing-request"><h2>Local runtime</h2><p role="status">{data.local.detail}</p>
      <div className="growth-actions"><button className="btn" disabled={busy || data.local.ok} onClick={() => void act({ type: 'start' })}>Start local runtime</button><button className="btn" disabled={busy || !data.local.managed} onClick={() => void act({ type: 'stop' })}>Stop Signal runtime</button><button className="btn" onClick={() => void window.signal.openExternal('https://ollama.com/download')}>Get Ollama</button></div>
      <p className="growth-muted">Signal manages the installed Ollama process and model downloads. A server you started elsewhere is connected without taking ownership. Signal’s managed server disables Ollama cloud inference.</p>
      <form onSubmit={e => { e.preventDefault(); setBusy(true); void (async () => { await window.signal.growthAction({ type: 'settings', value: local }); const marketing = await window.signal.marketing(); await window.signal.marketingAction({ type: 'settings', value: { ...marketing.settings, model: operator } }); onToast('Local models saved'); await refresh(); })().catch(e => onToast(String(e), 'warn')).finally(() => setBusy(false)); }}>
        <label>Local API endpoint<input value={local.baseUrl} onChange={e => setLocal({ ...local, baseUrl: e.target.value })} /></label>
        <datalist id="installed-models">{data.local.models.map(m => <option key={m} value={m} />)}</datalist>
        <div className="marketing-form-grid"><label>Marketing operator<input list="installed-models" value={operator} onChange={e => setOperator(e.target.value)} required /></label><label>Research and campaign model<input list="installed-models" value={local.model} onChange={e => setLocal({ ...local, model: e.target.value })} required /></label><label>Opportunity model<input list="installed-models" value={local.pipelineModel} onChange={e => setLocal({ ...local, pipelineModel: e.target.value })} required /></label></div>
        <button className="btn" disabled={busy}>Save local models</button>
      </form>
      <form onSubmit={e => { e.preventDefault(); void act({ type: 'pull', model }); }}><h3>Download a local model</h3><label>Ollama model tag<input value={model} onChange={e => setModel(e.target.value)} required /></label><p className="growth-muted">Downloads can be several gigabytes. Use an installed model above to avoid a download.</p><button className="btn" disabled={busy || Boolean(data.download && !['success', 'failed', 'cancelled'].includes(data.download.status))}>Download model</button></form>
      {data.download && <div role="status"><p>{data.download.model}: {data.download.status}</p>{data.download.total > 0 && <progress max={data.download.total} value={data.download.completed} aria-label="Model download progress" />}{data.download.error && <p>{data.download.error}</p>}{!['success', 'failed', 'cancelled'].includes(data.download.status) && <button className="btn" onClick={() => void act({ type: 'cancelDownload' })}>Cancel download</button>}</div>}
    </section>
  </div>;
}
