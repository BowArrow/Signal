import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import type { App } from '../src/core/app.js';
import { products, settings, studioCampaigns, studioAssets, studioLeads } from '../src/core/db/schema.js';
import { briefSchema, studioCopySchema, leadSchema } from '../src/shared/studio.js';
import { remember } from '../src/core/marketing/store.js';
import { copyWarnings } from '../src/core/studio/store.js';

const targets = [
  { key: 'kenmoo', name: 'KenMoo', url: 'https://kenmoo.me/', contact: 'https://kenmoo.me/contact/',
    angle: 'A source-backed answer from a folder of working documents, without another recurring software bill.',
    question: 'Which document do you keep reopening because the answer is buried inside it?',
    evidence: 'The official site presents an LTD community and launch partnerships. Private group rules and posting permission have not been checked.',
    route: 'Ask the community administrator about a founder demo and the current posting rules. Do not assume a Page connection permits posting in the group.' },
  { key: 'ltdhunt', name: 'LTDHunt', url: 'https://hub.ltdhunt.com/help/post/exclusive-launches-on-ltd-hunt-RXh4LSp5rnAhBbo', contact: 'https://ltdhunt.com/',
    angle: 'Try the actual document workflow before paying once for a personal desktop license.',
    question: 'Would you test a document assistant with a real work folder before buying an LTD?',
    evidence: 'The official exclusive-launch guide requires exclusivity, a discount and founder engagement. Lemonade already sells directly, so eligibility for that route is unconfirmed.',
    route: 'Ask about a nonexclusive founder demo or listing first. Do not offer exclusivity, change prices, promise a discount or accept a marketplace contract.' },
  { key: 'lifetimo', name: 'Lifetimo', url: 'https://lifetimo.com/', contact: 'https://www.facebook.com/groups/lifetimo',
    angle: 'A clear one-time offer for people who repeatedly search, summarize and draft from their own files.',
    question: 'What would you try first: finding a source-backed answer, comparing two files, or drafting an update?',
    evidence: 'The official Lifetimo site links its closed Facebook community for software deals. Membership, current promotion rules and administrator approval are unverified.',
    route: 'Check the group rules and request permission for a transparent founder demo before posting. No member scraping or unsolicited member messages.' },
] as const;

const objective = 'Prioritize a bounded Lemonade lifetime-deal (LTD) community test with KenMoo, LTDHunt and Lifetimo. Show a real document question, source reference and useful draft. Lead with less document busywork and one less subscription. Verify the current $49 one-time personal license (up to 3 computers) and 14-day trial before publication. Save tailored administrator requests and community posts as drafts; check each group\'s rules and permission before external contact. Connected Facebook Pages are not group destinations. No exclusivity, discounts or paid placement without a separate decision. Use one tracked link per community; measure qualified visits, trial interest, Stripe sales and refunds. Keep existing account limits and all other products separate.';

