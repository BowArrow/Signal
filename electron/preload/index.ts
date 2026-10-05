import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type MenuCommand, type SignalBridge } from '../../src/shared/ipc.js';

/**
 * The only surface the renderer gets. contextIsolation is on, so this is a
 * hard boundary rather than a convention — the renderer has no require, no
 * process, and no way to reach the database except through these calls.
 */
const bridge: SignalBridge = {
  desktop: () => ipcRenderer.invoke(IPC.desktop),
  desktopAction: action => ipcRenderer.invoke(IPC.desktopAction, action),
  revenue: () => ipcRenderer.invoke(IPC.revenue),
  analytics: () => ipcRenderer.invoke(IPC.analytics),
  seo: () => ipcRenderer.invoke(IPC.seo),
  seoAction: action => ipcRenderer.invoke(IPC.seoAction, action),
  handoffs: () => ipcRenderer.invoke(IPC.handoffs),
  handoffAction: action => ipcRenderer.invoke(IPC.handoffAction, action),
  analyticsAction: action => ipcRenderer.invoke(IPC.analyticsAction, action),
  sales: () => ipcRenderer.invoke(IPC.sales),
  salesReplies: () => ipcRenderer.invoke(IPC.salesReplies),
  outreach: () => ipcRenderer.invoke(IPC.outreach),
  prospectResearch: () => ipcRenderer.invoke(IPC.prospectResearch),
  prospectResearchAction: action => ipcRenderer.invoke(IPC.prospectResearchAction, action),
  leadImport: action => ipcRenderer.invoke(IPC.leadImport, action),
  prospects: () => ipcRenderer.invoke(IPC.prospects),
  prospectAction: action => ipcRenderer.invoke(IPC.prospectAction, action),
  prospectCatalog: (productId, accountId) => ipcRenderer.invoke(IPC.prospectCatalog, productId, accountId),
  outreachAction: action => ipcRenderer.invoke(IPC.outreachAction, action),
  salesReplyAction: action => ipcRenderer.invoke(IPC.salesReplyAction, action),
  salesAction: action => ipcRenderer.invoke(IPC.salesAction, action),
  revenueAction: action => ipcRenderer.invoke(IPC.revenueAction, action),
  operations: () => ipcRenderer.invoke(IPC.operations),
  operationAction: action => ipcRenderer.invoke(IPC.operationAction, action),
  operationImage: (productId, id) => ipcRenderer.invoke(IPC.operationImage, productId, id),
  connections: () => ipcRenderer.invoke(IPC.connections),
  connectionAction: action => ipcRenderer.invoke(IPC.connectionAction, action),
  creative: () => ipcRenderer.invoke(IPC.creative),
  video: () => ipcRenderer.invoke(IPC.video),
  videoAction: action => ipcRenderer.invoke(IPC.videoAction, action),
  videoPreview: (productId, id, kind) => ipcRenderer.invoke(IPC.videoPreview, productId, id, kind),
  creativeAction: action => ipcRenderer.invoke(IPC.creativeAction, action),
  creativePreview: (id, index) => ipcRenderer.invoke(IPC.creativePreview, id, index),
  studio: () => ipcRenderer.invoke(IPC.studio),
  studioAction: action => ipcRenderer.invoke(IPC.studioAction, action),
  studioExport: (productId, campaignId) => ipcRenderer.invoke(IPC.studioExport, productId, campaignId),
  runtime: () => ipcRenderer.invoke(IPC.runtime),
  runtimeAction: action => ipcRenderer.invoke(IPC.runtimeAction, action),
  marketing: () => ipcRenderer.invoke(IPC.marketing),
  marketingReport: () => ipcRenderer.invoke(IPC.marketingReport),
  marketingAction: (action) => ipcRenderer.invoke(IPC.marketingAction, action),
  marketingComfy: (productId, checkpoint) => ipcRenderer.invoke(IPC.marketingComfy, productId, checkpoint),
  marketingProduct: (productId, capture) => ipcRenderer.invoke(IPC.marketingProduct, productId, capture),
  marketingAsset: (id, index) => ipcRenderer.invoke(IPC.marketingAsset, id, index),
  marketingCancelMedia: (id) => ipcRenderer.invoke(IPC.marketingCancelMedia, id),
  growth: () => ipcRenderer.invoke(IPC.growth),
  growthAction: (action) => ipcRenderer.invoke(IPC.growthAction, action),
  growthRuntime: () => ipcRenderer.invoke(IPC.growthRuntime),
  platform: process.platform as SignalBridge['platform'],
  status: () => ipcRenderer.invoke(IPC.status),
  opportunities: (limit) => ipcRenderer.invoke(IPC.opportunities, limit),
  ingestNow: () => ipcRenderer.invoke(IPC.ingestNow),
  toggleSource: (sourceId, enabled) => ipcRenderer.invoke(IPC.toggleSource, sourceId, enabled),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  communities: () => ipcRenderer.invoke(IPC.communities),
  scoring: () => ipcRenderer.invoke(IPC.scoring),
  setScoring: (next) => ipcRenderer.invoke(IPC.setScoring, next),
  queue: () => ipcRenderer.invoke(IPC.queue),
  approve: (draftId) => ipcRenderer.invoke(IPC.approve, draftId),
  reject: (draftId, reason, note) => ipcRenderer.invoke(IPC.reject, draftId, reason, note),
  editDraft: (draftId, body) => ipcRenderer.invoke(IPC.editDraft, draftId, body),
  reviewRules: (communityId, selfPromo) =>
    ipcRenderer.invoke(IPC.reviewRules, communityId, selfPromo),
  blockCommunity: (communityId, reason) =>
    ipcRenderer.invoke(IPC.blockCommunity, communityId, reason),
  copyToClipboard: (text) => ipcRenderer.invoke(IPC.copyToClipboard, text),
  onMenuCommand: (handler) => {
    // The event object stays on this side of the bridge; only the command
    // string crosses. Handing the renderer an IpcRendererEvent would give it
    // a sender it could reply on.
    const listener = (_event: unknown, command: MenuCommand): void => handler(command);
    ipcRenderer.on(IPC.menu, listener);
    return () => ipcRenderer.removeListener(IPC.menu, listener);
  },
};

contextBridge.exposeInMainWorld('signal', bridge);
