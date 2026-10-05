import { useEffect, useState } from 'react';
import type { GrowthAction, GrowthDashboard, GrowthTaskView } from '../../../../src/shared/growth.js';

type Product = GrowthDashboard['products'][number];
type Props = {
  data: GrowthDashboard;
  product: Product;
  busy: boolean;
  act: (action: GrowthAction) => Promise<void>;
  onDetails: () => void;
};

export function GrowthActivity({ data, product, busy, act, onDetails }: Props): React.JSX.Element {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const ready = product.channels.filter((c) => c.idea).length;
  const pending = product.tasks.filter((t) => t.status === 'queued' || t.status === 'running');
  const worker = data.products.flatMap((p) => p.tasks.map((task) => ({ task, product: p })))
    .find(({ task }) => task.status === 'running');
  // Earlier failed attempts should not hide a later successful retry.
  const latest = new Map<string, GrowthTaskView>();
  for (const task of [...product.tasks].sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt)) {
    const key = `${task.kind}:${task.targetId}`;
    if (!latest.has(key)) latest.set(key, task);
  }
  const failures = [...latest.values()].filter((t) => t.status === 'failed');
  const targetName = (p: Product, task: GrowthTaskView) =>
    p.channels.find((c) => c.id === task.targetId)?.name ??
    p.experiments.find((e) => e.id === task.targetId)?.channelName ?? p.name;
  const seconds = worker ? Math.max(0, Math.floor((now - worker.task.updatedAt) / 1000)) : 0;
  const elapsed = `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const next = [...pending].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0];
  return <section className="card growth-activity" aria-label="Research progress">
    <div className="growth-section-title">
      <div role="status">
        <strong>{pending.some((t) => t.kind === 'research') ? 'Research in progress' : ready === 19 ? 'Research complete — all 19 channel ideas are ready' : `${ready} of 19 channel ideas ready`}</strong>
        <p className="growth-muted">{pending.length
          ? `${pending.filter((t) => t.status === 'queued').length} tasks queued. Results save one channel at a time; existing ideas remain available during a refresh.`
          : ready === 19 ? 'Open a channel below to read its research, then choose up to three channels for small tests.' : 'Start research to prepare a testable idea for each channel.'}</p>
      </div>
      <button className="btn" onClick={onDetails}>View agent activity</button>
    </div>
    {pending.length > 0 && <div className="growth-worker">
      {worker ? <>
        <strong>{worker.product.name}: {worker.task.kind} · {targetName(worker.product, worker.task)}</strong>
        <p>{worker.task.model ?? (worker.task.kind === 'marketing' ? 'Local marketing model' : worker.task.kind === 'opportunities' ? data.settings.pipelineModel : data.settings.model)} · <span aria-label="Task elapsed time">{elapsed} elapsed</span>. Waiting for the local model; loading a model can take time.</p>
        {seconds >= 60 && <p>Still waiting for a validated response. Each model request has a four-minute timeout; a correction can require one more request.</p>}
        {worker.product.id === product.id && <button className="btn" disabled={busy} onClick={() => void act({ type: 'cancel', taskId: worker.task.id })}>Cancel current task</button>}
      </> : <p>Queued{next ? `: ${targetName(product, next)}` : ''}. Waiting for the local worker to pick up the next task.</p>}
    </div>}
    {failures.length > 0 && <div className="growth-error" role="alert">
      <strong>{failures.length} task{failures.length === 1 ? ' needs' : 's need'} attention</strong>
      <p>{targetName(product, failures[0]!)}: {failures[0]!.error}</p>
      <button className="btn" onClick={onDetails}>Review errors and retry</button>
    </div>}
  </section>;
}