export async function prepareOwnerLtd(app: App) {
  const product = app.db.select().from(products).where(eq(products.key, 'lemonade')).get();
  if (!product || !app.operations) throw Error('Lemonade operations unavailable.');
  const folder = resolve('output/ltd-campaigns'); mkdirSync(folder, { recursive: true });
  const marker = 'owner.ltd-campaigns.v1.' + product.id;
  const ids = [...targets.map(t => `lemonade-ltd-${t.key}-20260921`), 'lemonade-ltd-video-20260921'];
  const existing = app.db.select().from(settings).where(eq(settings.key, marker)).get();
  const state = app.operations.state(product.id);
  if (!existing) {
    if (state.running) throw Error('Lemonade must be paused before changing campaign focus.');
    if (app.operations.deliveries().some(j => j.productId === product.id && ['queued', 'retry', 'dispatching', 'attention'].includes(j.status))) throw Error('Preserve pending deliveries; reconcile them before changing campaign focus.');
    const backupFolder = join(process.env['LOCALAPPDATA']!, 'Signal', 'backups'); mkdirSync(backupFolder, { recursive: true });
    await app.dbHandle.raw.backup(join(backupFolder, `before-ltd-${Date.now()}.db`));
    const prompt = readFileSync(join(folder, 'lemonade-openart-prompt.md'), 'utf8');
    const createdAt = app.clock.now();
    app.db.transaction(() => {
      // Recheck under the write transaction: never alter a newly started operation.
      const current = app.operations!.state(product.id);
      if (current.running || current.revision !== state.revision) throw Error('Operation changed during setup.');
      app.operations!.configure(product.id, { objective, accountIds: state.accountIds, dailyLimit: state.dailyLimit,
        intervalHours: state.intervalHours, ...(state.imageWorkflowId ? { imageWorkflowId: state.imageWorkflowId } : {}),
        ...(state.discovery ? { discovery: state.discovery } : {}) });
      remember(app, product.id, { title: 'Owner priority: Lemonade LTD communities', kind: 'preference', confidence: 1,
        source: 'Owner request, 2026-09-21', body: objective });
      remember(app, product.id, { title: 'LTD offer and first test', kind: 'hypothesis', confidence: 0.5,
        source: 'https://siplemona.de/; researched 2026-09-21',
        body: 'Hypothesis: LTD buyers with repeated document work will try Lemonade when shown a concrete workflow and clear one-time terms. Run a 14-day observation window beginning with the first approved placement, one tailored placement per consenting community, no paid placements. The live offer checked September 21 is $49 USD once for a personal license on up to 3 computers and a 14-day no-card trial on Windows 11/Linux x86. Setup, licensing, updates and optional online integrations still need internet. Record approvals, actual placement URLs and dates, UTM visits, trial interest, attributable purchases and refunds. Missing trial instrumentation means unknown, not zero. If no qualified visits arrive, review placement and message before spending. Compare net revenue and qualified interest; do not declare a winning channel from impressions or one sale.' });
      const add = (campaignId: string, kind: 'social' | 'sales-message' | 'video-script' | 'image-prompt', title: string, body: string, destination: string, evidence: string[]) => {
        const copy = studioCopySchema.parse({ title, body, rationale: 'Product-scoped LTD test: demonstrate a real buyer problem and a verifiable one-time offer.', evidence,
          reviewNotes: ['Draft only. Check destination rules, permission and current offer before publication.', 'No invented customer result, false scarcity or implied unlimited cloud credits.', 'Measure the tracked campaign after an actual placement; drafts are not delivered posts or sales.'] });
        app.db.insert(studioAssets).values({ id: `${campaignId}-${kind}`, productId: product.id, campaignId, kind, copy,
          status: 'draft', warnings: copyWarnings(body), destination, createdAt }).run();
      };
      for (const target of targets) {
        const campaignId = `lemonade-ltd-${target.key}-20260921`;
        const url = new URL(product.utmBase); url.searchParams.set('utm_source', target.key); url.searchParams.set('utm_medium', 'community'); url.searchParams.set('utm_campaign', campaignId);
        const trackedUrl = url.toString();
        const brief = briefSchema.parse({ title: `Lemonade LTD: ${target.name}`, channel: 'community',
          objective: 'Test qualified interest in a one-time desktop document assistant through one administrator-approved founder demo; track visits, trial interest, sales and refunds over 14 days after placement.',
          audience: 'LTD buyers, independent professionals and small-team members working repeatedly with documents.',
          offer: '$49 USD once, personal license for up to 3 computers; 14-day trial with no credit card. Verify current checkout terms.', formats: ['sales-message', 'social'] });
        app.db.insert(studioCampaigns).values({ id: campaignId, productId: product.id, brief, trackedUrl, createdAt }).run();
        const evidence = ['https://siplemona.de/ — offer and product features checked 2026-09-21.', `${target.url} — ${target.evidence}`];
        add(campaignId, 'sales-message', `${target.name}: administrator permission request`,
          `Hi ${target.name} team — I build Lemonade, a desktop app for asking questions about your own documents and turning the answers into drafts. It is $49 once for a personal license covering up to 3 computers, with a 14-day no-card trial.\n\n${target.angle}\n\nWould a short founder demo be useful for your community? I would show a real question over sample files, its source reference and the draft, clearly disclose that I build the app, and answer questions. Please point me to your current promotion rules and preferred submission process. This is a request about a nonexclusive demo, not a proposed exclusive launch.\n\nProduct details: ${trackedUrl}`, target.contact, evidence);
        add(campaignId, 'social', `${target.name}: founder demo draft`,
          `One less subscription. Less document busywork.\n\nDisclosure: I build Lemonade. ${target.question}\n\nLemonade helps you ask questions about your own files, inspect source references and turn what you find into a draft. The useful test is your own workflow: bring a small folder, ask a specific question and check the answer against the source.\n\nIt is a desktop app for Windows 11 and Linux x86. Local models run on your computer; setup, licensing, updates and optional online features still use the internet.\n\n$49 USD once for a personal license on up to 3 computers. Try it for 14 days with no credit card: ${trackedUrl}\n\n${target.angle}`, target.contact, evidence);
        const value = leadSchema.parse({ name: `${target.name} community administrator`, contact: target.contact, stage: 'discovered', permission: 'unknown',
          source: target.url, notes: `${target.evidence}\n${target.route}\nNo contact made. This is a community placement prospect, not an opted-in mailing-list subscriber.`, followUpAt: null, campaignId });
        app.db.insert(studioLeads).values({ id: `${campaignId}-admin`, productId: product.id, value, createdAt }).run();
        remember(app, product.id, { title: `Lemonade LTD target: ${target.name}`, body: `${target.evidence}\n${target.route}\nCampaign: ${campaignId}. ${target.angle}`, kind: 'source', source: target.url, confidence: 0.8 });
      }
      const campaignId = ids[3]!;
      const url = new URL(product.utmBase); url.searchParams.set('utm_source', 'signal'); url.searchParams.set('utm_medium', 'video'); url.searchParams.set('utm_campaign', campaignId);
      const brief = briefSchema.parse({ title: 'Lemonade LTD: One less subscription', channel: 'content', objective: 'Prepare one directed cloud-generated hook for an authentic document-workflow ad.',
        audience: 'Lifetime-deal buyers with repeated document work.', offer: '$49 once and a 14-day no-card trial; current terms must be checked before export.', formats: ['video-script', 'image-prompt'] });
      app.db.insert(studioCampaigns).values({ id: campaignId, productId: product.id, brief, trackedUrl: url.toString(), createdAt }).run();
      add(campaignId, 'video-script', 'OpenArt production brief and six-second hook', prompt, url.toString(), ['https://siplemona.de/', 'User-provided cinema-director-v3; existing fictional Maya reference.']);
      add(campaignId, 'image-prompt', 'Maya reference: reuse before generating more assets',
        'Use the existing fictional actor reference at output/ad-drafts/lemonade-maya-reference.png as the single identity input. Preserve medium-brown skin, dark brown eyes, oval face, thick eyebrows, shoulder-length dark curls and a forest-green crewneck knit top. Frame chest-up; lower wardrobe is not established. Do not generate additional reference variants before reviewing the first video. The image is a proposed fictional character, not a customer endorsement. Provider availability, reference input support and credit price are not yet verified. No generation has been submitted.', url.toString(), ['output/ad-drafts/manifest.json']);
      app.db.insert(settings).values({ key: marker, value: { campaignIds: ids, createdAt, source: 'owner-request-20260921' } }).run();
    });
  }
  const campaigns = app.db.select().from(studioCampaigns).where(and(eq(studioCampaigns.productId, product.id), inArray(studioCampaigns.id, ids))).all();
  const assets = app.db.select().from(studioAssets).where(and(eq(studioAssets.productId, product.id), inArray(studioAssets.campaignId, ids))).all();
  const leads = app.db.select().from(studioLeads).where(eq(studioLeads.productId, product.id)).all().filter(l => ids.includes(l.value.campaignId));
  if (campaigns.length !== 4 || assets.length !== 8 || leads.length !== 3) throw Error('LTD import readback incomplete.');
  const report = { checkedAt: new Date().toISOString(), business: product.name, campaigns: campaigns.map(c => ({ id: c.id, title: c.brief.title, trackedUrl: c.trackedUrl })),
    assetCount: assets.length, draftCount: assets.filter(a => a.status === 'draft').length, targets: leads.map(l => ({ name: l.value.name, permission: l.value.permission })),
    running: app.operations.state(product.id).running, objective: app.operations.state(product.id).objective, duplicateRun: Boolean(existing), generatedVideos: 0, creditsSpent: 0, published: false };
  writeFileSync(join(folder, 'import-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
