import type { Source } from '../db/schema.js';

/**
 * What every poller produces, whatever platform it came from. Anything
 * downstream — scoring, drafting, the queue — only ever sees this shape.
 */
export interface NormalizedItem {
  /** Platform's own id. Unique within a source, and the dedup key. */
  readonly externalId: string;
  readonly url: string;
  readonly author: string | null;
  readonly title: string;
  readonly body: string;
  /** When it was posted on the platform, epoch ms. Null if unknowable. */
  readonly postedAt: number | null;
  readonly commentCount: number | null;
  /** Reddit upvotes, HN points. Null where the platform has no such thing. */
  readonly platformScore: number | null;
  /** Set when the body was cut to the length cap. */
  readonly truncated: boolean;
  /** The untouched payload, so a normalization bug is fixable in place. */
  readonly raw: unknown;
}

export interface PollResult {
  readonly items: NormalizedItem[];
  /** Items the poller dropped before normalizing, and why. */
  readonly skipped: { readonly externalId: string; readonly reason: string }[];
}

export interface Poller {
  readonly kind: Source['kind'];
  /** Throws on a hard failure; the caller records it on the source row. */
  poll(source: Source): Promise<PollResult>;
  /**
   * False when the poller lacks credentials. The runner skips it and says so,
   * rather than failing the whole ingest cycle.
   */
  available(): { ready: boolean; reason?: string };
}
