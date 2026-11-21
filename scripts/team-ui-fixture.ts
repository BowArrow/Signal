import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { marketingView } from '../src/core/marketing/store.js';
import { teamAction, teamRun, saveTeamRun } from '../src/core/marketing/team-store.js';
if (process.env['SIGNAL_OFFLINE'] !== '1' || !process.env['SIGNAL_DATABASE_URL']?.includes('operations-validation')) throw new Error('Use an isolated offline profile.');
const app = createApp({ logger: silentLogger });
try {
  const p = marketingView(app).products.find(p => p.name === 'Lemonade')!;
  const id = teamAction(app, p.id, { command: 'start', brief: { objective: 'Help private-document users try one useful Lemonade workflow.', audience: 'People comparing desktop assistants for private local documents.', offer: 'Demonstrate a supported workflow, then invite a trial.', constraints: 'Zero cash. Real product proof. Original copy.', references: ['https://siplemona.de/'] } });
  const run = teamRun(app, p.id, id); run.status = process.env['SIGNAL_TEAM_UI_LEGACY'] === '1' ? 'approved' : 'review';
  for (const step of run.steps) {
    step.status = 'done'; step.artifact = { status: 'ready', title: step.role === 'research' ? 'Start with the document question' : `${step.role} review fixture`, summary: 'An isolated UI fixture for reviewing the team workspace.', body: 'Lead with one concrete task: ask a question about a local document and inspect the answer.\n\nShow the real workflow before discussing the broader product. Verify the current trial offer and keep the call to action specific.\n\nThis is sample content for interface validation. It is not live research or a customer result.', evidenceIds: ['fixture-source'], nextAction: 'Review the proposed placement and product claims before launch.', draft: null, experiment: null };
  }
  run.evidence.push({ id: 'fixture-source', role: 'research', tool: 'product.inspect', status: 'done', at: Date.now(), result: JSON.stringify({ source: 'https://siplemona.de/', note: 'Offline fixture only.' }) });
  saveTeamRun(app, run);
} finally { app.close(); }
