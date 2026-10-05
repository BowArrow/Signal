// Prepare source-checked local drafts only. No account access or sending service.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createApp } from '../src/core/app.js';
import { silentLogger } from '../src/core/lib/logger.js';
import { publicPage } from '../src/core/marketing/web.js';
import { businessEmails } from '../src/core/sales/prospect-research.js';
import { prospectCopyWarnings } from '../src/core/sales/prospect-copy.js';

const proposals = [
  { productKey: 'lemonade', name: 'Clarifier Consulting', url: 'https://www.clarifierconsulting.com/', contact: 'hello@clarifierconsulting.com', quote: 'We help with SBIR/STTR and other startup R&D funding mechanisms.', subject: 'Working from source files on SBIR proposals', body: 'Hi Clarifier team,\n\nYour work on SBIR/STTR proposals caught my eye. We build Lemonade, a Windows and Linux app that answers questions across local documents and helps turn source material into editable drafts.\n\nOne possible use is comparing research notes and a previous proposal before drafting a new section, then checking the answer against its sources.\n\nWould a short walkthrough of that workflow be useful? You can also try it with your own files: https://siplemona.de/#pricing', fit: 'US grant consultancy with a documented proposal-development workflow. Source comparison is a possible fit; its operating system and interest are unknown.' },
  { productKey: 'lemonade', name: 'The Grant Co.', url: 'https://www.thegrantco.org/services', contact: 'hello@thegrantco.org', quote: 'We will write and edit a compelling and effective narrative', subject: 'Turning grant source notes into a first draft', body: 'Hi Grant Co. team,\n\nYour services include grant research and narrative writing. We build Lemonade, a Windows and Linux app for asking questions across source documents and creating editable drafts.\n\nIt could be worth trying on one task: bring together project notes and an earlier report, draft a section, and check its supporting sources before editing.\n\nIs that a workflow you would want to test? There is a free trial here: https://siplemona.de/#pricing', fit: 'Wichita consultancy with grant research and narrative-writing services. Relevant document workflow hypothesis, not expressed purchase intent.' },
  { productKey: 'cinegen', name: 'A Little Video', url: 'https://www.alittlevideo.com/', contact: 'info@alittlevideo.com', quote: 'concepting, storyboarding, script, pre-production planning, shooting, final editing and more.', subject: 'A way to test a short video concept before filming', body: 'Hi A Little Video team,\n\nYour packages focus on short videos for small businesses, with planning before the shoot. We build CineGen, which brings scene planning, AI-generated clips and editing into one workspace.\n\nA small test would be to sketch three scenes for a 30-second concept and assemble a rough preview before filming.\n\nWould you be interested in trying that on a sample brief? You can start free here: https://cinegenaimedia.com/', fit: 'US short-form video business with a stated planning and storyboarding process. A rough concept preview may fit; interest and production requirements are unknown.' },
  { productKey: 'cinegen', name: 'Altman Creative Agency', url: 'https://altmancreativeagency.com/content-creation/', contact: 'hello@altmancreativeagency.com', quote: 'Storyboarding & Pre-Production', subject: 'Testing an ad concept before the shoot', body: 'Hi Altman team,\n\nYour content service includes storyboarding and short social ads. We build CineGen, a workspace for planning scenes, generating AI clips and editing them into a video.\n\nOne way to try it is a three-scene rough cut for a sample ad concept before committing to a shoot.\n\nWould a brief walkthrough of that process be useful? The free starting point is here: https://cinegenaimedia.com/', fit: 'Southern California agency offering short social ads and storyboarding. Concept previews are a possible fit, not proof of a current need.' },
];
const app = createApp({ databaseUrl: ':memory:', logger: silentLogger });
const folder = 'output/marketing-audit'; mkdirSync(folder, { recursive: true });
try {
  const products = new Map();
  for (const [key, url] of [['lemonade', 'https://siplemona.de/'], ['cinegen', 'https://cinegenaimedia.com/']] as const) products.set(key, await publicPage(app, url));
  const rows = [];
  for (const proposal of proposals) {
    const page = await publicPage(app, proposal.url);
    const normalize = (s: string) => s.replace(/\s+/g, ' ').toLowerCase().trim();
    if (!normalize(page.body).includes(normalize(proposal.quote))) throw Error('Evidence not found for ' + proposal.name);
    if (!businessEmails(page, page.url).includes(proposal.contact)) throw Error('Published contact not found for ' + proposal.name);
    const warnings = prospectCopyWarnings(proposal.subject, proposal.body);
    if (warnings.length) throw Error(proposal.name + ': ' + warnings.join(', '));
    const product = products.get(proposal.productKey)!;
    const productQuote = proposal.productKey === 'lemonade' ? 'compare reports, and follow the sources back to the original.' : 'Plan scenes, generate clips, and export polished edits';
    if (!normalize(product.body).includes(normalize(productQuote))) throw Error('Product evidence not found');
    rows.push({ ...proposal, url: page.url, productUrl: product.url, productQuote, observedAt: Date.now(), bodyHash: createHash('sha256').update(proposal.body).digest('hex'), status: 'draft', sourceChecked: true, sendingApproved: false });
  }
  writeFileSync(folder + '/first-customer-pitches.json', JSON.stringify(rows, null, 2));
  const esc = (v: string) => v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  writeFileSync(folder + '/first-customer-pitches.html', `<!doctype html><meta charset="utf-8"><title>Signal: four proposed introductions</title><style>body{font:17px/1.6 system-ui;max-width:850px;margin:40px auto;padding:0 20px;color:#20212b;background:#fafafa}article{background:white;border:1px solid #ddd;border-radius:12px;padding:24px;margin:24px 0}pre{white-space:pre-wrap;font:inherit}small{color:#555}a{color:#4935a6}</style><h1>Four proposed introductions</h1><p>Prepared from the businesses' own public pages. These are possible workflow matches, not people who have requested a demo. No messages sent by this preparation.</p><p>Each email will include the configured business sender, company identification, mailing address and reply-to-stop footer. No automatic cold follow-ups.</p>${rows.map(r => `<article><small>${esc(r.productKey)}</small><h2>${esc(r.name)}</h2><p>To: ${esc(r.contact)}<br>Subject: ${esc(r.subject)}</p><pre>${esc(r.body)}</pre><p><a href="${esc(r.url)}">Business source</a> · <a href="${esc(r.productUrl)}">Product source</a></p><small>${esc(r.fit)}</small></article>`).join('')}`);
  console.log(JSON.stringify({ prepared: rows.map(r => ({ business: r.productKey, name: r.name, contact: r.contact })), emailSent: false }));
} finally { app.close(); }
