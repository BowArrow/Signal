import { eq } from 'drizzle-orm';
import type { App } from '../app.js';
import { settings } from '../db/schema.js';
import type { TeamRun } from '../../shared/marketing-team.js';

export function activeTeamCampaign(app: App, productId: string): TeamRun | undefined {
  const state = app.operations?.state(productId);
  if (!state?.running || !state.teamRunId || !state.teamEndsAt || state.teamEndsAt <= app.clock.now()) return;
  const run = app.db.select().from(settings).where(eq(settings.key, `marketing.team.run.${state.teamRunId}`)).get()?.value as TeamRun | undefined;
  if (run?.productId === productId && run.status === 'approved' && run.execution?.status === 'active' && run.execution.operationRevision === state.revision) return run;
}
export function isTeamOperationTask(app: App, productId: string, taskId: string) {
  const marker = app.db.select().from(settings).where(eq(settings.key, `marketing.team.operation-task.${taskId}`)).get()?.value as { runId: string; productId: string; revision: number } | undefined;
  const run = marker && activeTeamCampaign(app, productId);
  return Boolean(run && marker?.productId === productId && marker.runId === run.id && marker.revision === run.execution?.operationRevision && app.operations?.state(productId).taskId === taskId);
}
export function approvedCampaignContext(app: App, productId: string) {
  const run = activeTeamCampaign(app, productId);
  return run ? { id: run.id, brief: run.brief, endsAt: run.execution!.endsAt, handoffs: run.steps.map(s => ({ role: s.role, artifact: s.artifact ? { ...s.artifact, body: s.artifact.body.slice(0, 3000) } : null })), instruction: 'Execute this approved campaign, preserving its audience, offer and constraints. Adapt format and wording to the selected destination. Use fresh source facts over stale handoffs. Routine research, copy revisions and delivery within the approved policy need no further owner approval. Stay within existing email permissions. No new spending, new destinations, promises or changes to the offer. Use operations.enqueue after automated review. If a required placement or capability is unavailable, report the concrete blocker; never substitute an unrelated campaign.' } : undefined;
}
