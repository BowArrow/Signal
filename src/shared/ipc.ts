/**
 * The typed contract between the Electron main process (which owns the engine
 * and the database) and the renderer (which owns nothing).
 *
 * The renderer never touches SQLite, the network, or a credential. Everything
 * crosses this boundary, which is also where the guardrails stay enforceable:
 * a renderer bug cannot publish anything, because there is no channel for it
 * that does not go through an explicit approve action in the main process.
 */

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

export const IPC = {
  status: 'signal:status',
  opportunities: 'signal:opportunities',
  ingestNow: 'signal:ingest-now',
  toggleSource: 'signal:toggle-source',
  openExternal: 'signal:open-external',
  menu: 'signal:menu',
} as const;

export type MenuCommand = 'poll';

/** What preload exposes on window.signal. */
export interface SignalBridge {
  /** The window has no native title bar, so layout has to know the platform. */
  readonly platform: 'darwin' | 'win32' | 'linux';
  status(): Promise<SystemStatus>;
  opportunities(limit?: number): Promise<OpportunityView[]>;
  ingestNow(): Promise<IngestSummary>;
  toggleSource(sourceId: string, enabled: boolean): Promise<void>;
  openExternal(url: string): Promise<void>;
  /** Returns an unsubscribe function. */
  onMenuCommand(handler: (command: MenuCommand) => void): () => void;
}

declare global {
  interface Window {
    readonly signal: SignalBridge;
  }
}
