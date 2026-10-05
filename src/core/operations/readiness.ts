import type { App } from '../app.js';
import type { OperationReadiness, OperationState } from '../../shared/operations.js';
import { DELIVERY_PROVIDERS, hasPublishingPermission } from '../../shared/operations.js';
import { replyAccountCanSend } from '../../shared/sales-replies.js';
import { mailboxAddress } from '../sales/inbox.js';
import { imageWorkflow } from './images.js';
import { BRAND_CARD_WORKFLOW } from '../../shared/brand-card.js';
import { youtubeCanUpload } from '../../shared/video-publishing.js';

export function operationReadiness(app: App, state: OperationState): OperationReadiness {
  const productId = state.productId; const activities: OperationReadiness['activities'] = [];
  const accounts = app.connections?.accounts().filter(a => a.productId === productId) ?? [];
  const sources = app.sales?.sources().filter(s => s.productId === productId) ?? [];
  let needsAgents = false;
  const canReadInbox = (inbox: NonNullable<ReturnType<typeof account>>) => inbox.provider === 'gmail' ? inbox.grantedScopes.some(s => ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify', 'https://mail.google.com/'].includes(s)) : inbox.grantedScopes.some(s => ['Mail.Read', 'Mail.ReadWrite', 'https://graph.microsoft.com/Mail.Read', 'https://graph.microsoft.com/Mail.ReadWrite'].includes(s));
  const account = (id: string, providers: readonly string[]) => accounts.find(a => a.id === id && providers.includes(a.provider) && a.status === 'verified' && (!a.expiresAt || a.expiresAt > app.clock.now() || a.refreshable));
  const add = (label: string, ready: boolean, detail: string) => activities.push({ label, ready, detail });
  if (app.prospectResearch?.state(productId).enabled) {
    needsAgents = true;
    add('Prospects and placement drafts', true, 'Research relevant businesses, blogs and community discussions. Prepare proposals for review; cold emails require individual approval and community submissions need a permitted route.');
  }
  if (state.mode === 'acquisition') {
    needsAgents = true;
    add('Customer acquisition', Boolean(state.discovery?.enabled), state.discovery?.enabled ? 'Qualify observed buyer problems before preparing a campaign. No-fit results continue research; public authors are not email leads. Existing Sales and reporting policies remain in effect.' : 'Enable public buyer research so acquisition decisions have actual customer evidence.');
    if (state.replyToRequests) {
      const ready = Boolean(state.discovery?.enabled && state.discovery.queries.some(q => q.kind === 'bluesky') && state.accountIds.some(id => account(id, ['bluesky'])));
      add('Public request replies', ready, ready ? `Reply to supported original Bluesky requests ${state.publicReplyLimit !== undefined ? "under the separate reply budget" : "within the " + state.dailyLimit + "-publication rolling daily limit"}, with ${state.publicReplyLimit !== undefined ? state.publicReplyLimit + " separately budgeted replies for this business and at most 10 across businesses" : "at most three initial replies across businesses"} and no repeat approaches to a person within 30 days. Each reply needs product review and current thread access.` : 'Select a verified Bluesky destination and save at least one Bluesky search before enabling public replies.');
    }
  }
  const youtube = app.videoPublishing?.policy(productId);
  if (app.videoCampaigns?.policy(productId).enabled) {
    needsAgents = true; const setup = app.videoCampaigns.setup(productId);
    add('Automatic video production', setup.ready, setup.detail);
  }
  if (youtube?.enabled) {
    const destination = account(youtube.accountId, ['youtube']);
    const ready = Boolean(destination && youtubeCanUpload(destination) && youtube.channelId);
    add('YouTube ads', ready, ready ? `Upload approved ads to ${youtube.channelTitle} as ${youtube.privacy}, up to ${youtube.dailyLimit} per rolling day shared across this channel.` : 'Choose a verified channel with upload permission in Video production.');
  }
  if (state.discovery?.enabled) {
    const ready = state.discovery.queries.every(q => q.kind === 'bluesky' ? accounts.some(a => a.provider === 'bluesky' && a.status === 'verified') : app.pollers.some(p => p.kind === q.kind && p.available().ready));
    add('Public buyer research', ready, ready ? 'Search recent public discussions for this business and use relevant buyer problems in campaigns. Public authors are not added to email outreach.' : 'The selected public search provider is unavailable.');
  }
  for (const id of state.accountIds) {
    const found = account(id, DELIVERY_PROVIDERS); const destination = found && hasPublishingPermission(found) ? found : undefined; needsAgents = true;
    add('Publishing', Boolean(destination), destination ? `Publish to ${destination.label} within the saved limits.` : 'Reconnect or remove the unavailable publishing destination in Operating settings.');
  }
  if (state.imageWorkflowId) {
    let valid = state.accountIds.some(id => account(id, ['bluesky']));
    try { imageWorkflow(app, productId, state.imageWorkflowId); } catch { valid = false; }
    add('Campaign images', Boolean(valid), valid ? state.imageWorkflowId === BRAND_CARD_WORKFLOW ? 'Lay out reviewed campaign copy in a local branded card and check that the text fits.' : 'Render and review images using the selected workflow.' : 'Choose an available image workflow and a verified Bluesky destination, or select Text only.');
  }
  for (const source of sources.filter(s => s.autoSync)) {
    const inbox = account(source.accountId, ['gmail', 'outlook']); needsAgents ||= source.aiTriage;
    const ready = Boolean(inbox && mailboxAddress(inbox.identity) && canReadInbox(inbox));
    add('Inbox monitoring', ready, ready ? `Read ${inbox!.label}${source.aiTriage ? ' and triage with AI' : ''}.` : 'Reconnect this monitored inbox with read access or stop its automatic monitoring in Sales.');
  }
  const sendReady = (id: string) => { const inbox = account(id, ['gmail', 'outlook']); return Boolean(inbox && mailboxAddress(inbox.identity) && replyAccountCanSend(inbox) && sources.some(s => s.accountId === id && s.autoSync && s.aiTriage)); };
  const replies = app.salesReplies?.policy(productId);
  if (replies?.enabled) {
    needsAgents = true; const ready = replies.accountIds.length > 0 && replies.accountIds.every(sendReady);
    add('Email replies and follow-ups', ready, ready ? `Up to ${replies.dailyLimit} replies per rolling day under the Sales policy.` : 'In Sales, choose verified sending inboxes with automatic monitoring and AI triage, or disable automatic replies.');
  }
  const outreach = app.outreach?.policy(productId);
  if (outreach?.enabled) {
    needsAgents = true; const ready = sendReady(outreach.accountId);
    add('Initial outreach', ready, ready ? `Up to ${outreach.dailyLimit} outreach emails per rolling day, shared by opted-in outreach and individually approved cold introductions. Opted-in sequences allow up to ${outreach.followUpDays.length} follow-ups; cold introductions have none.` : 'In Sales, reconnect the outreach inbox with sending access, monitoring and AI triage, or disable outreach.');
  }
  for (const prospect of app.prospects?.sources().filter(s => s.productId === productId && s.enabled) ?? []) {
    const provider = prospect.provider ?? 'mailchimp', label = provider === 'signal-blog' ? 'website requests' : 'Mailchimp audience';
    add('Prospect ingestion', Boolean(account(prospect.accountId, [provider]) && prospect.businessConfirmed), account(prospect.accountId, [provider]) && prospect.businessConfirmed ? `Read the ${label} ${prospect.audienceName}.` : `Reconnect the ${label} source and confirm its business in Sales, or disable it.`);
  }
  for (const source of app.revenue?.states().filter(s => s.productId === productId) ?? []) add('Sales tracking', Boolean(account(source.accountId, ['stripe'])), account(source.accountId, ['stripe']) ? 'Read Stripe payments for the configured products.' : 'Reconnect the configured Stripe account in Connections.');
  for (const source of app.analytics?.states().filter(s => s.productId === productId) ?? []) add('Traffic analytics', Boolean(account(source.accountId, ['ga4'])), account(source.accountId, ['ga4']) ? 'Read the configured Google Analytics property.' : 'Reconnect Google Analytics or remove its source in Analytics.');
  const blockers = activities.filter(a => !a.ready).map(a => `${a.label}: ${a.detail}`);
  if (!activities.length) blockers.push('Configure at least one activity: publishing, Sales inbox monitoring, outreach, prospect ingestion, Revenue or Analytics.');
  if (app.env.SIGNAL_OFFLINE === '1') blockers.push('Turn off offline mode before running network activities.');
  return { productId, activities, needsAgents, blockers, ready: blockers.length === 0 };
}
