import type { RedditClient } from '../ingest/reddit.js';
import type { Community, RawRule } from '../db/schema.js';
import { cleanText } from '../ingest/normalize.js';

/**
 * Pulls a community's rules as the community wrote them.
 *
 * Nothing here interprets anything. The job is to get moderator-authored text
 * out of the platform and into the database unaltered, so that every
 * structured claim Signal later makes about a community can be traced back to
 * a sentence somebody actually wrote. Interpretation happens in interpret.ts,
 * separately, and is allowed to be wrong. This is not.
 */

export interface FetchedRules {
  readonly rules: RawRule[];
  /** Sidebar / public description, which often carries the real policy. */
  readonly sidebar: string | null;
  readonly sourceUrl: string;
  readonly subscribers: number | null;
  readonly description: string | null;
  /** True when the platform published no rules at all, vs a failed fetch. */
  readonly empty: boolean;
}

export interface RulesFetcher {
  readonly platform: Community['platform'];
  fetch(community: Community): Promise<FetchedRules>;
  available(): { ready: boolean; reason?: string };
}

interface RedditRulesResponse {
  readonly rules?: {
    readonly short_name?: string;
    readonly description?: string;
    readonly kind?: string;
    readonly violation_reason?: string;
  }[];
}

interface RedditAboutResponse {
  readonly data?: {
    readonly public_description?: string;
    readonly description?: string;
    readonly subscribers?: number;
    readonly title?: string;
    readonly over18?: boolean;
    readonly subreddit_type?: string;
  };
}

export class RedditRulesFetcher implements RulesFetcher {
  readonly platform = 'reddit' as const;

  constructor(private readonly client: RedditClient | null) {}

  available(): { ready: boolean; reason?: string } {
    if (this.client) return { ready: true };
    return {
      ready: false,
      reason: 'REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are not set — rules cannot be fetched',
    };
  }

  async fetch(community: Community): Promise<FetchedRules> {
    if (!this.client) throw new Error('reddit rules fetcher invoked without credentials');
    const sub = community.name;

    // Both are documented read endpoints on the official API.
    const [rulesRes, aboutRes] = await Promise.all([
      this.client.get<RedditRulesResponse>(`/r/${sub}/about/rules`),
      this.client.get<RedditAboutResponse>(`/r/${sub}/about`),
    ]);

    const rules: RawRule[] = (rulesRes.rules ?? [])
      .map((r) => ({
        shortName: (r.short_name ?? r.violation_reason ?? '').trim(),
        // Rule bodies are markdown with entities. Flatten but do not summarize.
        description: cleanText(r.description ?? '', 4000).text,
        ...(r.kind ? { kind: r.kind } : {}),
      }))
      .filter((r) => r.shortName || r.description);

    const about = aboutRes.data;
    const sidebar = cleanText(about?.public_description ?? about?.description ?? '', 8000).text;

    return {
      rules,
      sidebar: sidebar || null,
      sourceUrl: `https://www.reddit.com/r/${sub}/about/rules`,
      subscribers: typeof about?.subscribers === 'number' ? about.subscribers : null,
      description: about?.public_description?.trim() || null,
      empty: rules.length === 0 && !sidebar,
    };
  }
}

/**
 * Hacker News has no rules API, and Signal's policy there does not depend on
 * one: HN is draft-only, permanently, by our own decision. This fetcher
 * records that as policy rather than pretending to have scraped it.
 */
export class HackerNewsRulesFetcher implements RulesFetcher {
  readonly platform = 'hn' as const;

  available(): { ready: boolean } {
    return { ready: true };
  }

  fetch(): Promise<FetchedRules> {
    return Promise.resolve({
      rules: [
        {
          shortName: 'Signal policy: draft only',
          description:
            'Signal never posts to Hacker News through an API. It surfaces the thread and ' +
            'writes the comment; a human pastes it. This is our own constraint, not a rule ' +
            'HN published, and it is not derived from any fetched text.',
        },
      ],
      sidebar: null,
      sourceUrl: 'https://news.ycombinator.com/newsguidelines.html',
      subscribers: null,
      description: null,
      empty: false,
    });
  }
}
