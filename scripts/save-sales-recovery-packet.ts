// Explicit local preparation only. No workers, external requests, publication or sends.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { executeMarketingTool } from '../src/core/marketing/agent.js';
import { remember } from '../src/core/marketing/store.js';
import { products, settings } from '../src/core/db/schema.js';

process.env['SIGNAL_OFFLINE'] = '1';
const profile = process.env['APPDATA'];
if (!profile) throw new Error('Windows owner profile required.');
const app = createApp({ databaseUrl: join(profile, 'signal', 'signal.db'), logger: silentLogger, migrate: false });
try {
  const lemonade = app.db.select().from(products).where(eq(products.key, 'lemonade')).get();
  const cinegen = app.db.select().from(products).where(eq(products.key, 'cinegen')).get();
  if (!lemonade || !cinegen) throw new Error('Both configured products are required.');
  const packet = readFileSync('campaigns/sales-recovery-2026-11-12/verification-and-copy.md', 'utf8');
  const section = (heading: string) => packet.split(`## ${heading}\n`)[1]!.split('\n## ')[0]!.trim();
  const evidence = ['Prepared on 2026-11-12. Review only; not published or sent.', 'https://siplemona.de/', 'https://news.ycombinator.com/showhn.html', 'https://alternativeto.net/faq/', 'docs/marketing-sales-audit-2026-11-12.md'];
  const drafts = [];
  for (const [heading, kind, targetUrl] of [
    ['Product check', 'demo', 'https://siplemona.de/'],
    ['Show HN submission draft', 'social', 'https://news.ycombinator.com/submit'],
    ['AlternativeTo fallback listing draft', 'social', 'https://alternativeto.net/'],
  ] as const) {
    drafts.push(await executeMarketingTool(app, lemonade.id, 'draft.save', { title: `Sales recovery: ${heading}`, body: section(heading), kind, targetUrl, evidence }, AbortSignal.timeout(30000)));
  }
  drafts.push(await executeMarketingTool(app, cinegen.id, 'draft.save', {
    title: 'Sales recovery: CineGen first useful edit', kind: 'demo', targetUrl: 'https://cinegenaimedia.com/',
    body: 'Hypothesis: a creator with existing footage can get value from CineGen before buying AI generation. First restore current GA4 property access; the last complete report is stale. With a consenting tester, open the free editor, create one local project, import their own non-sensitive clip, trim it and export a watermarked 720p result. Record each observed failure and the actual exported result. Do not spend generation tokens for this first task. Ask what editor they normally use, why they would switch, and whether story planning or generated shots are worth paying for. No successful test is claimed by this draft. After product verification, proposed copy for a relevant permitted placement: "I build CineGen. If you already have footage, you can try the browser editor before choosing an AI plan: import a clip, trim it and export a watermarked 720p cut. One local project is free. What gets in the way when you move from generated clips to a finished edit? https://cinegenaimedia.com/?utm_source=founder_demo&utm_medium=community&utm_campaign=first_edit_202611". Full AI generation and planning are paid features; do not call the whole product free. Choose a specific community and verify its rules before using this copy. Log the live placement URL, tagged visits, voluntarily reported task results, and actual payments separately. This draft authorizes no outreach or publication.',
    evidence: ['https://cinegenaimedia.com/', 'Current public offer checked 2026-11-12; demonstration not yet product-verified.', 'docs/marketing-sales-audit-2026-11-12.md'],
  }, AbortSignal.timeout(30000)));
  app.db.transaction(() => {
    if (lemonade.priceCents === 4900) app.db.update(products).set({ priceCents: 14900, proofPoints: [...lemonade.proofPoints.filter(p => !/\$49\b|4900|one.time license|perpetual/i.test(p)), 'Offer checked 2026-11-12 at https://siplemona.de/: 14-day trial; $149/year or $15/month per person. Annual price is not lifetime value.'], updatedAt: app.clock.now() }).where(eq(products.id, lemonade.id)).run();
    const key = `marketing.guide-plan.${lemonade.id}`;
    const existing = app.db.select().from(settings).where(eq(settings.key, key)).get();
    const previousPlan = existing?.value as { goal?: string; audience?: string } | undefined;
    if (!previousPlan?.audience?.trim()) app.db.insert(settings).values({ key, value: { goal: previousPlan?.goal ?? 'first-sales', audience: 'People actively comparing local desktop AI assistants for working with private documents.' }, updatedAt: app.clock.now() }).onConflictDoUpdate({ target: settings.key, set: { value: { goal: previousPlan?.goal ?? 'first-sales', audience: 'People actively comparing local desktop AI assistants for working with private documents.' }, updatedAt: app.clock.now() } }).run();
    const marker = 'marketing.sales-audit.2026-11-12';
    if (!app.db.select().from(settings).where(eq(settings.key, marker)).get()) {
      for (const product of [lemonade, cinegen]) remember(app, product.id, { title: 'Sales audit and recovery packet — November 12', body: 'Current audit: insufficient verified distribution and incomplete measurement. New recovery drafts are saved for review. Do not count them as live placements or sales. Inspect current product facts before copy. Lemonade recorded 8 measured sessions for Oct13-Nov11; CineGen current analytics is unavailable. Both product-scoped Stripe snapshots contain zero payments. New offer and source-grounded plan: docs/marketing-sales-audit-2026-11-12.md. Product demonstration remains unverified; no outreach or publication was performed.', kind: 'observation', source: 'docs/marketing-sales-audit-2026-11-12.md', confidence: 0.95 });
      app.db.insert(settings).values({ key: marker, value: { at: app.clock.now(), drafts }, updatedAt: app.clock.now() }).run();
    }
  });
  writeFileSync('output/marketing-audit/prepared-packet.json', JSON.stringify({ checkedAt: new Date().toISOString(), drafts, published: false, sent: false }, null, 2));
  console.log(JSON.stringify({ drafts, published: false, sent: false }));
} finally { app.close(); }
