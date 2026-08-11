import { type Command } from 'commander';
import { createApp } from '../../core/app.js';
import { OpenAiCompatibleClient } from '../../core/llm/openai-compatible.js';
import { taskStats } from '../../core/llm/recording.js';
import { bold, cyan, dim, green, heading, magenta, red, table, yellow } from '../format.js';

function ms(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}

export function registerLlmCommands(program: Command): void {
  const llm = program.command('llm').description('the model behind scoring and drafting');

  llm
    .command('check', { isDefault: true })
    .description('is the configured model actually reachable')
    .action(async () => {
      const app = createApp();
      const { provider, baseUrl, models } = app.config.llm;

      console.log(heading('Model configuration'));
      console.log(`  provider   ${cyan(provider)}`);
      if (baseUrl) console.log(`  base url   ${dim(baseUrl)}`);
      for (const [task, model] of Object.entries(models)) {
        console.log(`  ${task.padEnd(16)} ${magenta(model)}`);
      }

      const readiness = app.llm.available();
      console.log(
        `\n  ${readiness.ready ? green('● ready') : red('○ unavailable')}` +
          (readiness.reason ? dim(`  ${readiness.reason}`) : ''),
      );

      if (provider === 'openai-compatible' && baseUrl) {
        const probe = new OpenAiCompatibleClient(baseUrl, app.logger);
        const result = await probe.ping();
        console.log(
          `  ${result.ok ? green('● server reachable') : red('○ server unreachable')}  ${dim(result.detail)}`,
        );

        if (result.ok && result.models) {
          console.log(`\n  ${bold('models the server reports')}`);
          for (const name of result.models) console.log(`    ${name}`);

          // A model name that does not exist on the server fails at the first
          // real call, which would otherwise be halfway through a batch.
          const missing = Object.entries(models).filter(([, m]) => !result.models?.includes(m));
          if (missing.length > 0) {
            console.log(
              `\n  ${yellow('configured but not served:')} ${missing.map(([t, m]) => `${t}=${m}`).join(', ')}`,
            );
          }
        } else if (!result.ok) {
          console.log(
            dim(
              `\n  Start the runtime and make sure it serves ${baseUrl}.\n` +
                '  Any OpenAI-compatible server works: llama-server, vLLM, LM Studio, Ollama.',
            ),
          );
        }
      }

      console.log();
      app.close();
    });

  llm
    .command('stats')
    .description('what the model actually costs and whether it holds the JSON contract')
    .option('-d, --days <days>', 'only calls from the last N days')
    .action((opts: { days?: string }) => {
      const app = createApp();
      const since = opts.days
        ? app.clock.now() - Number.parseInt(opts.days, 10) * 86_400_000
        : undefined;

      const stats = taskStats(app.db, since);

      console.log(heading('Model calls by task'));
      if (stats.length === 0) {
        console.log(dim('  Nothing recorded yet. Run `pnpm signal score` or `pnpm signal draft`.\n'));
        app.close();
        return;
      }

      console.log(
        table(stats, [
          { header: 'task', value: (s) => cyan(s.task) },
          { header: 'model', value: (s) => magenta(s.model), max: 28 },
          { header: 'calls', align: 'right', value: (s) => String(s.calls) },
          {
            header: 'failed',
            align: 'right',
            value: (s) => (s.failures ? red(String(s.failures)) : dim('0')),
          },
          {
            header: 'json ok',
            align: 'right',
            value: (s) => {
              if (s.jsonOkRate == null) return dim('—');
              const pct = `${(s.jsonOkRate * 100).toFixed(0)}%`;
              // Below ~95% the pipeline is spending real money on retries and
              // falling back to cautious defaults more than it should.
              return s.jsonOkRate >= 0.95 ? green(pct) : yellow(pct);
            },
          },
          { header: 'median', align: 'right', value: (s) => dim(ms(s.medianLatencyMs)) },
          { header: 'p95', align: 'right', value: (s) => dim(ms(s.p95LatencyMs)) },
          {
            header: 'tok/s',
            align: 'right',
            value: (s) => (s.tokensPerSecond == null ? dim('—') : s.tokensPerSecond.toFixed(1)),
          },
        ]),
      );

      const weak = stats.filter((s) => s.jsonOkRate != null && s.jsonOkRate < 0.95);
      if (weak.length > 0) {
        console.log(
          `\n  ${yellow('Below 95% JSON compliance:')} ${weak.map((s) => s.task).join(', ')}.` +
            dim('\n  Those tasks fall back to cautious defaults more often than they should.') +
            dim('\n  Worth moving just those to a stronger model rather than all of them.'),
        );
      }
      console.log();
      app.close();
    });
}
