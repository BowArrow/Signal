import type { StudioView, StudioAction } from './studio.js';
import type { OperationsView, OperationAction } from './operations.js';
import type { RevenueView, RevenueAction, RevenueResult } from './revenue.js';
import type { AnalyticsView, AnalyticsAction } from './analytics.js';
import type { SeoView, SeoAction } from './seo.js';
import type { HandoffView, HandoffAction } from './handoffs.js';
import type { SalesView, SalesAction } from './sales.js';
import type { ReplyView, ReplyAction } from './sales-replies.js';
import type { OutreachView, OutreachAction } from './outreach.js';
import type { ProspectResearchView, ProspectResearchAction } from './prospect-research.js';
import type { LeadImportAction, LeadImportPreview } from './lead-import.js';
import type { ProspectView, ProspectAction, MailchimpAudience } from './prospects.js';
import type { ConnectionView, ConnectionAction, ConnectionResult } from './connections.js';
import type { RuntimeView, RuntimeAction } from './runtime.js';
import type { DesktopView, DesktopAction } from './desktop.js';
import type { CreativeView } from './creative.js';
import type { VideoAction, VideoView } from './video.js';
import type { LocalVideoCheck } from '../core/video/comfy.js';
/**
 * The typed contract between the Electron main process (which owns the engine
 * and the database) and the renderer (which owns nothing).
 *
 * The renderer never touches SQLite, the network, or a credential. Everything
 * crosses this boundary, which is also where the guardrails stay enforceable:
 * public community replies require approval; autonomous owned-channel delivery
 * requires an owner-started policy, enforced in the main process.
 */

import type { GrowthAction, GrowthDashboard } from './growth.js';
import type { MarketingAction, MarketingView } from './marketing.js';

export interface CapabilityView {
  readonly name: string;
  readonly available: boolean;
  readonly missing: readonly string[];
}

export interface SourceView {
  readonly id: string;
  readonly kind: string;
  readonly displayName: string;
  readonly identifier: string;
  readonly enabled: boolean;
  readonly pollIntervalSeconds: number;
  readonly lastPolledAt: number | null;
  readonly lastPollError: string | null;
  readonly hasRulesRecord: boolean;
}

export interface ProductView {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly priceCents: number;
  readonly utmBase: string;
  readonly utmBaseIsPlaceholder: boolean;
}

export interface OpportunityView {
  readonly id: string;
  readonly source: string;
  readonly title: string;
  readonly url: string;
  readonly author: string | null;
  readonly status: string;
  readonly postedAt: number | null;
  readonly discoveredAt: number;
  readonly commentCount: number | null;
  readonly platformScore: number | null;
  readonly scoreTotal: number | null;
}

export interface SystemStatus {
  readonly version: string;
  readonly capabilities: readonly CapabilityView[];
  readonly sources: readonly SourceView[];
  readonly products: readonly ProductView[];
  readonly opportunityCounts: Readonly<Record<string, number>>;
  readonly queueStats: Readonly<Record<string, number>>;
  readonly databasePath: string;
  readonly runtime: {
    readonly electron: string;
    readonly node: string;
    readonly nativeBinding: string | null;
  };
  /** Publish limits currently in force. Shown so they are never a surprise. */
  readonly limits: {
    readonly maxRepliesPerPlatformPerDay: number;
    readonly communityCooldownDays: number;
    readonly selfPromoRatioMaxPct: number;
  };
}

export interface IngestSummary {
  readonly inserted: number;
  readonly updated: number;
  readonly dropped: number;
  readonly durationMs: number;
  readonly sources: readonly {
    readonly source: string;
    readonly status: string;
    readonly inserted: number;
    readonly detail?: string | undefined;
  }[];
}

export interface CommunityView {
  readonly id: string;
  readonly platform: string;
  readonly displayName: string;
  readonly monitored: boolean;
  readonly blocked: boolean;
  readonly blockedReason: string | null;
  readonly opportunities: number;
  /** Null when no rules record exists — which is what blocks drafting. */
  readonly selfPromo: string | null;
  readonly ratioCapPct: number | null;
  readonly flairRequired: boolean;
  readonly verified: boolean;
  readonly confidence: number | null;
  readonly evidence: readonly string[];
  readonly rawRuleCount: number;
  readonly sourceUrl: string | null;
  readonly fetchedAt: number | null;
}

export interface ScoringView {
  readonly weights: { contribution: number; intent: number; fit: number; risk: number };
  readonly threshold: number;
  readonly hash: string;
  /** How the current threshold splits everything scored so far. */
  readonly counts: { scored: number; expired: number; rulesUnknown: number; unscored: number };
}

