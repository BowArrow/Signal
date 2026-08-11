import type { HttpClient } from '../lib/http.js';
import type { Logger } from '../lib/logger.js';
import type { Source } from '../db/schema.js';
import { cleanText, MAX_TITLE_CHARS } from './normalize.js';
import type { NormalizedItem, Poller, PollResult } from './types.js';

/**
 * GitHub issues, via the search API.
 *
 * "Can this run offline", "why is this eating all my VRAM" and "how do I point
 * this at a local model" get asked in the issue trackers of ollama, llama.cpp
 * and everything downstream of them. High intent, technical audience, and
 * maintainers generally tolerate a useful answer that names a tool.
 *
 * The identifier is a GitHub search query, e.g.
 *   `repo:ollama/ollama is:issue is:open offline`
 *   `is:issue is:open "local llm" desktop`
 *
 * Each repository is its own community — maintainers have wildly different
 * tolerance for a third party turning up with a product — so rules are tracked
 * per repo rather than per query.
 */

const API = 'https://api.github.com';

interface GitHubIssue {
  readonly number?: number;
  readonly id?: number;
  readonly title?: string;
  readonly body?: string | null;
  readonly html_url?: string;
  readonly repository_url?: string;
  readonly created_at?: string;
  readonly comments?: number;
  readonly reactions?: { readonly total_count?: number };
  readonly state?: string;
  readonly draft?: boolean;
  readonly pull_request?: unknown;
  readonly user?: { readonly login?: string; readonly type?: string };
}

interface SearchResponse {
  readonly items?: GitHubIssue[];
  readonly total_count?: number;
  readonly message?: string;
}

/** `https://api.github.com/repos/ollama/ollama` -> `ollama/ollama`. */
export function repoFromUrl(repositoryUrl: string | undefined): string | null {
  if (!repositoryUrl) return null;
  const match = /\/repos\/([^/]+\/[^/]+)$/.exec(repositoryUrl);
  return match?.[1] ?? null;
}

export function normalizeIssue(issue: GitHubIssue): NormalizedItem | { skip: string } {
  if (issue.number == null) return { skip: 'no issue number' };

  // The search API returns pull requests alongside issues unless filtered, and
  // a PR is somebody's code, not somebody's question.
  if (issue.pull_request != null) return { skip: 'pull request, not an issue' };
  if (issue.state === 'closed') return { skip: 'closed' };
  if (issue.user?.type === 'Bot') return { skip: 'opened by a bot' };

  const title = cleanText(issue.title ?? '', MAX_TITLE_CHARS);
  if (!title.text) return { skip: 'empty title' };

  const body = cleanText(issue.body ?? '');
  const repo = repoFromUrl(issue.repository_url);
  if (!repo) return { skip: 'could not determine the repository' };

  return {
    externalId: String(issue.id ?? `${repo}#${issue.number}`),
    url: issue.html_url ?? `https://github.com/${repo}/issues/${issue.number}`,
    community: { platform: 'github', name: repo, displayName: repo },
    author: issue.user?.login ?? null,
    title: title.text,
    body: body.text,
    postedAt: issue.created_at ? Date.parse(issue.created_at) || null : null,
    commentCount: issue.comments ?? null,
    // Reactions are the closest thing GitHub has to a score.
    platformScore: issue.reactions?.total_count ?? null,
    truncated: body.truncated || title.truncated,
    raw: issue,
  };
}

export class GitHubPoller implements Poller {
  readonly kind = 'github' as const;

  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
    private readonly options: { token?: string | undefined; perPage?: number } = {},
  ) {}

  available(): { ready: boolean; reason?: string } {
    // Search works unauthenticated at 10 requests/minute, which is fine at
    // this cadence. A token raises it to 30 and is worth setting eventually.
    return { ready: true };
  }

  async poll(source: Source): Promise<PollResult> {
    const url = new URL(`${API}/search/issues`);
    url.searchParams.set('q', source.identifier);
    url.searchParams.set('sort', 'created');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('per_page', String(this.options.perPage ?? 30));

    const res = await this.http.json<SearchResponse>(url.toString(), {
      official: true,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
      },
    });

    if (res.message) throw new Error(`github: ${res.message}`);

    const items: NormalizedItem[] = [];
    const skipped: PollResult['skipped'] = [];

    for (const issue of res.items ?? []) {
      const normalized = normalizeIssue(issue);
      if ('skip' in normalized) {
        skipped.push({ externalId: String(issue.id ?? '?'), reason: normalized.skip });
        continue;
      }
      items.push(normalized);
    }

    const repos = new Set(items.map((i) => i.community?.name).filter(Boolean));
    this.logger.debug('github poll complete', {
      query: source.identifier,
      kept: items.length,
      skipped: skipped.length,
      repos: repos.size,
      authenticated: this.options.token != null,
    });

    return { items, skipped };
  }
}
