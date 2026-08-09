import { openDatabase, type DbHandle } from '../../src/core/db/client.js';
import { runMigrations } from '../../src/core/db/migrate.js';
import { newId } from '../../src/core/lib/id.js';
import { products, sources, type Source, type Product } from '../../src/core/db/schema.js';

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
