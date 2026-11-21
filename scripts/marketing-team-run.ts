import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { marketingView } from '../src/core/marketing/store.js';
import { connectCodex } from '../src/core/marketing/mission.js';
import { scheduleTeamRuns, teamAction, teamRun, teamRuns } from '../src/core/marketing/team-store.js';
import { GrowthEngine } from '../src/core/growth/engine.js';

// A bounded, foreground run. It never starts Operations, inbox workers or a scheduler.
// Require an explicit isolated database; do not silently mutate the installed profile.
const folder = resolve('data/team-validation'); mkdirSync(folder, { recursive: true });
const db = process.env['SIGNAL_TEAM_DATABASE'];
if (!db || !resolve(db).startsWith(folder + '\\') && !resolve(db).startsWith(folder + '/')) throw new Error('Set SIGNAL_TEAM_DATABASE to a database inside data/team-validation.');
const app = createApp({ databaseUrl: db, logger: silentLogger });
try {
  const product = marketingView(app).products.find(p => p.name === 'Lemonade'); if (!product) throw new Error('Lemonade profile missing.');
  await connectCodex(app, product.id);
  let run = teamRuns(app, product.id)[0];
  if (!run) {
    const id = teamAction(app, product.id, { command: 'start', brief: {
      objective: 'Prepare one specific zero-cash campaign to win attributable Lemonade sales. Prioritize reaching relevant buyers over producing more generic content.',
      audience: 'People actively comparing local desktop AI assistants for working with private documents.',
      offer: 'Inspect the current Lemonade product and trial offer. Demonstrate one supported local-document workflow, then give a concrete way to try it.',
      constraints: 'No ad spend, invented claims, named prospects without sources or unapproved sending. Respect the product privacy promises. Use actual product and buyer sources. Identify missing distribution access clearly.',
      references: ['https://siplemona.de/'],
    } }); run = teamRun(app, product.id, id);
  } else if (['attention', 'paused'].includes(run.status)) teamAction(app, product.id, { command: 'resume', runId: run.id });
  const engine = new GrowthEngine(app);
  for (let n = 0; n < 7; n++) {
    scheduleTeamRuns(app); run = teamRun(app, product.id, run.id);
    if (run.status !== 'running') break;
    const next = run.steps.find(s => s.status !== 'done'); if (!next?.taskId) break;
    console.log(JSON.stringify({ role: next.role, status: 'starting' }));
    await engine.runNext(['marketing'], [next.taskId]); scheduleTeamRuns(app);
    run = teamRun(app, product.id, run.id);
    console.log(JSON.stringify({ role: next.role, status: run.steps.find(s => s.role === next.role)!.status, campaignStatus: run.status }));
  }
  const path = resolve(folder, 'lemonade-live-packet.json'); writeFileSync(path, JSON.stringify(run, null, 2));
  console.log(JSON.stringify({ status: run.status, completed: run.steps.filter(s => s.status === 'done').length, path }));
  if (run.status !== 'review' && run.status !== 'approved') process.exitCode = 2;
} finally { app.close(); }
