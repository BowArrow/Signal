import { eq } from 'drizzle-orm';
import type { App } from '../app.js';
import { studioLeads, growthTasks } from '../db/schema.js';
import { requireProduct, marketingSettings, hasPendingMedia } from '../marketing/store.js';
import { growthSettings } from '../growth/store.js';
import { runtimeSettings } from '../runtime/settings.js';
import { OpenAiCompatibleClient } from '../llm/openai-compatible.js';
import type { LlmClient } from '../llm/client.js';
import { publicPage } from '../marketing/web.js';
import { isSalesSuppressed } from './suppression.js';
import { pipelineCall, firstEmailViolations } from './pipeline-agents.js';
import { pipelineGet, pipelinePut, pipelineRows, contactId, savePipelineLead, claimPipelineLead } from './pipeline-store.js';
import { configurePipelineInbox, checkPipelineDns, verifyPipelineEmail, verifierKey, suppressPipelineDomain } from './pipeline-deliverability.js';
import { intentLeadSchema, qualificationSchema, pipelineDraftSchema, criticSchema, replyTriageSchema, feedbackRulesSchema, pipelineActionSchema,
  type IntentLead, type PipelineLead, type PipelineRun, type PipelineFeedback, type PipelineView, type PipelineAction } from '../../shared/sales-pipeline.js';
