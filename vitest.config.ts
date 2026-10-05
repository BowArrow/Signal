import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Keep validation bounded on the desktop shared with local agents and apps.
    maxWorkers: 2,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // These four are where a silent bug either costs money or gets the
      // account banned, so they carry a hard floor rather than a global one.
      thresholds: {
        'src/core/scoring/**': { statements: 90, branches: 85, functions: 90, lines: 90 },
        'src/core/guardrails/**': { statements: 90, branches: 85, functions: 90, lines: 90 },
        'src/core/publish/rate-limit.ts': { statements: 90, branches: 85, functions: 90, lines: 90 },
        'src/core/attribution/**': { statements: 90, branches: 85, functions: 90, lines: 90 },
      },
      include: ['src/core/**/*.ts'],
      exclude: ['src/core/**/*.d.ts', 'src/core/db/migrations/**'],
    },
  },
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
});
