import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client.js';

/**
 * Finds the migrations folder from wherever this module ended up: src/ under
 * tsx, out/main/ in a dev build, or inside the packaged app. Bundlers move
 * this file around but the SQL always ships alongside it.
 */
export function migrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, 'migrations'),
    join(here, '..', 'migrations'),
    resolve(here, '..', '..', '..', 'src', 'core', 'db', 'migrations'),
    resolve(here, '..', '..', '..', '..', 'src', 'core', 'db', 'migrations'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Could not find the migrations folder. Looked in:\n${candidates.map((c) => `  ${c}`).join('\n')}`,
  );
}

export function runMigrations(db: Db): void {
  drizzleMigrate(db, { migrationsFolder: migrationsFolder() });
}
