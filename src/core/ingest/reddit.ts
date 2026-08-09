import type { HttpClient } from '../lib/http.js';
import type { Logger } from '../lib/logger.js';
import type { Source } from '../db/schema.js';
import { normalizeRedditPost, type RedditListingChild } from './normalize.js';
import type { Poller, PollResult } from './types.js';

/**
 * Reddit ingestion through the official OAuth API.
 *
 * Notes I have NOT verified against Reddit's current terms and you should
 * confirm before switching this on:
 *   - This uses a "script" type app and the password grant, which is what
 *     Reddit documents for a single-user personal script.
 *   - Reddit publishes a rate limit in X-Ratelimit-* response headers; this
 *     client reads them and backs off, rather than assuming a fixed number.
 *   - Reddit's Data API terms distinguish personal and commercial use. Signal
 *     is a personal tool posting as you, but you should read the current terms
 *     yourself rather than take my word for it.
 * Nothing here posts anything. Publishing arrives in Phase 3 and only ever
 * runs behind an explicit approve action.
 */

const OAUTH_HOST = 'https://oauth.reddit.com';
const AUTH_URL = 'https://www.reddit.com/api/v1/access_token';

export interface RedditCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly username?: string | undefined;
  readonly password?: string | undefined;
}

interface TokenResponse {
  readonly access_token: string;
  readonly expires_in: number;
  readonly scope?: string;
}

interface Listing {
  readonly data?: { readonly children?: RedditListingChild[]; readonly after?: string | null };
}

export class RedditClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly http: HttpClient,
    private readonly credentials: RedditCredentials,
    private readonly logger: Logger,
  ) {}

  /**
   * Application-only auth for reading, password grant when we have a user.
   * Reading does not need a user context, so ingestion works with just the
   * app credentials — publishing is what needs the account.
   */
  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 60_000) return this.token.value;

    const basic = Buffer.from(
      `${this.credentials.clientId}:${this.credentials.clientSecret}`,
    ).toString('base64');

    const body = new URLSearchParams(
      this.credentials.username && this.credentials.password
        ? {
            grant_type: 'password',
            username: this.credentials.username,
            password: this.credentials.password,
          }
        : { grant_type: 'client_credentials' },
    );

    const res = await this.http.json<TokenResponse>(AUTH_URL, {
      method: 'POST',
      official: true,
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    this.token = {
      value: res.access_token,
      expiresAt: now + res.expires_in * 1000,
    };
    this.logger.debug('reddit token acquired', { expiresIn: res.expires_in, scope: res.scope });
    return this.token.value;
  }

  async listing(path: string, params: Record<string, string> = {}): Promise<Listing> {
    const token = await this.accessToken();
    const url = new URL(path, OAUTH_HOST);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    // Reddit's "raw_json=1" turns off the HTML entity escaping that would
    // otherwise put &amp;#39; in every apostrophe.
    url.searchParams.set('raw_json', '1');

    return this.http.json<Listing>(url.toString(), {
      official: true,
      headers: { authorization: `Bearer ${token}` },
    });
  }
}

export class RedditPoller implements Poller {
  readonly kind = 'reddit' as const;

  constructor(
    private readonly client: RedditClient | null,
    private readonly logger: Logger,
    private readonly options: { limit?: number } = {},
  ) {}

  available(): { ready: boolean; reason?: string } {
    if (this.client) return { ready: true };
    return {
      ready: false,
      reason: 'REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are not set — register a script app at reddit.com/prefs/apps',
    };
  }

  async poll(source: Source): Promise<PollResult> {
    if (!this.client) throw new Error('reddit poller invoked without credentials');

    const limit = String(this.options.limit ?? 50);
    const listing = await this.client.listing(`/r/${source.identifier}/new`, { limit });
    const children = listing.data?.children ?? [];

    const items: PollResult['items'] = [];
    const skipped: PollResult['skipped'] = [];

    for (const child of children) {
      // t3 is a link/self post. Anything else in a /new listing is unexpected.
      if (child.kind !== 't3') {
        skipped.push({ externalId: child.data?.name ?? '?', reason: `unexpected kind ${child.kind}` });
        continue;
      }
      const normalized = normalizeRedditPost(child);
      if ('skip' in normalized) {
        skipped.push({ externalId: child.data?.name ?? '?', reason: normalized.skip });
        continue;
      }
      items.push(normalized);
    }

    this.logger.debug('reddit poll complete', {
      subreddit: source.identifier,
      fetched: children.length,
      kept: items.length,
      skipped: skipped.length,
    });

    return { items, skipped };
  }
}
