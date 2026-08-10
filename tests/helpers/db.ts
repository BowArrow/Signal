import { openDatabase, type DbHandle } from '../../src/core/db/client.js';
import { runMigrations } from '../../src/core/db/migrate.js';
import { newId } from '../../src/core/lib/id.js';
import {
  communities,
  communityRules,
  drafts,
  opportunities,
  products,
  publications,
  sources,
  type Community,
  type CommunityRule,
  type Opportunity,
  type Product,
  type Source,
} from '../../src/core/db/schema.js';

/** A migrated in-memory database. Fast enough to build one per test. */
export function testDb(): DbHandle {
  const handle = openDatabase(':memory:');
  runMigrations(handle.db);
  return handle;
}

export function insertSource(
  handle: DbHandle,
  overrides: Partial<Source> = {},
): Source {
  const row = {
    id: newId(),
    kind: 'reddit' as const,
    identifier: 'LocalLLaMA',
    displayName: 'r/LocalLLaMA',
    pollIntervalSeconds: 900,
    enabled: true,
    lastPolledAt: null,
    lastPollError: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
  handle.db.insert(sources).values(row).run();
  return row as Source;
}

export function insertCommunity(
  handle: DbHandle,
  overrides: Partial<Community> = {},
): Community {
  const row = {
    id: newId(),
    platform: 'reddit' as const,
    name: 'localllama',
    displayName: 'r/LocalLLaMA',
    url: 'https://www.reddit.com/r/LocalLLaMA/',
    description: null,
    subscribers: null,
    monitored: true,
    firstSeenAt: 1_000,
    blockedAt: null,
    blockedReason: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
  handle.db.insert(communities).values(row).run();
  return row as Community;
}

export function insertRule(
  handle: DbHandle,
  communityId: string,
  overrides: Partial<CommunityRule> = {},
): CommunityRule {
  const row = {
    id: newId(),
    communityId,
    rawRules: [{ shortName: 'No spam', description: 'Contribute before promoting.' }],
    rawSidebar: null,
    sourceUrl: 'https://www.reddit.com/r/LocalLLaMA/about/rules',
    fetchedAt: 1_000,
    selfPromo: 'allowed_with_disclosure' as const,
    selfPromoRatioMaxPct: null,
    flairRequired: false,
    flairValue: null,
    minAccountAgeDays: null,
    minKarma: null,
    notes: null,
    evidence: ['Contribute before promoting.'],
    interpretedBy: 'test',
    confidence: 0.9,
    verified: true,
    lastReviewedAt: 1_000,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
  handle.db.insert(communityRules).values(row).run();
  return row as CommunityRule;
}

export function insertOpportunity(
  handle: DbHandle,
  sourceId: string,
  overrides: Partial<Opportunity> = {},
): Opportunity {
  const row = {
    id: newId(),
    sourceId,
    communityId: null,
    externalId: `t3_${newId().slice(0, 6)}`,
    url: 'https://www.reddit.com/r/LocalLLaMA/comments/abc/',
    author: 'someone',
    title: 'VRAM sizing: what fits on 16GB?',
    body: 'what is the actual arithmetic here?',
    postedAt: 1_000,
    discoveredAt: 1_000,
    commentCount: 4,
    platformScore: 10,
    scoreContribution: null,
    scoreIntent: null,
    scoreFit: null,
    scoreRisk: null,
    scoreTotal: null,
    scoreWeightsHash: null,
    scoredAt: null,
    matchedProductId: null,
    scoreRationale: null,
    status: 'new' as const,
    statusReason: null,
    raw: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
  handle.db.insert(opportunities).values(row).run();
  return row as Opportunity;
}

/**
 * Builds the whole opportunity → draft → publication chain, because the
 * foreign keys are real and a publication with a made-up draft id is not a
 * state the database will ever be in.
 */
export function insertPublication(
  handle: DbHandle,
  args: {
    sourceId: string;
    communityId: string;
    publishedAt: number;
    promotional: boolean;
  },
): void {
  const opportunity = insertOpportunity(handle, args.sourceId, {
    communityId: args.communityId,
    status: 'published',
  });

  const draftId = newId();
  handle.db
    .insert(drafts)
    .values({
      id: draftId,
      opportunityId: opportunity.id,
      productId: null,
      promptVersion: 'reply.v1',
      generatedBody: 'body',
      humanEditedBody: null,
      disclosurePresent: args.promotional,
      productMentioned: args.promotional,
      validatorResults: [],
      blocked: false,
      status: 'published',
      createdAt: args.publishedAt,
      updatedAt: args.publishedAt,
    })
    .run();

  handle.db
    .insert(publications)
    .values({
      id: newId(),
      draftId,
      sourceId: args.sourceId,
      communityId: args.communityId,
      platform: 'reddit',
      method: 'api',
      externalPostId: null,
      externalUrl: null,
      publishedAt: args.publishedAt,
      linkId: null,
      postedBody: 'body',
      promotional: args.promotional,
      createdAt: args.publishedAt,
    })
    .run();
}

export function insertProduct(handle: DbHandle, overrides: Partial<Product> = {}): Product {
  const row = {
    id: newId(),
    key: 'lemonade',
    name: 'Lemonade',
    positioning: 'Privacy-first local AI desktop assistant.',
    targetBuyer: 'People who already run local models.',
    priceCents: 4900,
    currency: 'USD',
    proofPoints: ['zero telemetry'],
    links: {},
    utmBase: 'https://example.test/lemonade',
    enabled: true,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
  handle.db.insert(products).values(row).run();
  return row as Product;
}
