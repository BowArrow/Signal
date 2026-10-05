import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { publicPage } from '../src/core/marketing/web.js';
import { businessEmails } from '../src/core/sales/prospect-research.js';
import { prospectCopyWarnings } from '../src/core/sales/prospect-copy.js';
import type { ProspectDraft } from '../src/shared/prospect-research.js';

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
const app = createApp({ databaseUrl: ':memory:', logger: silentLogger });
try {
  for (const file of process.argv.slice(2)) {
    const artifact = JSON.parse(readFileSync(file, 'utf8')) as { drafts: ProspectDraft[]; sourceRechecks?: { at: number; previousObservedAt: number[] }[] };
    const previousObservedAt = artifact.drafts.map(draft => draft.observedAt);
    for (const draft of artifact.drafts) {
      const pages = await Promise.all([publicPage(app, draft.url), publicPage(app, draft.productUrl), draft.contact ? publicPage(app, draft.contactSource) : null, draft.rulesUrl ? publicPage(app, draft.rulesUrl) : null]);
      assert.ok(normalize(pages[0].body).includes(normalize(draft.prospectQuote)), 'Prospect evidence changed.');
      assert.ok(normalize(pages[1].body).includes(normalize(draft.productQuote)), 'Product evidence changed.');
      if (pages[2]) assert.ok(businessEmails(pages[2], draft.url).includes(draft.contact), 'Published contact changed.');
      if (pages[3] && draft.rulesQuote) assert.ok(normalize(pages[3].body).includes(normalize(draft.rulesQuote)), 'Contributor guidance changed; review before importing.');
      assert.deepEqual(prospectCopyWarnings(draft.subject, draft.body), [], 'Draft has unresolved copy defects.');
      draft.observedAt = Math.min(...pages.filter(page => page !== null).map(page => page.observedAt));
    }
    artifact.sourceRechecks = [...artifact.sourceRechecks ?? [], { at: Date.now(), previousObservedAt }];
    writeFileSync(file, JSON.stringify(artifact, null, 2));
    console.log(JSON.stringify({ file, sourcesRechecked: true, drafts: artifact.drafts.map(draft => ({ name: draft.name, status: draft.status })) }));
  }
} finally { app.close(); }
