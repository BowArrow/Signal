// Add only the four prepared drafts. Does not change policies, start workers or send.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { products, settings, studioLeads } from '../src/core/db/schema.js';
import { isSalesSuppressed } from '../src/core/sales/suppression.js';
import { RevenueService } from '../src/core/revenue/service.js';
import { SalesService } from '../src/core/sales/service.js';
import type { ProspectDraft } from '../src/shared/prospect-research.js';
const app = createApp({ databaseUrl: join(process.env['APPDATA']!, 'signal/signal.db'), logger: silentLogger, migrate: false });
try {
  app.revenue = new RevenueService(app); app.sales = new SalesService(app);
  const pitches = JSON.parse(readFileSync('output/marketing-audit/first-customer-pitches.json', 'utf8')) as { productKey: string; name: string; contact: string; url: string; productUrl: string; fit: string; quote: string; productQuote: string; subject: string; body: string; bodyHash: string; observedAt: number; sourceChecked: boolean }[];
  assert.equal(pitches.length, 4);
  const added: { business: string; name: string; id: string }[] = [];
  app.db.transaction(() => {
    for (const p of pitches) {
      assert.ok(p.sourceChecked && Date.now() - p.observedAt < 86400000 && createHash('sha256').update(p.body).digest('hex') === p.bodyHash);
      const product = app.db.select().from(products).where(eq(products.key, p.productKey)).get(); assert.ok(product);
      assert.ok(!isSalesSuppressed(app, product.id, p.contact) && !app.revenue!.purchaseForContact(product.id, p.contact));
      assert.ok(!app.sales!.messages(product.id).some(m => m.from === p.contact));
      const id = createHash('sha256').update(product.id + ':' + new URL(p.url).hostname.replace(/^www\./, '')).digest('hex');
      assert.ok(!app.db.select().from(studioLeads).where(eq(studioLeads.productId, product.id)).all().some(l => l.id === id || l.value.contact === p.contact), 'Preserve existing contact');
      const now = app.clock.now();
      const draft: ProspectDraft = { id, productId: product.id, leadId: id, name: p.name, kind: 'business', rulesUrl: '', rulesQuote: '', nextStep: 'Review and approve one introduction. No automatic cold follow-up.', url: p.url, contact: p.contact, contactSource: p.url, productUrl: p.productUrl, productQuote: p.productQuote, prospectQuote: p.quote, fit: p.fit, subject: p.subject, body: p.body, status: 'draft', detail: 'Prepared by Codex from verified public business and product pages. Not sent; no buying intent or opt-in inferred.', observedAt: p.observedAt, createdAt: now, updatedAt: now };
      app.db.insert(studioLeads).values({ id, productId: product.id, value: { name: p.name, contact: p.contact, permission: 'unknown', stage: 'discovered', source: p.url, notes: p.fit, followUpAt: null, campaignId: '' }, createdAt: now }).run();
      app.db.insert(settings).values({ key: 'sales.prospect-draft.' + id, value: draft, updatedAt: now }).run();
      added.push({ business: product.name, name: p.name, id });
    }
  });
  writeFileSync('data/operations-validation/first-customer-drafts-imported.json', JSON.stringify({ added, emailsSent: 0, policiesChanged: false }, null, 2));
  console.log(JSON.stringify({ added, emailsSent: 0, policiesChanged: false }));
} finally { app.close(); }
