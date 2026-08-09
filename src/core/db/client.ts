import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  readonly db: Db;
  readonly raw: Database.Database;
  close(): void;
}

/**
 * Turns the configured databaseUrl into a filesystem path.
 * `:memory:` is passed through for tests.
 */
export function resolveDatabasePath(databaseUrl: string): string {
  if (databaseUrl === ':memory:') return ':memory:';
  const withoutScheme = databaseUrl.startsWith('file:') ? databaseUrl.slice(5) : databaseUrl;
  return resolve(withoutScheme);
}

/**
 * Electron and Node ship different native ABIs, so scripts/rebuild-native.mjs
 * builds better-sqlite3 twice and leaves both binaries in native/. Pick the
 * one matching the runtime we are actually inside.
 *
 * Returns undefined when the prebuilt copy is missing, which lets
 * better-sqlite3 fall back to its own resolution — the right behaviour in CI
 * or a fresh clone where only one ABI was ever built.
 */
export function selectNativeBinding(): string | undefined {
  const runtime = process.versions.electron ? 'electron' : 'node';
  const filename = `better_sqlite3-${runtime}.node`;

  // In a packaged app the binding ships via extraResources, outside the asar.
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const packaged = join(resourcesPath, 'native', filename);
    if (existsSync(packaged)) return packaged;
  }

  const here = dirname(fileURLToPath(import.meta.url));
  // Walk up looking for native/, so this works from src/, from out/ in a dev
  // build, and from inside an asar-unpacked app bundle.
  let dir = here;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, 'native', filename);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export function openDatabase(databaseUrl: string): DbHandle {
  const path = resolveDatabasePath(databaseUrl);
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const nativeBinding = selectNativeBinding();
  const raw = nativeBinding ? new Database(path, { nativeBinding }) : new Database(path);

  // WAL so the Electron main process can keep reading while a background job
  // writes. NORMAL sync is the right trade here: a crash can lose the last
  // transaction, and the worst case is re-polling a source.
  raw.pragma('journal_mode = WAL');
  raw.pragma('synchronous = NORMAL');
  raw.pragma('foreign_keys = ON');
  // Without this, two concurrent writers throw SQLITE_BUSY immediately.
  raw.pragma('busy_timeout = 5000');

  const db = drizzle(raw, { schema });
  return {
    db,
    raw,
    close: () => raw.close(),
  };
}

export { schema };
