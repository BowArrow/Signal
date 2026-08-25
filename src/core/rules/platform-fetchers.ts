import type { HttpClient } from '../lib/http.js';
import type { Community, RawRule } from '../db/schema.js';
import { cleanText } from '../ingest/normalize.js';
import type { FetchedRules, RulesFetcher } from './fetch.js';

/**
 * Rules fetchers for the four sources added after Reddit's API turned out to
 * be gated.
 *
 * Same contract as the Reddit ones: get the platform's own words, store them
 * verbatim, let the interpreter read them separately. Where a platform does
 * not publish anything readable, say so plainly rather than inventing a
 * policy — an empty result routes to the cautious default, which is the right
 * answer when we genuinely do not know.
 */

/** Trim page furniture before flattening, so evidence quotes come from prose. */
function pageText(html: string, maxChars = 9000): string {
  const stripped = html
    .replace(/<\s*(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '')
    .replace(/<\s*(nav|header|footer|aside)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '');
  return cleanText(stripped, maxChars).text;
}

// ────────────────────────────────────────────────── stack exchange ──

/**
 * Sites that predate the stackexchange.com convention keep their own domain.
 * Everything else follows `<site>.stackexchange.com`.
 */
const SE_HOSTS: Record<string, string> = {
  stackoverflow: 'stackoverflow.com',
  superuser: 'superuser.com',
  serverfault: 'serverfault.com',
  askubuntu: 'askubuntu.com',
  mathoverflow: 'mathoverflow.net',
};

export function stackExchangeHost(site: string): string {
  return SE_HOSTS[site] ?? `${site}.stackexchange.com`;
}

/**
 * Stack Exchange publishes its promotion policy per site at /help/promotion,
 * which is the page that actually governs whether naming your own product is
 * acceptable. It is close to network-wide in practice, but it is fetched per
 * site rather than assumed, because a site can and does add its own rules.
 */
export class StackExchangeRulesFetcher implements RulesFetcher {
  readonly platform = 'stackexchange' as const;

  constructor(private readonly http: HttpClient) {}

  available(): { ready: boolean } {
    return { ready: true };
  }

  async fetch(community: Community): Promise<FetchedRules> {
    const host = stackExchangeHost(community.name);
    const rules: RawRule[] = [];

    for (const [shortName, path] of [
      ['Promotion', '/help/promotion'],
      ['Expected behaviour', '/help/behavior'],
    ] as const) {
      try {
        const html = await this.http.text(`https://${host}${path}`, { official: true });
        const description = pageText(html);
        if (description) rules.push({ shortName, description, kind: 'all' });
      } catch {
        // One missing help page is not a failed fetch; the other still counts.
      }
    }

    return {
      rules,
      sidebar: null,
      sourceUrl: `https://${host}/help/promotion`,
      subscribers: null,
      description: null,
      empty: rules.length === 0,
    };
  }
}

// ────────────────────────────────────────────────────────── discourse ──

interface DiscourseAbout {
  readonly about?: {
    readonly title?: string;
    readonly description?: string;
    readonly extended_site_description?: string;
  };
}

/**
 * Discourse renders /faq and /guidelines client-side, so their text is not
 * reachable without running JavaScript. /about.json is what a forum reliably
 * exposes, and on most instances it is a one-line description rather than a
 * posting policy.
 *
 * When that is all there is, this returns empty rather than dressing a tagline
 * up as a rules record. That sends the community to the cautious default with
 * the reason recorded, and leaves it flagged for a human to fill in.
 */
export class DiscourseRulesFetcher implements RulesFetcher {
  readonly platform = 'discourse' as const;

  constructor(private readonly http: HttpClient) {}

  available(): { ready: boolean } {
    return { ready: true };
  }

  async fetch(community: Community): Promise<FetchedRules> {
    const base = `https://${community.name}`;
    const res = await this.http.json<DiscourseAbout>(`${base}/about.json`, { official: true });

    const description = cleanText(res.about?.description ?? '', 2000).text;
    const extended = cleanText(res.about?.extended_site_description ?? '', 8000).text;
    const sidebar = [description, extended].filter(Boolean).join('\n\n');

    // A tagline is not a posting policy. Anything under a couple of sentences
    // tells the interpreter nothing it could quote as evidence.
    const substantive = extended.length > 200;

    return {
      rules: substantive
        ? [{ shortName: 'Site description', description: extended, kind: 'all' }]
        : [],
      sidebar: sidebar || null,
      sourceUrl: `${base}/guidelines`,
      subscribers: null,
      description: description || null,
      // Deliberate: /faq and /guidelines are client-rendered, so if the site
      // description carries nothing we genuinely cannot read this forum's
      // rules and should not pretend otherwise.
      empty: !substantive,
    };
  }
}

// ───────────────────────────────────────────────────────────── github ──

interface CommunityProfile {
  readonly files?: {
    readonly contributing?: { readonly url?: string } | null;
    readonly code_of_conduct?: { readonly url?: string } | null;
  };
}

interface ContentsResponse {
  readonly content?: string;
  readonly encoding?: string;
  readonly html_url?: string;
}

/**
 * A repository's own CONTRIBUTING.md and CODE_OF_CONDUCT.md.
 *
 * Maintainers differ enormously on whether a third party turning up with a
 * product is welcome, and those two files are where they say so. GitHub's
 * community profile endpoint reports which exist, which avoids guessing at
 * paths that vary between repos.
 */
export class GitHubRulesFetcher implements RulesFetcher {
  readonly platform = 'github' as const;

  constructor(
    private readonly http: HttpClient,
    private readonly token?: string | undefined,
  ) {}

  available(): { ready: boolean } {
    return { ready: true };
  }

  private headers(): Record<string, string> {
    return {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
    };
  }

  private async fileText(url: string): Promise<string> {
    const res = await this.http.json<ContentsResponse>(url, {
      official: true,
      headers: this.headers(),
    });
    if (!res.content) return '';
    const raw =
      res.encoding === 'base64'
        ? Buffer.from(res.content, 'base64').toString('utf8')
        : res.content;
    return cleanText(raw, 9000).text;
  }

  async fetch(community: Community): Promise<FetchedRules> {
    const repo = community.name;
    const profile = await this.http.json<CommunityProfile>(
      `https://api.github.com/repos/${repo}/community/profile`,
      { official: true, headers: this.headers() },
    );

    const rules: RawRule[] = [];
    for (const [shortName, entry] of [
      ['Contributing guidelines', profile.files?.contributing],
      ['Code of conduct', profile.files?.code_of_conduct],
    ] as const) {
      if (!entry?.url) continue;
      try {
        const description = await this.fileText(entry.url);
        if (description) rules.push({ shortName, description, kind: 'all' });
      } catch {
        // A health file listed but unreadable is not worth failing over.
      }
    }

    return {
      rules,
      sidebar: null,
      sourceUrl: `https://github.com/${repo}/blob/HEAD/CONTRIBUTING.md`,
      subscribers: null,
      description: null,
      empty: rules.length === 0,
    };
  }
}

// ─────────────────────────────────────────────────────────── lobsters ──

/**
 * Lobsters states its position on self-promotion on one page, /about, and it
 * is unusually explicit about it.
 */
export class LobstersRulesFetcher implements RulesFetcher {
  readonly platform = 'lobsters' as const;

  constructor(private readonly http: HttpClient) {}

  available(): { ready: boolean } {
    return { ready: true };
  }

  async fetch(): Promise<FetchedRules> {
    const html = await this.http.text('https://lobste.rs/about', { official: true });
    const description = pageText(html);

    return {
      rules: description ? [{ shortName: 'About Lobsters', description, kind: 'all' }] : [],
      sidebar: null,
      sourceUrl: 'https://lobste.rs/about',
      subscribers: null,
      description: null,
      empty: !description,
    };
  }
}
