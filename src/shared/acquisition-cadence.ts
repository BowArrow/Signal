import type { AcquisitionCycle, OperationState } from './operations.js';

export function acquisitionDueAt(state: OperationState, decision: AcquisitionCycle | undefined, candidates: string[], completedAt?: number): number | null {
  if (!candidates.length) return null;
  if (state.lastCycleAt === null) return 0;
  // A finished, successful task can continue with a different eligible request.
  // Failed generation keeps the normal retry interval; active jobs are serialized.
  if (completedAt !== undefined) return completedAt + 60000;
  const freshBatch = decision?.revision === state.revision && decision.taskId === state.taskId && ['researching', 'no-fit'].includes(decision.status) && candidates.some(id => !decision.assessments.some(a => a.findingId === id));
  return state.lastCycleAt + (freshBatch ? 60000 : state.intervalHours * 3600000);
}
