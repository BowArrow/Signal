import type { Command } from 'commander';
import { z } from 'zod';
import { createApp } from '../../core/app.js';
import { GrowthEngine } from '../../core/growth/engine.js';
import { applyGrowthAction, dashboard } from '../../core/growth/store.js';

export function registerGrowthCommands(program: Command): void {
  const growth = program
    .command('growth')
    .description('Local AI agents and Bullseye experiments');
  growth.command('status').action(() => {
    const app = createApp();
    try {
      console.log(JSON.stringify(dashboard(app), null, 2));
    } finally {
      app.close();
    }
  });
  growth.command('check').action(async () => {
    const app = createApp();
    try {
      const result = await new GrowthEngine(app).checkRuntime();
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    } finally {
      app.close();
    }
  });
  growth
    .command('research <product>')
    .description('Queue missing channel research for a product key')
    .action((key: string) => {
      const app = createApp();
      try {
        const state = dashboard(app);
        const config = app.config.products.find((p) => p.key === key);
        const product = state.products.find((p) => p.name === config?.name);
        if (!product) throw new Error(`Unknown product: ${key}`);
        const result = applyGrowthAction(app, {
          type: 'research',
          productId: product.id,
        });
        console.log(
          `Queued channel research. ${result.products.find((p) => p.id === product.id)?.tasks.filter((t) => t.status === 'queued').length ?? 0} tasks waiting. Run signal growth run or open the desktop app.`,
        );
      } finally {
        app.close();
      }
    });
  growth
    .command('run')
    .description('Run a bounded batch of queued local tasks')
    .option('--max <count>', 'Maximum tasks (1–50)', '3')
    .action(async (options: { max: string }) => {
      const max = z.coerce.number().int().min(1).max(50).parse(options.max);
      const app = createApp();
      const engine = new GrowthEngine(app);
      try {
        engine.schedule();
        let count = 0;
        while (count < max && (await engine.runNext())) {
          count++;
          console.log(`Completed local task ${count}/${max}`);
        }
        const state = dashboard(app);
        const failures = state.products
          .flatMap((p) => p.tasks)
          .filter((t) => t.status === 'failed');
        console.log(
          `${count} tasks processed; ${failures.length} failed tasks in recent history. Inspect growth status for details.`,
        );
      } finally {
        await engine.stop();
        app.close();
      }
    });
}
