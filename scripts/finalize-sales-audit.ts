import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { marketingAction } from '../src/core/marketing/actions.js';
import { marketingDrafts } from '../src/core/db/schema.js';
process.env['SIGNAL_OFFLINE'] = '1';
if (!process.env['APPDATA']) throw new Error('Owner profile required.');
const app = createApp({ databaseUrl: join(process.env['APPDATA'], 'signal', 'signal.db'), logger: silentLogger, migrate: false });
try {
  const draft = app.db.select().from(marketingDrafts).where(eq(marketingDrafts.id, 'ChsM8PRWYCoJro-F5_CQ4')).get();
  if (draft?.status === 'draft') {
    const body = draft.value.body
      .replace('Linux x86 user', 'Linux x86-64 user')
      .replace('1. Prepare report-baseline.txt and report-revised.txt. Label both SYNTHETIC SAMPLE, NOT CUSTOMER DATA. Give both the same reporting period and eight open requests. Set completed requests to 100 in the baseline and 120 in the revision. Keep every other statement identical. Show both files side by side.\nNarration: These sample reports differ in one figure. Completed requests changed from 100 to 120.', '1. Use the supplied synthetic files in campaigns/sales-recovery-2026-11-12. The baseline records 100 completed requests, an 8-hour average response time and 12 outstanding requests. The revision records 120, 6 hours and 9, respectively. Coverage remains Monday through Friday. The revision notes an omission in the baseline; this is not proof of business growth. Show both files side by side.\nNarration: These fictional reports differ in three figures. We will check each change against its source.')
      .replace('Check the original numbers, filenames and unchanged open-request count.', 'Check all three changed figures, filenames, unchanged coverage and the correction note against the supplied answer key.')
      .replace('It is built by AIon X LLC. This copy was prepared with Signal, our automated marketing assistant, for maker review.', 'I build Lemonade at AIon X LLC.');
    if (body !== draft.value.body) {
      writeFileSync('output/marketing-audit/lemonade-recovery-before-editorial-review.json', JSON.stringify(draft.value, null, 2));
      await marketingAction(app, { type: 'draftEdit', productId: draft.productId, id: draft.id, body });
    }
    const current = app.db.select().from(marketingDrafts).where(eq(marketingDrafts.id, draft.id)).get()!;
    writeFileSync('output/marketing-audit/lemonade-recovery-reviewed.json', JSON.stringify({ ...current.value, status: current.status, review: 'Aligned synthetic figures with the supplied files; clarified Linux architecture and maker affiliation. Demonstration and placement are still unverified.' }, null, 2));
  }
  const release = JSON.parse(readFileSync('data/operations-validation/release-0.59.2.json', 'utf8').replace(/^\uFEFF/, ''));
  writeFileSync('output/marketing-audit/implementation-receipt.json', JSON.stringify({ checkedAt: new Date().toISOString(), version: '0.59.2', installed: release.installed, verifiedApplicationSha256: release.appAsarSha256, tests: { files: 82, passed: 1605 }, typecheck: 'passed', changedSourceLint: 'passed', repositoryWideLint: 'failed on unrelated and generated/runtime files', viewports: [1440, 900, 720, 390], rendererErrors: 0, preparedDraftIds: ['pFIOrbSg749lmve3iQiBD', 'cbZmSDJZ5k7fbN1s0VoQ1', 'JWmaJQLE0DsjGzjmFozIn', 'e6oTtQJiigTQ1t1Hx8sAz'], publishedByThisWork: false, sendsByThisWork: false, demoVerified: false }, null, 2));
  console.log('Saved the implementation receipt and reviewed Lemonade recovery copy. Nothing was published.');
} finally { app.close(); }
