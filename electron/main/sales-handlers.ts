import type { IpcMain } from 'electron';
import { z } from 'zod';
import { ProspectService } from '../../src/core/sales/prospects.js';
import { prospectActionSchema } from '../../src/shared/prospects.js';
import type { App } from '../../src/core/app.js';
import { SalesService } from '../../src/core/sales/service.js';
import { importLeads } from '../../src/core/sales/lead-import.js';
import { SalesReplyService } from '../../src/core/sales/reply-service.js';
import { OutreachService } from '../../src/core/sales/outreach-service.js';
import { ProspectResearchService } from '../../src/core/sales/prospect-research.js';
import { prospectResearchActionSchema } from '../../src/shared/prospect-research.js';
import { outreachActionSchema } from '../../src/shared/outreach.js';
import { SalesHandoffs } from '../../src/core/sales/handoffs.js';
import { handoffActionSchema } from '../../src/shared/handoffs.js';
import { replyActionSchema } from '../../src/shared/sales-replies.js';
import { salesActionSchema } from '../../src/shared/sales.js';
import { IPC } from '../../src/shared/ipc.js';
import { trustedSignalFrame } from './runtime-handlers.js';

export function registerSalesHandlers(ipc: IpcMain, app: App) {
  const service = new SalesService(app); app.sales = service;
  const prospects = new ProspectService(app); app.prospects = prospects;
  ipc.handle(IPC.prospects, event => { trustedSignalFrame(event); return prospects.view(); });
  ipc.handle(IPC.prospectCatalog, (event, productId: unknown, accountId: unknown) => { trustedSignalFrame(event); return prospects.catalog(z.string().min(1).max(100).parse(productId), z.string().min(1).max(100).parse(accountId)); });
  ipc.handle(IPC.prospectAction, async (event, input: unknown) => {
    trustedSignalFrame(event); const action = prospectActionSchema.parse(input);
    if (action.type === 'configure') await prospects.configure(action.productId, action.value);
    else await prospects.sync(action.productId, false, action.provider);
    return prospects.view();
  });
  ipc.handle(IPC.leadImport, (event, input: unknown) => { trustedSignalFrame(event); return importLeads(app, input); });
  const replies = new SalesReplyService(app); app.salesReplies = replies;
  const outreach = new OutreachService(app); app.outreach = outreach;
  const research = new ProspectResearchService(app); app.prospectResearch = research;
  ipc.handle(IPC.prospectResearch, event => { trustedSignalFrame(event); return research.view(); });
  ipc.handle(IPC.prospectResearchAction, (event, input: unknown) => {
    trustedSignalFrame(event); const action = prospectResearchActionSchema.parse(input);
    if (action.type === 'configure') research.configure(action.productId, action.value);
    if (action.type === 'research') research.request(action.productId);
    if (action.type === 'inspect') research.request(action.productId, action.url);
    if (action.type === 'draft-lead') research.requestLead(action.productId, action.leadId, action.url);
    if (action.type === 'edit') research.edit(action.productId, action.id, action.updatedAt, action.subject, action.body);
    if (action.type === 'reject') research.reject(action.productId, action.id);
    if (action.type === 'submitted') research.submitted(action.productId, action.id, action.url);
    if (action.type === 'approve') research.approve(action.productId, action.id, action.updatedAt, action.policyRevision, action.sender);
    return research.view();
  });
  ipc.handle(IPC.outreach, event => { trustedSignalFrame(event); return outreach.view(); });
  ipc.handle(IPC.outreachAction, async (event, input: unknown) => {
    trustedSignalFrame(event); const action = outreachActionSchema.parse(input);
    if (action.type === 'configure') outreach.configure(action.productId, action.value);
    if (action.type === 'prepare') await outreach.prepare(action.productId, action.leadId);
    if (action.type === 'cancel') outreach.cancel(action.productId, action.id);
    if (action.type === 'reconcile') await outreach.reconcile(action.productId, action.id);
    if (action.type === 'stop-followups') outreach.stopFollowUps(action.productId, action.id);
    return outreach.view();
  });
  const handoffs = new SalesHandoffs(app); app.salesHandoffs = handoffs;
  ipc.handle(IPC.handoffs, event => { trustedSignalFrame(event); return handoffs.view(); });
  ipc.handle(IPC.handoffAction, async (event, input: unknown) => { trustedSignalFrame(event); return handoffs.action(handoffActionSchema.parse(input)); });
  ipc.handle(IPC.salesReplies, event => { trustedSignalFrame(event); return replies.view(); });
  ipc.handle(IPC.salesReplyAction, async (event, input: unknown) => {
    trustedSignalFrame(event); const action = replyActionSchema.parse(input);
    if (action.type === 'configure') replies.configure(action.productId, action.value);
    if (action.type === 'prepare') await replies.prepare(action.productId, action.messageId);
    if (action.type === 'cancel') replies.cancel(action.productId, action.id);
    if (action.type === 'reconcile') await replies.reconcile(action.productId, action.id);
    if (action.type === 'retry-reply') await replies.retryReply(action.productId, action.id);
    if (action.type === 'stop-sequence') replies.stopSequence(action.productId, action.id);
    return replies.view();
  });
  ipc.handle(IPC.sales, event => { trustedSignalFrame(event); return service.view(); });
  ipc.handle(IPC.salesAction, async (event, input: unknown) => {
    trustedSignalFrame(event); const action = salesActionSchema.parse(input);
    if (action.type === 'configure') await service.configureVerified(action.productId, action.value);
    if (action.type === 'load-senders') await app.connections!.gmailSenders(action.productId, action.accountId);
    if (action.type === 'link-gmail') await app.connections!.reuseGmail(action.sourceProductId, action.accountId, action.productId);
    if (action.type === 'sync') await service.sync(action.productId, action.accountId);
    if (action.type === 'remove-source') service.remove(action.productId, action.accountId);
    if (action.type === 'triage') await service.triage(action.productId, action.id);
    if (action.type === 'review') service.review(action.productId, action.id);
    if (action.type === 'suppress') service.suppress(action.productId, action.email, action.reason);
    if (action.type === 'lead') service.addLead(action.productId, action.id);
    return service.view();
  });
}
