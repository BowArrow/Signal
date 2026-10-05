// Local setup using normal application validation. No provider calls or message sends.
// Run only after the tested release is installed and Signal is closed.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { settings, products, studioLeads, growthTasks } from '../src/core/db/schema.js';
import { ConnectionService } from '../src/core/connections/service.js';
import { OperationsService } from '../src/core/operations/service.js';
import { ProspectResearchService } from '../src/core/sales/prospect-research.js';
import { OutreachService } from '../src/core/sales/outreach-service.js';
import { SalesService } from '../src/core/sales/service.js';
import { SalesReplyService } from '../src/core/sales/reply-service.js';
import { ProspectService } from '../src/core/sales/prospects.js';
import { RevenueService } from '../src/core/revenue/service.js';
import { AnalyticsService } from '../src/core/analytics/service.js';
import { isSalesSuppressed } from '../src/core/sales/suppression.js';
import { operationPolicySchema } from '../src/shared/operations.js';
import type { ProspectDraft } from '../src/shared/prospect-research.js';

const receipt = JSON.parse(readFileSync('data/operations-validation/release-0.51.json', 'utf8').replace(/^\uFEFF/, ''));
const checkCopy = process.argv.includes('--check-copy');
let databaseUrl = join(process.env['APPDATA']!, 'signal/signal.db');
if (checkCopy) {
  const owner = new Database(databaseUrl, { readonly: true, nativeBinding: resolve('native/better_sqlite3-node.node') });
  databaseUrl = resolve('data/operations-validation/activation-copy-' + Date.now() + '.db');
  try { await owner.backup(databaseUrl); } finally { owner.close(); }
} else {
  assert.ok(receipt.installed);
  assert.equal(createHash('sha256').update(readFileSync(join(process.env['LOCALAPPDATA']!, 'Programs/signal/resources/app.asar'))).digest('hex'), receipt.appAsarSha256);
  const processes = spawnSync('powershell.exe', ['-NoProfile', '-Command', '(Get-Process Signal -ErrorAction SilentlyContinue | Measure-Object).Count'], { windowsHide: true, encoding: 'utf8' });
  assert.equal(processes.stdout.trim(), '0', 'Quit Signal before updating its policies.');
}
const app = createApp({ databaseUrl, logger: silentLogger, migrate: false });
try {
  app.connections = new ConnectionService(app, { available: () => false, get: () => undefined, set: () => { throw Error('No credential changes'); }, delete: () => {} });
  app.sales = new SalesService(app); app.salesReplies = new SalesReplyService(app); app.outreach = new OutreachService(app);
  app.prospects = new ProspectService(app); app.revenue = new RevenueService(app); app.analytics = new AnalyticsService(app);
  app.operations = new OperationsService(app); app.prospectResearch = new ProspectResearchService(app);
  if (checkCopy) { for (const task of app.db.select().from(growthTasks).all().filter(t => ['queued','running'].includes(t.status))) app.db.update(growthTasks).set({ status: 'cancelled' }).where(eq(growthTasks.id, task.id)).run(); }
  assert.ok(!app.db.select().from(growthTasks).all().some(t => ['queued', 'running'].includes(t.status)), 'Resolve active tasks before reconfiguring.');
  const pitches = JSON.parse(readFileSync('output/marketing-audit/first-customer-pitches.json', 'utf8')) as { productKey: string; name: string; url: string; contact: string; quote: string; subject: string; body: string; fit: string; productUrl: string; productQuote: string; observedAt: number; bodyHash: string; sourceChecked: boolean }[];
  const report: unknown[] = [];
  const before = app.db.select().from(settings).all().filter(r => /^(operations\.policy|sales\.prospect-research|sales\.outreach-policy)\./.test(r.key));
  if (!checkCopy) writeFileSync('data/operations-validation/first-customers-policies-before.json', JSON.stringify(before, null, 2));
  app.db.transaction(() => {
    const lemonade = app.db.select().from(products).all().find(p => p.key === 'lemonade')!;
    const postal = app.outreach!.policy(lemonade.id).mailingAddress;
    for (const product of app.db.select().from(products).all().filter(p => ['lemonade','cinegen'].includes(p.key))) {
      const isLemonade = product.key === 'lemonade', state = app.operations!.state(product.id);
      assert.ok(!app.operations!.deliveries().some(d => d.productId === product.id && ['queued','dispatching','retry','attention'].includes(d.status)), 'Preserve pending publications.');
      const policy = operationPolicySchema.parse(Object.fromEntries(Object.keys(operationPolicySchema.shape).map(k => [k, state[k as keyof typeof state]])));
      policy.mode = 'acquisition'; policy.testChannels = true; policy.intervalHours = 1;
      policy.discovery = { enabled: true, queries: isLemonade ? [
        { kind: 'bluesky', query: '"documents" "recommend"' }, { kind: 'bluesky', query: '"PDF" "tool"' }, { kind: 'bluesky', query: '"reports" "compare"' }, { kind: 'bluesky', query: '"files" "search"' }, { kind: 'hn', query: 'document search' }, { kind: 'stackexchange', site: 'softwarerecs', query: 'search multiple documents' },
      ] : [
        { kind: 'bluesky', query: '"video" "recommend"' }, { kind: 'bluesky', query: '"storyboard" "tool"' }, { kind: 'hn', query: 'video production workflow' }, { kind: 'stackexchange', site: 'softwarerecs', query: 'storyboard video editor' },
      ] };
      app.operations!.configure(product.id, policy);
      const currentResearch = app.prospectResearch!.state(product.id);
      app.prospectResearch!.configure(product.id, { enabled: true, audience: currentResearch.audience, dailyDraftLimit: currentResearch.dailyDraftLimit, queries: isLemonade ? ['grant writing consultant United States services contact', 'proposal writing consultant United States source documents', 'independent research consultancy United States contact'] : ['small video production agency United States storyboarding contact', 'independent video studio United States pre production contact', 'short form video agency United States contact'] });
      const research = app.prospectResearch!.state(product.id);
      const pending = isLemonade ? ['https://www.cprastrategies.com/grant-writing-administration','https://www.brightlinegrants.com/'] : ['https://www.gorillacreative.com/video-production/marketing/promo','https://www.showpro.com/production-services/'];
      app.db.update(settings).set({ value: { ...research, pending }, updatedAt: app.clock.now() }).where(eq(settings.key, 'sales.prospect-research.' + product.id)).run();
      const sender = isLemonade ? 'sales@aionx.aionapp.org' : 'sales@outreach.cinegenaimedia.com';
      const source = app.sales!.sources().find(s => s.productId === product.id && s.senderEmail === sender && s.autoSync && s.aiTriage);
      assert.ok(source, 'Verified monitored sender missing for ' + product.name);
      if (!app.outreach!.policy(product.id).enabled) app.outreach!.configure(product.id, { enabled: true, accountId: source.accountId, objective: 'Help a prospect try one concrete product workflow. Use its source evidence and real product capabilities; invite a useful next step without invented results or urgency.', mailingAddress: postal, dailyLimit: 3, delayMinutes: 10, followUpDays: [] });
      for (const pitch of pitches.filter(p => p.productKey === product.key)) {
        assert.ok(pitch.sourceChecked && Date.now() - pitch.observedAt < 86400000 && createHash('sha256').update(pitch.body).digest('hex') === pitch.bodyHash);
        assert.ok(!isSalesSuppressed(app, product.id, pitch.contact) && !app.revenue!.purchaseForContact(product.id, pitch.contact));
        assert.ok(!app.sales!.messages(product.id).some(m => m.from === pitch.contact), 'Existing conversation must be reviewed first.');
        const id = createHash('sha256').update(product.id + ':' + new URL(pitch.url).hostname.replace(/^www\./, '')).digest('hex');
        const existing = app.db.select().from(studioLeads).where(eq(studioLeads.productId, product.id)).all().find(l => l.id === id || l.value.contact === pitch.contact);
        if (existing) {
          const saved = app.db.select().from(settings).where(eq(settings.key, 'sales.prospect-draft.' + id)).get()?.value as ProspectDraft | undefined;
          assert.ok(existing.id === id && saved?.contact === pitch.contact && saved.body === pitch.body, 'Preserve changed prospect ' + pitch.name);
          continue;
        }
        const now = app.clock.now();
        const draft: ProspectDraft = { id, productId: product.id, leadId: id, kind: 'business', rulesUrl: '', rulesQuote: '', nextStep: 'Review this specific introduction and approve it to queue one email. No automatic cold follow-up.', name: pitch.name, url: pitch.url, contact: pitch.contact, contactSource: pitch.url, fit: pitch.fit, prospectQuote: pitch.quote, productQuote: pitch.productQuote, productUrl: pitch.productUrl, observedAt: pitch.observedAt, createdAt: now, updatedAt: now, status: 'draft', detail: 'Prepared by Codex from verified public business and product pages. Not sent; no buying intent or opt-in inferred.', subject: pitch.subject, body: pitch.body };
        app.db.insert(studioLeads).values({ id, productId: product.id, value: { name: pitch.name, contact: pitch.contact, permission: 'unknown', stage: 'discovered', source: pitch.url, notes: pitch.fit, followUpAt: null, campaignId: '' }, createdAt: now }).run();
        app.db.insert(settings).values({ key: 'sales.prospect-draft.' + id, value: draft, updatedAt: now }).run();
      }
      app.operations!.run(product.id);
      report.push({ business: product.name, running: app.operations!.state(product.id).running, researchEnabled: true, draftsAdded: pitches.filter(p => p.productKey === product.key).length, sender, emailDailyLimit: app.outreach!.policy(product.id).dailyLimit, readiness: app.operations!.readiness(product.id) });
    }
  });
  writeFileSync('data/operations-validation/first-customers-activation' + (checkCopy ? '-copy-check' : '') + '.json', JSON.stringify({ report, emailsSent: 0, checkCopy }, null, 2));
  console.log(JSON.stringify({ report, emailsSent: 0, checkCopy }));
} finally { app.close(); }
