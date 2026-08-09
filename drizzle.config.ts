import { defineConfig } from 'drizzle-kit';
import config from './signal.config.js';
import { resolveDatabasePath } from './src/core/db/client.js';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/core/db/schema.ts',
  out: './src/core/db/migrations',
  dbCredentials: {
    url: resolveDatabasePath(config.databaseUrl),
  },
  strict: true,
  verbose: true,
});
