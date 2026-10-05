import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../../src/core/app.js';
import { silentLogger } from '../../src/core/lib/logger.js';
import { __setConfigForTests } from '../../src/core/config/load.js';
import { settings } from '../../src/core/db/schema.js';
import { campaignFeedback, clearRecoveredFinding, rememberCampaignRejection } from '../../src/core/operations/feedback.js';

let app: App; let now: number;
const source = { url: 'https://siplemona.de/', body: 'Compare local documents and inspect their original sources.' };
const input = { title: 'An unsupported outcome', demand: { findingId: 'public-question' } };
const rejected = new Error('Editorial review requires revision: The source does not support that outcome.');
beforeEach(() => { vi.stubEnv('SIGNAL_OFFLINE', '1'); __setConfigForTests(null); now = 1789600000000; app = createApp({ databaseUrl: ':memory:', logger: silentLogger, clock: { now: () => now } }); });
afterEach(() => { app.close(); vi.unstubAllEnvs(); __setConfigForTests(null); });
it('retains correction history and defers a repeatedly rejected finding only for its business and source', () => {
  rememberCampaignRejection(app, 'business-a', 'task', 0, source, input, rejected);
  expect(campaignFeedback(app, 'business-a', source).deferredFindingIds).toEqual([]);
  rememberCampaignRejection(app, 'business-a', 'task', 1, source, input, rejected);
  expect(campaignFeedback(app, 'business-a', source)).toMatchObject({ deferredFindingIds: ['public-question'], corrections: [{ title: input.title }, { title: input.title }] });
  expect(campaignFeedback(app, 'business-b', source).corrections).toEqual([]);
  expect(campaignFeedback(app, 'business-a', { ...source, body: source.body + ' New verified capability.' }).corrections).toEqual([]);
  expect(campaignFeedback(app, 'business-a', { ...source, url: 'https://cinegenaimedia.com/' }).corrections).toEqual([]);
  expect(campaignFeedback(app, 'business-a', { ...source, body: '  ' + source.body + '\n' }).deferredFindingIds).toEqual(['public-question']);
});
it('survives a service read without counting the same attempt twice and expires after a week', () => {
  for (let i = 0; i < 2; i++) rememberCampaignRejection(app, 'business-a', 'task', 0, source, input, rejected);
  expect(campaignFeedback(app, 'business-a', source).corrections).toHaveLength(1);
  now += 7 * 86400000;
  expect(campaignFeedback(app, 'business-a', source)).toEqual({ deferredFindingIds: [], corrections: [] });
});
it('does not remember transport errors, structural problems, malformed drafts or incomplete evidence', () => {
  for (const error of [new Error('timeout'), new Error('Inspect the current product website'), new Error('Editorial review did not produce a valid evidence check')]) rememberCampaignRejection(app, 'business-a', 'task', 0, source, input, error);
  rememberCampaignRejection(app, 'business-a', 'task', 0, {}, input, rejected);
  rememberCampaignRejection(app, 'business-a', 'task', 0, source, {}, rejected);
  expect(campaignFeedback(app, 'business-a', source).corrections).toEqual([]);
});
it('bounds persisted feedback and model context without treating none as a research finding', () => {
  for (let i = 0; i < 40; i++) rememberCampaignRejection(app, 'business-a', 'task-' + i, 0, source, { ...input, demand: { findingId: 'none' } }, rejected);
  const saved = app.db.select().from(settings).where(eq(settings.key, 'operations.editorial-feedback.business-a')).get()!.value as unknown[];
  expect(saved).toHaveLength(24); expect(campaignFeedback(app, 'business-a', source).corrections).toHaveLength(4);
  expect(campaignFeedback(app, 'business-a', source).deferredFindingIds).toEqual([]);
});
it('clears a finding recovered by an accepted revision while retaining unrelated corrections', () => {
  rememberCampaignRejection(app, 'business-a', 'task', 0, source, input, rejected);
  rememberCampaignRejection(app, 'business-a', 'task', 1, source, input, rejected);
  rememberCampaignRejection(app, 'business-a', 'other-task', 0, source, { ...input, demand: { findingId: 'another-question' } }, rejected);
  clearRecoveredFinding(app, 'business-a', source, { demand: { findingId: 'none' } });
  expect(campaignFeedback(app, 'business-a', source).deferredFindingIds).toEqual(['public-question']);
  clearRecoveredFinding(app, 'business-a', source, input);
  expect(campaignFeedback(app, 'business-a', source).deferredFindingIds).toEqual([]);
  expect(campaignFeedback(app, 'business-a', source).corrections).toHaveLength(1);
});
it('ignores malformed or future-dated saved entries without losing valid corrections', () => {
  rememberCampaignRejection(app, 'business-a', 'task', 0, source, input, rejected);
  const key = 'operations.editorial-feedback.business-a';
  const saved = app.db.select().from(settings).where(eq(settings.key, key)).get()!.value as Record<string, unknown>[];
  app.db.update(settings).set({ value: [...saved, { ...saved[0], at: now + 1000 }, { unexpected: true }] }).where(eq(settings.key, key)).run();
  expect(campaignFeedback(app, 'business-a', source).corrections).toHaveLength(1);
});
