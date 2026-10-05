/** Real model validation, isolated from the user's experiment measurements. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createApp } from '../src/core/app.js';
import { GrowthEngine } from '../src/core/growth/engine.js';
import {
  applyGrowthAction,
  dashboard,
  DEFAULT_SETTINGS,
  queueTask,
} from '../src/core/growth/store.js';

mkdirSync('data/growth-validation', { recursive: true });
const databaseUrl = `data/growth-validation/local-${Date.now()}.db`;
const app = createApp({ databaseUrl });
const engine = new GrowthEngine(app);
try {
  if (process.argv[2])
    applyGrowthAction(app, {
      type: 'settings',
      value: { ...DEFAULT_SETTINGS, model: process.argv[2] },
    });
  const runtime = await engine.checkRuntime();
  if (!runtime.ok) throw new Error(runtime.detail);
  const product = dashboard(app).products[0]!;
  const channel = product.channels.find((c) => c.key === 'content')!;
  queueTask(app, product.id, 'research', channel.id);
  let start = Date.now();
  await engine.runNext();
  console.log(`Research: ${Date.now() - start}ms`);
  let state = dashboard(app).products[0]!;
  if (!state.channels.find((c) => c.id === channel.id)?.idea)
    throw new Error(state.tasks[0]?.error ?? 'Research missing');
  applyGrowthAction(app, { type: 'shortlist', channelId: channel.id });
  start = Date.now();
  await engine.runNext();
  console.log(`Campaign: ${Date.now() - start}ms`);
  queueTask(app, product.id, 'analysis', product.id);
  start = Date.now();
  await engine.runNext();
  console.log(`Analysis: ${Date.now() - start}ms`);
  state = dashboard(app).products[0]!;
  writeFileSync(
    'data/growth-validation/local-output.json',
    JSON.stringify(state, null, 2),
  );
  const failures = state.tasks.filter((t) => t.status !== 'done');
  if (failures.length)
    throw new Error(failures.map((t) => `${t.kind}: ${t.error}`).join('\n'));
  console.log(
    JSON.stringify(
      {
        runtime,
        databasePath: databaseUrl,
        tasks: state.tasks.map((t) => ({
          kind: t.kind,
          status: t.status,
          model: t.model,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await engine.stop();
  app.close();
}
