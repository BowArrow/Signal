import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, type App } from '../../src/core/app.js';
import { GrowthEngine } from '../../src/core/growth/engine.js';
import { SalesService } from '../../src/core/sales/service.js';
import { SalesReplyService } from '../../src/core/sales/reply-service.js';
import { OutreachService } from '../../src/core/sales/outreach-service.js';
import { silentLogger } from '../../src/core/lib/logger.js';

let app: App;
let engine: GrowthEngine;
let releaseResearch: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  app = createApp({ databaseUrl: ':memory:', logger: silentLogger });
  app.sales = new SalesService(app);
  app.salesReplies = new SalesReplyService(app);
  app.outreach = new OutreachService(app);
  vi.spyOn(app.sales, 'tick').mockResolvedValue();
  vi.spyOn(app.salesReplies, 'tick').mockResolvedValue();
  vi.spyOn(app.outreach, 'tick').mockResolvedValue();
  engine = new GrowthEngine(app);
  vi.spyOn(engine, 'schedule').mockImplementation(() => {});
  const research = new Promise<boolean>(resolve => { releaseResearch = () => resolve(false); });
  vi.spyOn(engine, 'runNext').mockReturnValue(research);
});

afterEach(async () => {
  releaseResearch();
  await engine.stop();
  await vi.advanceTimersByTimeAsync(0);
  app.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('refreshes inboxes and delivers approved mail repeatedly while research is pending', async () => {
  engine.start();
  engine.start(); // Starting twice must not duplicate either worker.
  await vi.advanceTimersByTimeAsync(0);
  expect(engine.runNext).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(6000);
  for (const service of [app.sales!, app.salesReplies!, app.outreach!]) {
    expect(vi.mocked(service.tick).mock.calls.filter(([agentsReady]) => agentsReady === false)).toHaveLength(4);
  }
  expect(engine.runNext).toHaveBeenCalledTimes(1);
  await engine.stop();
  const calls = vi.mocked(app.outreach!.tick).mock.calls.length;
  await vi.advanceTimersByTimeAsync(10000);
  expect(app.outreach!.tick).toHaveBeenCalledTimes(calls);
});

it('waits for mailbox refresh and never overlaps delivery passes', async () => {
  let finishScan!: () => void;
  const scan = new Promise<void>(resolve => { finishScan = resolve; });
  vi.mocked(app.sales!.tick).mockImplementation(agentsReady => agentsReady === false ? scan : Promise.resolve());
  engine.start();
  await vi.advanceTimersByTimeAsync(10000);
  expect(vi.mocked(app.sales!.tick).mock.calls.filter(([ready]) => ready === false)).toHaveLength(1);
  expect(vi.mocked(app.outreach!.tick).mock.calls.filter(([ready]) => ready === false)).toHaveLength(0);
  finishScan();
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.mocked(app.outreach!.tick).mock.calls.filter(([ready]) => ready === false)).toHaveLength(1);
});

it('retries a failed inbox check without dispatching against that failed pass', async () => {
  vi.mocked(app.sales!.tick).mockRejectedValueOnce(new Error('Mailbox unavailable'));
  engine.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.mocked(app.outreach!.tick).mock.calls.filter(([ready]) => ready === false)).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(2000);
  expect(vi.mocked(app.outreach!.tick).mock.calls.filter(([ready]) => ready === false)).toHaveLength(1);
});

it('does not dispatch after shutdown while a mailbox check finishes', async () => {
  let finishScan!: () => void;
  const scan = new Promise<void>(resolve => { finishScan = resolve; });
  vi.mocked(app.sales!.tick).mockImplementation(agentsReady => agentsReady === false ? scan : Promise.resolve());
  engine.start();
  await vi.advanceTimersByTimeAsync(0);
  const stopping = engine.stop();
  finishScan();
  await stopping;
  await vi.advanceTimersByTimeAsync(4000);
  expect(vi.mocked(app.outreach!.tick).mock.calls.filter(([ready]) => ready === false)).toHaveLength(0);
});