export interface ScoreAxis {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly weight: number;
}

export interface ValidatorView {
  readonly rule: string;
  readonly state: 'pass' | 'warn' | 'block';
  readonly message: string;
}

export interface LimitCheckView {
  readonly rule: string;
  readonly passed: boolean;
  readonly message: string;
  readonly clearsAt?: number;
}

export interface QueueItemView {
  readonly draftId: string;
  readonly opportunityId: string;
  readonly title: string;
  readonly url: string;
  readonly author: string | null;
  readonly threadBody: string;
  readonly community: string;
  readonly platform: string;
  readonly postedAt: number | null;
  readonly promptVersion: string;
  readonly body: string;
  readonly edited: boolean;
  readonly total: number | null;
  readonly axes: readonly ScoreAxis[];
  readonly product: string | null;
  readonly validators: readonly ValidatorView[];
  readonly limits: readonly LimitCheckView[];
  /** Null when approving is allowed right now. */
  readonly blockedBy: string | null;
  readonly warnings: readonly string[];
  /** How this would actually be published, given what is available. */
  readonly publishMethod: 'api' | 'manual';
  readonly rules: {
    readonly selfPromo: string | null;
    readonly ratioCapPct: number | null;
    readonly flairRequired: boolean;
    readonly verified: boolean;
    readonly reviewedAt: number | null;
  };
}

export interface ApproveOutcome {
  readonly ok: boolean;
  readonly method?: 'api' | 'manual';
  readonly body?: string;
  readonly note?: string;
  readonly trackedUrl?: string | null;
  readonly blockedBy?: string;
}

export const IPC = {
  revenue: 'signal:revenue',
  analytics: 'signal:analytics',
  seo: 'signal:seo',
  seoAction: 'signal:seo-action',
  handoffs: 'signal:handoffs',
  handoffAction: 'signal:handoff-action',
  analyticsAction: 'signal:analytics-action',
  sales: 'signal:sales',
  salesReplies: 'signal:sales-replies',
  outreach: 'signal:outreach',
  prospectResearch: 'signal:prospect-research',
  prospectResearchAction: 'signal:prospect-research-action',
  leadImport: 'signal:lead-import',
  prospects: 'signal:prospects',
  prospectAction: 'signal:prospect-action',
  prospectCatalog: 'signal:prospect-catalog',
  outreachAction: 'signal:outreach-action',
  salesReplyAction: 'signal:sales-reply-action',
  salesAction: 'signal:sales-action',
  revenueAction: 'signal:revenue-action',
  operations: 'signal:operations',
  operationAction: 'signal:operation-action',
  operationImage: 'signal:operation-image',
  connections: 'signal:connections', connectionAction: 'signal:connection-action',
  creative: 'signal:creative', creativeAction: 'signal:creative-action', creativePreview: 'signal:creative-preview',
  video: 'signal:video', videoAction: 'signal:video-action', videoPreview: 'signal:video-preview',
  studio: 'signal:studio', studioAction: 'signal:studio-action', studioExport: 'signal:studio-export',
  runtime: 'signal:runtime', runtimeAction: 'signal:runtime-action', desktop: 'signal:desktop', desktopAction: 'signal:desktop-action',
  marketing: 'signal:marketing', marketingAction: 'signal:marketing-action',
  marketingReport: 'signal:marketing-report',
  marketingComfy: 'signal:marketing-comfy', marketingProduct: 'signal:marketing-product',
  marketingAsset: 'signal:marketing-asset', marketingCancelMedia: 'signal:marketing-cancel-media',
  growth: 'signal:growth',
  growthAction: 'signal:growth-action',
  growthRuntime: 'signal:growth-runtime',
  status: 'signal:status',
  opportunities: 'signal:opportunities',
  ingestNow: 'signal:ingest-now',
  toggleSource: 'signal:toggle-source',
  openExternal: 'signal:open-external',
  menu: 'signal:menu',
  communities: 'signal:communities',
  scoring: 'signal:scoring',
  setScoring: 'signal:set-scoring',
  queue: 'signal:queue',
  approve: 'signal:approve',
  reject: 'signal:reject',
  editDraft: 'signal:edit-draft',
  reviewRules: 'signal:review-rules',
  blockCommunity: 'signal:block-community',
  copyToClipboard: 'signal:copy',
} as const;

export type MenuCommand = 'poll';