import type { SalesMessage } from '../../shared/sales.js';
import type { OutreachJob } from '../../shared/outreach.js';
import type { SalesReply } from '../../shared/sales-replies.js';
import type { ProspectDraft } from '../../shared/prospect-research.js';
const DAY = 86400000;
const normalized = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
/** A deterministic minimum signal, followed by source verification and model qualification. */
export function hasIntentSignal(value: string) {
  return /\b(?:looking for|recommend|alternative|need|want|struggling|frustrated|too expensive|subscription fatigue|privacy concern|how (?:can|do)|self.host|local (?:AI|LLM)|private (?:AI|data)|cloud AI privacy)\b/i.test(value);
}
export class SalesPipeline {
  private active: { productId: string; controller: AbortController; promise: Promise<void> } | null = null;
  constructor(private readonly app: App, private readonly client?: LlmClient, private readonly read = publicPage) {}
  busy() { return Boolean(this.active); }
  leads(productId: string) { requireProduct(this.app, productId); return pipelineRows<PipelineLead>(this.app, 'lead').filter(l => l.productId === productId); }
  lead(productId: string, id: string, revision?: number) {
    requireProduct(this.app, productId); const lead = pipelineGet<PipelineLead>(this.app, 'lead', id);
    if (!lead || lead.productId !== productId) throw new Error('Pipeline lead not found for this business.');
    if (revision !== undefined && lead.revision !== revision) throw new Error('This lead changed. Reload before continuing.');
    return lead;
  }
  ingest(productId: string, input: IntentLead) {
    requireProduct(this.app, productId); const value = intentLeadSchema.parse(input); value.email = value.email.toLowerCase();
    const url = new URL(value.sourceUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Provide a public HTTPS source for the intent signal.');
    if (!hasIntentSignal(value.sourceSignal)) throw new Error('Provide a concrete request, pain point or intent event, not a generic company description.');
    if (isSalesSuppressed(this.app, productId, value.email) || this.app.revenue?.purchaseForContact(productId, value.email)) throw new Error('This contact is suppressed or already a customer.');
    return this.app.db.transaction(() => {
      const id = contactId(productId, value.email), existing = pipelineGet<PipelineLead>(this.app, 'lead', id);
      if (existing) return existing;
      if (this.app.db.select().from(studioLeads).where(eq(studioLeads.productId, productId)).all().some(l => l.value.contact.toLowerCase() === value.email)) throw new Error('This contact already exists in Sales. Preserve its existing conversation; do not create another first introduction.');
      const now = this.app.clock.now();
      const lead: PipelineLead = { ...value, id, productId, stage: 'DISCOVERED', revision: 1, createdAt: now, updatedAt: now, detail: 'Intent recorded. Waiting to verify the source and public contact.', requested: true, attempts: 0, nextAt: now, lease: null, history: [{ stage: 'DISCOVERED', at: now, reason: 'Intent signal submitted for source verification.' }] };
      pipelinePut(this.app, 'lead', id, lead);
      this.app.db.insert(studioLeads).values({ id, productId, createdAt: now, value: { name: value.name, contact: value.email, permission: 'unknown', stage: 'discovered', source: value.sourceUrl, notes: value.sourceSignal, followUpAt: null, campaignId: '' } }).run();
      return lead;
    });
  }
  private localClient(signal: AbortSignal) {
    return this.client ?? new OpenAiCompatibleClient(growthSettings(this.app).baseUrl, this.app.logger, { signal, timeoutMs: 240000, offline: this.app.env.SIGNAL_OFFLINE === '1', localDevice: () => runtimeSettings(this.app).localDevice });
  }
  private rules(productId: string) { return pipelineGet<{ rules: string[] }>(this.app, 'rules', productId)?.rules ?? []; }
  private assertCurrent(lead: PipelineLead, signal: AbortSignal) {
    signal.throwIfAborted(); const current = this.lead(lead.productId, lead.id, lead.revision);
    if (!current.requested || current.lease?.token !== lead.lease?.token || !current.lease || current.lease.until <= this.app.clock.now()) throw new Error('Pipeline work was paused or superseded.');
    if (isSalesSuppressed(this.app, lead.productId, lead.email)) throw new Error('This contact is now suppressed.');
  }
  private async process(original: PipelineLead, signal: AbortSignal) {
    let lead = claimPipelineLead(this.app, original);
    const model = marketingSettings(this.app).model, client = this.localClient(signal);
    const call = <T extends Parameters<typeof pipelineCall>[6]>(stage: string, schema: T, prompt: string, temperature = 0.15) => pipelineCall(this.app, client, model, lead.productId, lead.id, stage, schema, prompt, signal, temperature);
    const save = (patch: Partial<PipelineLead>, detail: string) => { this.assertCurrent(lead, signal); lead = savePipelineLead(this.app, lead, { ...patch, lease: null, attempts: 0 }, detail); };
    try {
      this.assertCurrent(lead, signal);
      if (lead.stage === 'DISCOVERED' || (['ENRICHED', 'QUALIFIED', 'DRAFT_READY'].includes(lead.stage) && (lead.sourceObservedAt ?? lead.createdAt) < this.app.clock.now() - 14 * DAY)) {
        const source = await this.read(this.app, lead.sourceUrl, signal); this.assertCurrent(lead, signal);
        const emails = source.body.toLowerCase() + '\n' + (source.links ?? []).filter(l => l.url.startsWith('mailto:')).map(l => { try { return decodeURIComponent(l.url).toLowerCase(); } catch { return ''; } }).join('\n');
        const addresses: string[] = emails.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
        if (!normalized(source.body).includes(normalized(lead.sourceSignal)) || !addresses.includes(lead.email)) throw new Error('The source must contain the exact intent quote and the supplied public email. No email addresses are inferred.');
        save({ stage: lead.stage === 'DISCOVERED' ? 'ENRICHED' : lead.stage, sourceObservedAt: this.app.clock.now() }, 'Source quote and public contact verified. Continuing from the saved preparation stage.'); return;
      }
      const product = requireProduct(this.app, lead.productId);
      const source = await this.read(this.app, product.utmBase, signal); this.assertCurrent(lead, signal);
      const context = JSON.stringify({ lead: { name: lead.name, sourceSignal: lead.sourceSignal, sourceUrl: lead.sourceUrl }, qualification: lead.qualification, product: { name: product.name, url: source.url, text: source.body.slice(0, 10000) }, styleRules: this.rules(lead.productId) });
      if (lead.stage === 'ENRICHED') {
        const result = await call('qualify', qualificationSchema, 'Evaluate ICP fit for this product. Require an explicit, relevant intent trigger. A generic business workflow or keyword alone does not establish a need. Score 0–100. Select one supported angle; use none and qualified=false if no supported angle. Never assert absolute privacy or invent pains.\n' + context);
        const qualified = result.qualified && result.icp_score >= 70 && result.angle_tag !== 'none';
        save({ stage: qualified ? 'QUALIFIED' : 'DISQUALIFIED', qualification: result, requested: qualified }, qualified ? 'Qualified from the verified intent signal. Drafting is next.' : 'Disqualified: ' + result.reasoning); return;
      }
      if (lead.stage === 'QUALIFIED' || lead.stage === 'DRAFT_READY') {
        let feedback = '', draft = lead.draft;
        for (let attempt = 0; attempt < (lead.stage === 'DRAFT_READY' ? 1 : 3); attempt++) {
          const generated = lead.stage === 'DRAFT_READY' && draft ? draft : await call('draft', pipelineDraftSchema,
            'Draft a first email strictly under 75 words, plain text, no links (spell the product name without a domain), attachments, HTML, bullets, emoji, cliches or signature. Reference exactly one concrete observation from sourceSignal. State one supported product outcome tied to the angle. Use this exact affiliation sentence fragment: ' + JSON.stringify('We build ' + product.name) + '. Do not invent an affiliate, partner, personal identity or credential. End with one low-friction question, never a 30-minute meeting ask. product_quote must be an exact 20–400 character excerpt supporting the claim; keep that quote in the evidence field, not in the email. Do not imply prior use or guarantee privacy, cost savings or results.\n' + context + '\nRevision feedback: ' + JSON.stringify(feedback), 0.5);
          this.assertCurrent(lead, signal);
          const violations = firstEmailViolations(generated.subject, generated.body);
          if (!generated.body.toLowerCase().includes(('We build ' + product.name).toLowerCase())) violations.push('Identify the actual product team with the supplied We build sentence fragment.');
          if (!source.body.includes(generated.product_quote)) violations.push('Product evidence must be an exact excerpt of the current product source.');
          const critic = await call('critic', criticSchema, 'Independently review the proposed first email against all constraints: strictly under 75 body words; exactly one true observation from sourceSignal; one source-supported outcome; one low-friction closing question; plain text; no links or attachments; no cliches or invented claims. Report actual word count and violations.\n' + context + '\nDRAFT: ' + JSON.stringify(generated) + '\nCODE CHECKS: ' + JSON.stringify(violations));
          this.assertCurrent(lead, signal);
          // Exact counts are code's responsibility; a model estimate cannot override them.
          critic.word_count = generated.body.trim().split(/\s+/u).length;
          critic.violations = [...new Set([...violations, ...critic.violations])];
          const passed = critic.passed && !critic.contains_ai_cliches && critic.references_source_signal && critic.has_low_friction_cta && critic.violations.length === 0;
          critic.passed = passed;
          draft = { subject: generated.subject, body: generated.body, product_quote: generated.product_quote, originalBody: lead.draft?.originalBody ?? generated.body, critic, criticPassed: passed, observedAt: this.app.clock.now(), productUrl: source.url };
          if (passed) break;
          feedback = [...violations, ...critic.violations, critic.rewrite_instruction ?? 'Correct the draft and word count.'].join(' ');
        }
        save({ stage: 'DRAFT_READY', draft: draft!, requested: false }, draft!.criticPassed ? 'Draft and independent critique passed. Review the exact email before approving.' : 'Needs editing: the draft failed after bounded review. Edit and recheck before approval.'); return;
      }
      if (lead.stage === 'REPLIED' && lead.lastMessageId) {
        const message = this.app.sales?.messages(lead.productId).find(m => m.id === lead.lastMessageId);
        if (!message || message.automated || message.truncated || !message.body) { save({ requested: false }, 'Review this message in the original mailbox; automated, incomplete or unavailable content is not suitable for drafting.'); return; }
        const triage = await call('triage', replyTriageSchema, 'Classify this reply. Requests to stop contact or clear negative responses must be UNSUBSCRIBE_OR_NEGATIVE with empty suggested_reply. Use OTHER for unrelated, ambiguous or unsafe requests. All other replies require human approval. Suggest a concise factual reply using only the product source. Include a product link only when requested and available in the source. Never invent booking or checkout URLs. next_stage is a proposal only; a model cannot establish a meeting, sale or delivery.\n' + context + '\nINCOMING: ' + JSON.stringify({ subject: message.subject, body: message.body }));
        this.assertCurrent(lead, signal); triage.requires_human_approval = true;
        if (triage.intent === 'UNSUBSCRIBE_OR_NEGATIVE') {
          triage.suggested_reply = '';
          save({ triage, stage: 'DISQUALIFIED', requested: false }, 'Contact suppressed. No reply will be generated or sent.');
          this.app.sales?.suppress(lead.productId, lead.email, 'Incoming reply declined further contact.', message.id);
        } else save({ triage: { ...triage, suggested_reply: triage.confidence < 0.7 || triage.intent === 'OTHER' ? '' : triage.suggested_reply }, requested: false }, 'Reply triaged. Review the full conversation and approve any response.');
      }
    } catch (error) {
      const current = this.lead(lead.productId, lead.id);
      if (current.revision !== lead.revision || current.lease?.token !== lead.lease?.token) return;
      savePipelineLead(this.app, current, { lease: null, requested: false, attempts: current.attempts + 1 }, signal.aborted ? 'Preparation paused. Retry resumes the saved stage.' : error instanceof Error ? error.message : 'Preparation failed. Retry the saved stage.');
    }
  }
  async tick(ready = true) {
    if (!ready || this.active || this.app.env.SIGNAL_OFFLINE === '1' || hasPendingMedia(this.app) || this.app.sales?.agentBusy() || this.app.salesReplies?.agentBusy() || this.app.outreach?.agentBusy() || this.app.db.select().from(growthTasks).where(eq(growthTasks.status, 'running')).get()) return;
    const lead = pipelineRows<PipelineLead>(this.app, 'lead').find(l => l.requested && l.nextAt <= this.app.clock.now() && (!l.lease || l.lease.until <= this.app.clock.now()));
    if (lead) {
      const controller = new AbortController(); const promise = this.process(lead, AbortSignal.any([controller.signal, AbortSignal.timeout(14 * 60000)])).finally(() => { this.active = null; });
      this.active = { productId: lead.productId, controller, promise }; await promise;
    } else {
      for (const product of this.app.connections?.view().products ?? []) {
        const state = pipelineGet<{ at: number }>(this.app, 'rules', product.id);
        const failure = pipelineGet<{ at: number }>(this.app, 'distill-error', product.id);
        if (this.feedback(product.id).length >= 20 && (!state || state.at < this.app.clock.now() - 7 * DAY) && (!failure || failure.at < this.app.clock.now() - DAY)) { await this.distill(product.id); break; }
      }
    }
  }
  pause(productId: string) { if (this.active?.productId === productId) this.active.controller.abort(); }
  async stop() { this.active?.controller.abort(); await this.active?.promise; }
  inbound(message: SalesMessage) {
    const threadJob = this.app.outreach?.jobs(message.productId).find(j => j.accountId === message.accountId && j.threadId === message.threadId);
    const lead = pipelineGet<PipelineLead>(this.app, 'lead', contactId(message.productId, threadJob?.to ?? message.from));
    if (!lead || message.receivedAt < lead.createdAt || lead.lastMessageId === message.id || ['CLOSED_WON', 'DISQUALIFIED'].includes(lead.stage)) return;
    const previous = lead.lastMessageId && this.app.sales?.messages(message.productId).find(m => m.id === lead.lastMessageId);
    if (previous && previous.receivedAt > message.receivedAt) return;
    this.pause(message.productId);
    const stop = message.category === 'unsubscribe';
    savePipelineLead(this.app, lead, { stage: stop ? 'DISQUALIFIED' : 'REPLIED', lastMessageId: message.id, requested: !stop, lease: null }, stop ? 'Unsubscribe received. Contact suppressed.' : 'Inbound received. Queued outreach stopped before triage.');
  }
  purchaseConfirmed(productId: string, email: string) {
    const lead = pipelineGet<PipelineLead>(this.app, 'lead', contactId(productId, email));
    const payment = this.app.revenue?.purchaseForContact(productId, email);
    if (!lead || !payment || payment.disputed || payment.captured <= payment.refunded || payment.createdAt < lead.createdAt || !['OUTREACH_ACTIVE', 'REPLIED', 'MEETING_BOOKED', 'CHECKOUT_SENT', 'NURTURE_LATER'].includes(lead.stage)) return;
    savePipelineLead(this.app, lead, { stage: 'CLOSED_WON', requested: false, lease: null }, 'A matching live captured payment was imported. Campaign attribution is measured separately.');
  }
  queuedFeedback(productId: string, id: string, original: string, final: string) {
    if (original && original !== final) pipelinePut(this.app, 'pending-feedback', id, { productId, original, final });
  }
  confirmed(job: OutreachJob) {
    const lead = pipelineGet<PipelineLead>(this.app, 'lead', contactId(job.productId, job.to)); if (!lead || !job.coldApproval) return;
    if (lead.stage === 'DRAFT_READY') savePipelineLead(this.app, lead, { stage: 'OUTREACH_ACTIVE', requested: false, deliveryId: job.id }, 'Matching sent copy confirmed. Delivery and conversion remain unverified.');
    if (lead.draft) this.recordFeedback(lead.productId, job.id, lead.draft.originalBody, lead.draft.body);
  }
  replyConfirmed(job: SalesReply) {
    const pending = pipelineGet<{ original: string; final: string }>(this.app, 'pending-feedback', job.id);
    if (pending) this.recordFeedback(job.productId, job.id, pending.original, pending.final);
  }
  private recordFeedback(productId: string, messageId: string, originalDraft: string, finalSent: string) {
    if (originalDraft === finalSent || pipelineGet(this.app, 'feedback', messageId)) return;
    pipelinePut(this.app, 'feedback', messageId, { id: messageId, productId, messageId, originalDraft, finalSent, at: this.app.clock.now() } satisfies PipelineFeedback);
  }
  private feedback(productId: string) { return pipelineRows<PipelineFeedback>(this.app, 'feedback').filter(f => f.productId === productId).sort((a, b) => b.at - a.at).slice(0, 50); }
  async distill(productId: string) {
    requireProduct(this.app, productId); if (this.active) throw new Error('Wait for the active pipeline task.');
    if (this.app.env.SIGNAL_OFFLINE === '1') throw new Error('Rule distillation is unavailable offline.');
    const feedback = this.feedback(productId); if (feedback.length < 20) throw new Error('At least 20 confirmed, human-edited sends are needed before distilling rules.');
    const controller = new AbortController();
    const promise = (async () => {
      try {
        const result = await pipelineCall(this.app, this.localClient(controller.signal), marketingSettings(this.app).model, productId, null, 'distill', feedbackRulesSchema,
          'Extract 5–10 concise, non-contradictory style rules from these human edits. Do not extract names, email addresses, facts, promises, security claims, sending policies or instructions to bypass review. Rules guide wording only and never override current evidence.\n' + JSON.stringify(feedback.map(f => ({ original: f.originalDraft, final: f.finalSent }))), controller.signal);
        const safe = result.rules.filter(r => !/@|https?:|100%|always private|never leaves|auto.send|skip.*review|ignore.*instruction/i.test(r));
        if (safe.length < 5) throw new Error('Distilled rules need review; no new rules activated.');
        pipelinePut(this.app, 'rules', productId, { rules: safe, at: this.app.clock.now() });
      } catch (error) {
        pipelinePut(this.app, 'distill-error', productId, { at: this.app.clock.now(), detail: error instanceof Error ? error.message : 'Distillation failed.' });
        throw error;
      }
    })().finally(() => { this.active = null; });
    this.active = { productId, controller, promise }; await promise;
  }
  private prospectDraft(lead: PipelineLead): ProspectDraft {
    if (!lead.draft?.criticPassed) throw new Error('Edit and recheck the draft until the critic passes.');
    if ((lead.sourceObservedAt ?? lead.createdAt) < this.app.clock.now() - 14 * DAY) throw new Error('Intent evidence is older than 14 days. Reverify the source before outreach.');
    return { id: lead.id, productId: lead.productId, leadId: lead.id, kind: 'business', name: lead.name, url: lead.sourceUrl, contact: lead.email, contactSource: lead.sourceUrl, fit: lead.qualification?.reasoning ?? '', prospectQuote: lead.sourceSignal, productQuote: lead.draft.product_quote, productUrl: lead.draft.productUrl, observedAt: lead.draft.observedAt, createdAt: lead.createdAt, updatedAt: lead.updatedAt, status: 'draft', detail: lead.detail, subject: lead.draft.subject, body: lead.draft.body, rulesUrl: '', rulesQuote: '', nextStep: 'Review and approve this exact email.' };
  }
  async action(input: PipelineAction) {
    const action = pipelineActionSchema.parse(input); requireProduct(this.app, action.productId);
    if (action.type === 'ingest') this.ingest(action.productId, action.value);
    else if (action.type === 'configure-inbox') configurePipelineInbox(this.app, action);
    else if (action.type === 'check-dns') await checkPipelineDns(this.app, action.productId, action.accountId);
    else if (action.type === 'suppress-domain') suppressPipelineDomain(this.app, action.domain, action.reason);
    else if (action.type === 'distill') await this.distill(action.productId);
    else {
      const lead = this.lead(action.productId, action.id, action.revision);
      if (action.type === 'retry') {
        if (!['DISCOVERED', 'ENRICHED', 'QUALIFIED', 'DRAFT_READY', 'REPLIED'].includes(lead.stage) || lead.deliveryId) throw new Error('This lead is no longer in a preparation stage.');
        savePipelineLead(this.app, lead, { requested: true, nextAt: this.app.clock.now(), lease: null }, 'Preparation queued from the saved stage.');
      }
      if (action.type === 'pause') { this.pause(lead.productId); savePipelineLead(this.app, lead, { requested: false, lease: null }, 'Preparation paused by you.'); }
      if (action.type === 'verify-email') await verifyPipelineEmail(this.app, lead.productId, lead.email);
      if (action.type === 'edit') {
        if (lead.stage !== 'DRAFT_READY' || !lead.draft || lead.deliveryId) throw new Error('Only an unapproved draft can be edited.');
        savePipelineLead(this.app, lead, { draft: { ...lead.draft, subject: action.subject, body: action.body, criticPassed: false }, requested: true, lease: null }, 'Your edit is saved. Independent critique is queued; approval waits for it.');
      }
      if (action.type === 'approve') {
        if (lead.stage !== 'DRAFT_READY' || lead.requested || lead.deliveryId || !this.app.outreach) throw new Error('Wait for the current draft review before approving.');
        const policy = this.app.outreach.policy(lead.productId), source = this.app.sales?.sources().find(s => s.productId === lead.productId && s.accountId === policy.accountId);
        if (policy.revision !== action.policyRevision || (source?.senderEmail ?? source?.mailbox) !== action.sender) throw new Error('Sending settings changed. Review the current preview.');
        if (firstEmailViolations(lead.draft!.subject, lead.draft!.body).length) throw new Error('The draft no longer passes first-email checks.');
        this.app.db.transaction(() => {
          const deliveryId = this.app.outreach!.queueReviewedProspect(this.prospectDraft(lead));
          savePipelineLead(this.app, lead, { deliveryId, requested: false }, 'One exact email approved and queued. Sending still requires all mailbox checks and running Operations.');
        });
      }
      if (action.type === 'approve-reply') {
        if (lead.stage !== 'REPLIED' || !lead.lastMessageId || !lead.triage || ['OTHER', 'UNSUBSCRIBE_OR_NEGATIVE'].includes(lead.triage.intent)) throw new Error('Review the current incoming message before approving a response.');
        const id = this.app.salesReplies!.queueOwnerReply(lead.productId, lead.lastMessageId, action.body);
        pipelinePut(this.app, 'pending-feedback', id, { original: lead.triage.suggested_reply, final: action.body });
      }
    }
    return this.view();
  }
  view(): PipelineView {
    const products = this.app.connections?.view().products ?? [];
    const leads = products.flatMap(p => this.leads(p.id)); const runs = pipelineRows<PipelineRun>(this.app, 'run');
    return { offline: this.app.env.SIGNAL_OFFLINE === '1', verifierConfigured: Boolean(verifierKey(this.app)), leads, inboxes: pipelineRows(this.app, 'inbox'), runs: runs.sort((a, b) => b.at - a.at).slice(0, 200), metrics: products.map(p => {
      const own = leads.filter(l => l.productId === p.id), attempts = runs.filter(r => r.productId === p.id);
      const confirmed = this.app.outreach?.jobs(p.id).filter(j => j.status === 'sent') ?? [];
      const sentIds = new Set(confirmed.map(j => j.leadId));
      const sent = own.filter(l => sentIds.has(l.id)).length;
      const positive = (l: PipelineLead) => sentIds.has(l.id) && l.triage?.intent === 'INTERESTED_READY' && l.triage.confidence >= 0.7;
      const positiveReplies = own.filter(positive).length;
      const revenueState = this.app.revenue?.context(p.id);
      const payments = this.app.revenue?.payments(p.id) ?? [];
      const totals = (group: PipelineLead[]) => {
        const deliveries = new Set(confirmed.filter(j => group.some(l => l.id === j.leadId)).map(j => j.id));
        const attributed = payments.filter(payment => payment.live && !payment.disputed && payment.campaignId && deliveries.has(payment.campaignId));
        const currencies = [...new Set(attributed.map(payment => payment.currency))];
        const measured = revenueState?.status === 'current' && revenueState.lastCompleteAt !== null && revenueState.lastCompleteAt >= this.app.clock.now() - DAY && currencies.length === 1;
        return { revenue: measured ? attributed.reduce((sum, payment) => sum + Math.max(0, payment.captured - payment.refunded), 0) : null, currency: measured ? currencies[0]! : null };
      };
      const angles = [...new Set(own.map(l => l.qualification?.angle_tag ?? 'unqualified'))].map(angle => { const group = own.filter(l => (l.qualification?.angle_tag ?? 'unqualified') === angle); return { angle, leads: group.length, sent: group.filter(l => sentIds.has(l.id)).length, positiveReplies: group.filter(positive).length, ...totals(group) }; });
      return { productId: p.id, leads: own.length, schemaPassRate: attempts.length ? attempts.filter(a => a.schemaValid).length / attempts.length : null, retries: attempts.filter(a => a.retry > 0).length, sent, positiveReplies, positiveReplyRate: sent ? positiveReplies / sent : null, won: own.filter(l => l.stage === 'CLOSED_WON').length, ...totals(own), angles };
    }) };
  }
}
