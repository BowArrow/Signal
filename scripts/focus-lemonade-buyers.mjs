// Update saved owner guidance; does not start agents, publish, or contact prospects.
// Run: node --import tsx scripts/focus-lemonade-buyers.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { brandSchema, briefSchema } from '../src/shared/studio.ts';
import { operationPolicySchema } from '../src/shared/operations.ts';
import { memoryInputSchema } from '../src/shared/marketing.ts';

const audience = 'Small-business owners, solo professionals and individual customers using Windows 11 or Linux who repeatedly read, compare or draft documents. Initial hypotheses: solo consultants and freelancers preparing client updates; owner-operated service businesses working with reports, supplier information or internal instructions; individuals researching a folder of their own documents. Qualify the actual task, hardware fit, decision-maker and permission to use the files. A demographic or public post alone is not a qualified buyer.';
const objective = 'Acquire Lemonade customers among small-business owners, solo professionals and individual document users. Start with one person and one recurring task: summarizing reports, comparing source documents, or preparing an editable draft. Treat the audience segments as hypotheses until qualified conversations and trials support them. The owner has no social following: prioritize relevant existing buyer requests, permitted community demonstrations and partners with an audience; owned-feed posts support these efforts but do not establish reach. LTD groups are an optional distribution route, not the buyer definition. Reuse the completed product ad. Show an actual task and source check, invite a 14-day no-card trial, and help interested users reach a useful result. Verify the $49 personal perpetual license and current requirements before quoting. Do not promise team sharing, enterprise controls, accounting accuracy or autonomous business decisions. Track source, permission, useful trial result, objections and Stripe purchase evidence; no invented customers or success rates. Public authors are not opted-in email leads. Prepare contact suggestions for review; this guidance does not authorize sending, paid placements or changing the posting policy.';
const brand = brandSchema.parse({
  audience,
  problem: 'Repeated document work: finding a specific answer, comparing information across files and turning source material into an editable first draft. Determine which task the buyer actually repeats, what they do today and why changing would be worthwhile.',
  offer: 'Try one useful task with your own files for 14 days without a credit card. $49 USD once for a personal perpetual license on up to 3 computers. Windows 11 and Linux; verify current checkout terms and hardware fit. This is not a shared license for three people.',
  proof: 'https://siplemona.de/ describes local document questions, source references and editable Word, Excel, PowerPoint and PDF outputs. The completed narrated demo is at https://siplemona.de/ads/lemonade-ltd/. These establish product demonstrations, not customer demand, measured time savings or guaranteed accuracy. Validate a representative task before using it as a buyer-specific claim.',
  voice: 'Practical, specific and understandable to a nontechnical buyer. Lead with their document task and a useful result. Disclose our affiliation. Ask about their current workflow before pitching. Avoid AI jargon, generic hype, invented urgency and unsupported productivity numbers.',
  constraints: 'No existing social following; qualify access to a relevant audience. Do not treat LTD membership as buying intent or partner inquiries as opted-in prospects. Keep local processing distinct from setup, licensing, updates and optional network tools. Confirm permission for business files. No claims of team collaboration, regulatory certification, professional advice or unattended accuracy. Human review of the output remains necessary. No new spending or outreach authorization is created by this profile.',
  visualStyle: 'Actual product footage and readable sample documents showing one question, its source reference and the editable result. The completed fictional-character ad can introduce the problem; do not depict the actor as a real customer or regenerate footage just to change the audience.',
});
const preference = memoryInputSchema.parse({ title: 'Owner priority: small businesses and solo customers', kind: 'preference', body: objective, source: 'Owner direction: target small businesses and solo customers; no existing social following. September 25, 2026.', confidence: 1 });
const db = new DatabaseSync(join(process.env.APPDATA, 'signal', 'signal.db'));
db.exec('PRAGMA busy_timeout=5000');
try {
  db.exec('BEGIN IMMEDIATE');
  const product = db.prepare("SELECT id FROM products WHERE key='lemonade'").get(); assert(product);
  const marker = 'owner.buyer-focus.20260925.' + product.id;
  assert(!db.prepare('SELECT key FROM settings WHERE key=?').get(marker), 'Already applied; preserve subsequent owner changes');
  const policyKey = 'operations.policy.' + product.id, brandKey = 'studio.brand.' + product.id;
  const policyRow = db.prepare('SELECT * FROM settings WHERE key=?').get(policyKey); assert(policyRow);
  const state = JSON.parse(policyRow.value); assert(!state.running && !state.taskId, 'Do not change active work');
  const pending = db.prepare("SELECT value FROM settings WHERE key LIKE 'operations.delivery.%'").all().map(row => JSON.parse(row.value)).filter(row => row.productId === product.id && ['queued', 'dispatching', 'retry', 'attention'].includes(row.status));
  assert.equal(pending.length, 0, 'Preserve pending deliveries');
  const oldPreference = db.prepare("SELECT * FROM marketing_memory WHERE product_id=? AND title='Owner priority: Lemonade LTD communities' AND status='active'").all(product.id);
  assert(oldPreference.length <= 1);
  const campaign = db.prepare('SELECT * FROM studio_campaigns WHERE id=? AND product_id=?').get('lemonade-ltd-video-20260921', product.id); assert(campaign);
  const before = { policy: policyRow, brand: db.prepare('SELECT * FROM settings WHERE key=?').get(brandKey) ?? null, campaign, preferences: oldPreference };
  const folder = resolve('output/campaign-reconciliation'); mkdirSync(folder, { recursive: true });
  const backup = join(folder, `before-buyer-focus-${Date.now()}.json`);
  writeFileSync(backup, JSON.stringify(before, null, 2), { flag: 'wx' });
  const policy = operationPolicySchema.parse({ objective, accountIds: state.accountIds, intervalHours: state.intervalHours, dailyLimit: state.dailyLimit, ...(state.imageWorkflowId ? { imageWorkflowId: state.imageWorkflowId } : {}), ...(state.discovery ? { discovery: state.discovery } : {}) });
  const next = { ...state, ...policy, revision: state.revision + 1, authorizedAt: null, lastCycleAt: null, taskId: null, targetAccountId: null };
  delete next.learning; delete next.demandEvidence;
  const put = db.prepare('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at');
  put.run(brandKey, JSON.stringify(brand), Date.now()); put.run(policyKey, JSON.stringify(next), Date.now());
  const brief = briefSchema.parse({ ...JSON.parse(campaign.brief), audience, objective: 'Use the finished demonstration to support qualified small-business and individual buyer conversations. Test one recurring document task, assist interested trial users, and record objections and actual Stripe purchases. Distribution requires a relevant reachable audience; publishing to an empty feed is not an acquisition result.' });
  db.prepare('UPDATE studio_campaigns SET brief=? WHERE id=?').run(JSON.stringify(brief), campaign.id);
  const old = oldPreference[0];
  if (old) db.prepare("UPDATE marketing_memory SET status='superseded' WHERE id=?").run(old.id);
  db.prepare('INSERT INTO marketing_memory (id,product_id,title,body,kind,source,confidence,status,supersedes_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run('lemonade-buyer-focus-20260925', product.id, preference.title, preference.body, preference.kind, preference.source, preference.confidence, 'active', old?.id ?? null, Date.now());
  const result = { checkedAt: new Date().toISOString(), productId: product.id, brandUpdated: true, objectiveUpdated: true, campaignId: campaign.id, priorLtdPreferenceSuperseded: Boolean(old), operationStarted: false, contactsAdded: 0, published: false, backup };
  put.run(marker, JSON.stringify(result), Date.now());
  assert.deepEqual(JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get(brandKey).value), brand);
  assert.deepEqual(next.accountIds, state.accountIds); assert.equal(next.running, false);
  db.exec('COMMIT');
  writeFileSync(join(folder, 'lemonade-buyer-focus.json'), JSON.stringify({ ...result, brand, objective }, null, 2));
  console.log(JSON.stringify(result));
} catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
finally { db.close(); }