/** What preload exposes on window.signal. */
export interface SignalBridge {
  revenue(): Promise<RevenueView>;
  analytics(): Promise<AnalyticsView>;
  seo(): Promise<SeoView>;
  seoAction(action: SeoAction): Promise<SeoView>;
  handoffs(): Promise<HandoffView>;
  handoffAction(action: HandoffAction): Promise<HandoffView>;
  analyticsAction(action: AnalyticsAction): Promise<AnalyticsView>;
  sales(): Promise<SalesView>;
  salesReplies(): Promise<ReplyView>;
  outreach(): Promise<OutreachView>;
  prospectResearch(): Promise<ProspectResearchView>;
  prospectResearchAction(action: ProspectResearchAction): Promise<ProspectResearchView>;
  leadImport(action: LeadImportAction): Promise<LeadImportPreview>;
  prospects(): Promise<ProspectView>;
  prospectAction(action: ProspectAction): Promise<ProspectView>;
  prospectCatalog(productId: string, accountId: string): Promise<MailchimpAudience[]>;
  outreachAction(action: OutreachAction): Promise<OutreachView>;
  salesReplyAction(action: ReplyAction): Promise<ReplyView>;
  salesAction(action: SalesAction): Promise<SalesView>;
  revenueAction(action: RevenueAction): Promise<RevenueResult>;
  operations(): Promise<OperationsView>;
  operationAction(action: OperationAction): Promise<OperationsView>;
  operationImage(productId: string, id: string): Promise<string>;
  connections(): Promise<ConnectionView>;
  connectionAction(action: ConnectionAction): Promise<ConnectionResult>;
  creative(): Promise<CreativeView>;
  video(): Promise<VideoView>;
  videoAction(action: VideoAction): Promise<{ view: VideoView; local?: LocalVideoCheck }>;
  videoPreview(productId: string, id: string, kind: 'character' | 'output' | 'blockout' | 'music'): Promise<{ dataUrl: string; mime: string }>;
  creativeAction(action: { type: 'chooseFolder' | 'start' | 'stop' | 'install' | 'cancelInstall' } | { type: 'recipe'; id: string; productId: string }): Promise<CreativeView>;
  creativePreview(id: string, index: number): Promise<{ dataUrl: string; mime: string; filename: string }>;
  studio(): Promise<StudioView>;
  studioAction(action: StudioAction): Promise<StudioView>;
  studioExport(productId: string, campaignId: string): Promise<boolean>;
  runtime(): Promise<RuntimeView>;
  runtimeAction(action: RuntimeAction): Promise<RuntimeView>;
  desktop(): Promise<DesktopView>;
  desktopAction(action: DesktopAction): Promise<DesktopView>;
  marketing(): Promise<MarketingView>;
  marketingReport(): Promise<void>;
  marketingAction(action: MarketingAction): Promise<MarketingView>;
  marketingComfy(productId: string, checkpoint?: string): Promise<{ ok: boolean; detail: string; checkpoints: string[] }>;
  marketingProduct(productId: string, capture: boolean): Promise<{ detail: string }>;
  marketingAsset(id: string, index: number): Promise<void>;
  marketingCancelMedia(id: string): Promise<void>;
  growth(): Promise<GrowthDashboard>;
  growthAction(action: GrowthAction): Promise<GrowthDashboard>;
  growthRuntime(): Promise<{ ok: boolean; detail: string; models?: string[] }>;
  /** The window has no native title bar, so layout has to know the platform. */
  readonly platform: 'darwin' | 'win32' | 'linux';
  status(): Promise<SystemStatus>;
  opportunities(limit?: number): Promise<OpportunityView[]>;
  ingestNow(): Promise<IngestSummary>;
  toggleSource(sourceId: string, enabled: boolean): Promise<void>;
  openExternal(url: string): Promise<void>;
  /** Returns an unsubscribe function. */
  onMenuCommand(handler: (command: MenuCommand) => void): () => void;

  communities(): Promise<CommunityView[]>;
  scoring(): Promise<ScoringView>;
  setScoring(next: {
    weights?: ScoringView['weights'];
    threshold?: number;
  }): Promise<ScoringView>;

  queue(): Promise<QueueItemView[]>;
  /**
   * The one action that puts text in front of strangers. Everything it needs
   * to refuse is re-checked in the main process, not here.
   */
  approve(draftId: string): Promise<ApproveOutcome>;
  reject(draftId: string, reason: string, note?: string): Promise<void>;
  editDraft(draftId: string, body: string): Promise<void>;

  reviewRules(communityId: string, selfPromo?: string): Promise<void>;
  blockCommunity(communityId: string, reason: string): Promise<void>;
  copyToClipboard(text: string): Promise<void>;
}

declare global {
  interface Window {
    readonly signal: SignalBridge;
  }
}
