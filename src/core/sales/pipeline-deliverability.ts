import { resolveTxt } from 'node:dns/promises';
import { z } from 'zod/v4';
import type { App } from '../app.js';
import { requireProduct } from '../marketing/store.js';
import { boundedJson } from '../connections/network.js';
import { pipelineGet, pipelinePut, pipelineRows, contactId } from './pipeline-store.js';
import type { EmailVerification, PipelineInbox, PipelineLead } from '../../shared/sales-pipeline.js';
import type { OutreachJob } from '../../shared/outreach.js';
const DAY = 86400000;
const inboxId = (productId: string, accountId: string) => contactId(productId, accountId);
export function pipelineInbox(app: App, productId: string, accountId: string) { return pipelineGet<PipelineInbox>(app, 'inbox', inboxId(productId, accountId)); }
export function configurePipelineInbox(app: App, value: Pick<PipelineInbox, 'productId' | 'accountId' | 'sender' | 'dkimSelector' | 'warmupStartedAt'>) {
  requireProduct(app, value.productId);
  const source = app.sales?.sources().find(s => s.productId === value.productId && s.accountId === value.accountId);
  if (!source || (source.senderEmail ?? source.mailbox) !== value.sender.toLowerCase()) throw new Error('Select the exact monitored sender address from Sales setup.');
  if (value.warmupStartedAt > app.clock.now()) throw new Error('Warmup cannot start in the future.');
  assertIsolated(app, value.productId, value.sender);
  pipelinePut(app, 'inbox', inboxId(value.productId, value.accountId), { ...value, sender: value.sender.toLowerCase(), checkedAt: null, spf: false, dkim: false, dmarc: false, detail: 'Warmup start recorded by the owner. Check DNS before approving outreach.' } satisfies PipelineInbox);
}
function assertIsolated(app: App, productId: string, sender: string) {
  const primary = new URL(requireProduct(app, productId).utmBase).hostname.replace(/^www\./, '').toLowerCase();
  const domain = sender.split('@')[1]?.toLowerCase();
  if (!domain || domain === primary || domain.endsWith('.' + primary) || ['gmail.com', 'outlook.com', 'hotmail.com', 'live.com'].includes(domain)) throw new Error('Cold outreach requires a dedicated sending domain separate from the product domain.');
}
export async function checkPipelineDns(app: App, productId: string, accountId: string, resolve = resolveTxt) {
  const inbox = pipelineInbox(app, productId, accountId); if (!inbox) throw new Error('Configure the sending inbox first.');
  if (app.env.SIGNAL_OFFLINE === '1') throw new Error('DNS checks are unavailable offline.');
  const domain = inbox.sender.split('@')[1]!;
  const results = await Promise.allSettled([resolve(domain), resolve(`${inbox.dkimSelector}._domainkey.${domain}`), resolve(`_dmarc.${domain}`)]);
  const records = results.map(r => r.status === 'fulfilled' ? r.value.map(parts => parts.join('')) : []);
  const spf = records[0]!.filter(r => /^v=spf1\s/i.test(r));
  const dkim = records[1]!.filter(r => /(?:^|;)\s*p=[A-Za-z0-9+/=]{20,}/i.test(r));
  const dmarc = records[2]!.filter(r => /^v=DMARC1;/i.test(r) && /;\s*p=(?:none|quarantine|reject)(?:;|$)/i.test(r));
  const result = { ...inbox, spf: spf.length === 1 && /(?:~|-|\?)all\s*$/i.test(spf[0]!), dkim: dkim.length === 1, dmarc: dmarc.length === 1, checkedAt: app.clock.now(), detail: 'DNS records checked. Confirm SPF/DKIM alignment in a real mailbox test before using this inbox.' };
  // A settings edit while DNS was in flight must not be overwritten.
  if (JSON.stringify(pipelineInbox(app, productId, accountId)) !== JSON.stringify(inbox)) throw new Error('Inbox configuration changed during DNS verification.');
  pipelinePut(app, 'inbox', inboxId(productId, accountId), result); return result;
}
export function verifierKey(app: App) { return app.getSecret?.('ZEROBOUNCE_API_KEY') ?? process.env.ZEROBOUNCE_API_KEY; }
export async function verifyPipelineEmail(app: App, productId: string, email: string, transport: typeof fetch = fetch) {
  if (app.env.SIGNAL_OFFLINE === '1') throw new Error('Email verification is unavailable offline.');
  const key = verifierKey(app); if (!key) throw new Error('Configure ZEROBOUNCE_API_KEY before verifying a recipient. Verification uses your provider allowance.');
  const normalized = z.email().parse(email.trim().toLowerCase());
  pipelinePut(app, 'verification', contactId(productId, normalized), { email: normalized, checkedAt: app.clock.now(), valid: false, status: 'pending', subStatus: '' });
  const url = new URL('https://api.zerobounce.net/v2/validate'); url.searchParams.set('api_key', key); url.searchParams.set('email', normalized); url.searchParams.set('ip_address', '');
  try {
    const response = await transport(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    const result = z.object({ address: z.string(), status: z.string(), sub_status: z.string().default('') }).parse(await boundedJson(response));
    if (result.address.toLowerCase() !== normalized) throw new Error('Recipient mismatch');
    const value: EmailVerification = { email: normalized, checkedAt: app.clock.now(), status: result.status, subStatus: result.sub_status, valid: result.status === 'valid' && !/catch|accept_all|disposable|role_based_accept_all/i.test(result.sub_status) };
    pipelinePut(app, 'verification', contactId(productId, normalized), value); return value;
  } catch { throw new Error('Email verification could not be confirmed. Check the provider key, allowance and service. No recipient was marked valid.'); }
}
export function assertPipelineSend(app: App, job: OutreachJob) {
  if (!job.coldApproval) return;
  const lead = pipelineGet<PipelineLead>(app, 'lead', contactId(job.productId, job.to));
  if (!lead || !lead.draft || lead.stage !== 'DRAFT_READY' || !lead.qualification?.qualified || lead.qualification.icp_score < 70 || lead.qualification.angle_tag === 'none' || !lead.draft.criticPassed || lead.id !== job.leadId || job.subject !== lead.draft.subject || !job.body.startsWith(lead.draft.body + '\n\n')) throw new Error('Cold outreach needs a current, qualified intent-pipeline draft and human approval.');
  assertIsolated(app, job.productId, job.from);
  const inbox = pipelineInbox(app, job.productId, job.accountId), now = app.clock.now();
  if ((lead.sourceObservedAt ?? lead.createdAt) < now - 14 * DAY) throw new Error('Reverify the intent source; its evidence is older than 14 days.');
  if (!inbox || inbox.sender !== job.from || !inbox.spf || !inbox.dkim || !inbox.dmarc || inbox.checkedAt === null || inbox.checkedAt > now || inbox.checkedAt < now - DAY) throw new Error('Verify current SPF, DKIM and DMARC records for this exact sending address.');
  if (inbox.warmupStartedAt > now - 14 * DAY) throw new Error('This sending inbox must complete at least 14 days of warmup.');
  const verification = pipelineGet<EmailVerification>(app, 'verification', contactId(job.productId, job.to));
  if (!verification?.valid || verification.checkedAt > now || verification.checkedAt < now - DAY) throw new Error('Verify this recipient with the bounce-verification provider within 24 hours of sending.');
}
export function mailboxPacing(app: App, job: OutreachJob, all: OutreachJob[]) {
  const attempts = all.filter(j => j.id !== job.id && (j.mailbox ?? j.from) === (job.mailbox ?? job.from) && j.attemptedAt !== null && j.attemptedAt > app.clock.now() - DAY);
  if (attempts.length >= 25) throw new MailboxPacingWait('This inbox has used its rolling daily limit of 25 messages.', Math.min(...attempts.map(j => j.attemptedAt!)) + DAY + 1);
  const reservation = pipelineGet<{ nextAt: number; jobId: string }>(app, 'pacing', job.mailbox ?? job.from);
  if (reservation && reservation.jobId !== job.id && reservation.nextAt > app.clock.now()) throw new MailboxPacingWait('This inbox is waiting for its randomized sending interval.', reservation.nextAt);
}
export class MailboxPacingWait extends Error { constructor(message: string, readonly nextAt: number) { super(message); this.name = 'MailboxPacingWait'; } }
export function reserveMailboxPacing(app: App, job: OutreachJob, random = Math.random) {
  pipelinePut(app, 'pacing', job.mailbox ?? job.from, { jobId: job.id, nextAt: app.clock.now() + (4 + Math.floor(random() * 6)) * 60000 });
}
export function suppressPipelineDomain(app: App, domain: string, reason: string) { pipelinePut(app, 'suppression-domain', domain.toLowerCase(), { domain: domain.toLowerCase(), reason, at: app.clock.now() }); }
export function pipelineSuppressed(app: App, email: string) {
  const domain = email.toLowerCase().split('@')[1] ?? '';
  return Boolean(pipelineGet(app, 'suppression-email', email.toLowerCase())) || pipelineRows<{ domain: string }>(app, 'suppression-domain').some(r => domain === r.domain || domain.endsWith('.' + r.domain));
}
