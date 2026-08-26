import type { Community, SourceKindValue } from '../db/schema.js';

/**
 * How an approved reply actually reaches a community.
 *
 * Two implementations, and the difference is not a detail: `api` posts on your
 * behalf, `manual` hands you the text and records that you pasted it. Hacker
 * News is permanently manual by policy. Reddit is manual for a different
 * reason — its API is gated behind a discretionary approval we do not have,
 * and there is no scrape path for writing, nor should there be.
 */

export interface PublishRequest {
  readonly platform: SourceKindValue;
  readonly community: Community | null;
  /** The exact text to post, tracked link already substituted. */
  readonly body: string;
  /** Where the reply goes. A thread url for a comment. */
  readonly targetUrl: string;
  /** Platform id of the thing being replied to, where the API needs one. */
  readonly targetExternalId: string;
}

export interface PublishOutcome {
  readonly method: 'api' | 'manual';
  /** Null for a manual publish — you know where you pasted it, Signal does not. */
  readonly externalPostId: string | null;
  readonly externalUrl: string | null;
  /** Shown after approving, so it is obvious what did or did not happen. */
  readonly note: string;
}

export interface Publisher {
  readonly platform: SourceKindValue | 'any';
  available(): { ready: boolean; reason?: string };
  publish(request: PublishRequest): Promise<PublishOutcome>;
}

/**
 * The path that always works: Signal puts the text on your clipboard and
 * records that you posted it.
 *
 * Not a degraded mode. Every guardrail still applied — validators, rules,
 * limits, the tracked link — and the publication row is real, so attribution
 * and the ratio keep working exactly as they would for an API post. The only
 * difference is whose hand hits submit.
 */
export class ManualPublisher implements Publisher {
  readonly platform = 'any' as const;

  constructor(private readonly copyToClipboard?: (text: string) => void) {}

  available(): { ready: boolean } {
    return { ready: true };
  }

  publish(request: PublishRequest): Promise<PublishOutcome> {
    this.copyToClipboard?.(request.body);
    return Promise.resolve({
      method: 'manual',
      externalPostId: null,
      externalUrl: request.targetUrl,
      note: 'copied to your clipboard — paste it, then mark it posted',
    });
  }
}

/**
 * Reddit's API, for when access exists.
 *
 * Reports itself unavailable rather than being absent, so the queue can say
 * why you are pasting by hand instead of leaving it a mystery. Wiring the
 * actual POST is a small job the day credentials arrive; deliberately not
 * written speculatively against an API I cannot test.
 */
export class RedditApiPublisher implements Publisher {
  readonly platform = 'reddit' as const;

  constructor(private readonly hasCredentials: boolean) {}

  available(): { ready: boolean; reason?: string } {
    if (!this.hasCredentials) {
      return {
        ready: false,
        reason:
          'Reddit gated its Data API behind a discretionary approval. Reading falls back to ' +
          'public HTML, but there is no scrape path for posting and there should not be — ' +
          'so replies here are copy-and-paste until API access lands.',
      };
    }
    return {
      ready: false,
      reason: 'credentials are present but the publish call is not implemented yet',
    };
  }

  publish(): Promise<PublishOutcome> {
    return Promise.reject(
      new Error('reddit api publishing is not available — approve copies to the clipboard instead'),
    );
  }
}

/**
 * Hacker News, permanently manual.
 *
 * Not a limitation to be lifted later. Signal surfaces the thread and writes
 * the comment; a person pastes it. Stated as its own class so the intent
 * survives someone later wondering why there is no HN API client.
 */
export class HackerNewsPublisher implements Publisher {
  readonly platform = 'hn' as const;

  available(): { ready: boolean; reason: string } {
    return {
      ready: false,
      reason: 'Hacker News is draft-only by policy. There is no publish path and there will not be one.',
    };
  }

  publish(): Promise<PublishOutcome> {
    return Promise.reject(new Error('hacker news is draft-only by policy'));
  }
}

/**
 * Picks the publisher for a platform, falling back to manual.
 *
 * Manual is the floor rather than an error state: everything can be published
 * by hand, so approving always does something useful.
 */
export function selectPublisher(
  platform: SourceKindValue,
  publishers: readonly Publisher[],
  manual: Publisher,
): { publisher: Publisher; fellBack: string | null } {
  const specific = publishers.find((p) => p.platform === platform);
  if (!specific) return { publisher: manual, fellBack: null };

  const readiness = specific.available();
  if (readiness.ready) return { publisher: specific, fellBack: null };

  return { publisher: manual, fellBack: readiness.reason ?? 'unavailable' };
}
