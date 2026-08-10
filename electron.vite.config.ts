import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const alias = {
  '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
  '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
};

/**
 * Two directories the bundler has no reason to notice, and the app cannot run
 * without either: the Drizzle .sql migrations, and the .md prompt templates.
 * Both are read from disk at runtime — prompts deliberately so, since voice.md
 * is a file Casey edits by hand and Phase 4 appends to.
 */
function copyRuntimeAssets(): Plugin {
  const copy = (from: string, to: string): void => {
    cpSync(
      fileURLToPath(new URL(from, import.meta.url)),
      fileURLToPath(new URL(to, import.meta.url)),
      { recursive: true },
    );
  };

  return {
    name: 'signal:copy-runtime-assets',
    writeBundle() {
      copy('./src/core/db/migrations', './out/main/migrations');
      copy('./src/prompts', './out/main/prompts');
    },
  };
}

export default defineConfig({
  main: {
    // better-sqlite3 is a native module: it has to stay external and be
    // loaded from node_modules at runtime, never bundled.
    plugins: [externalizeDepsPlugin(), copyRuntimeAssets()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: fileURLToPath(new URL('./electron/main/index.ts', import.meta.url)),
        // CJS, despite "type": "module" in package.json. Electron's ESM loader
        // fails to translate the CJS externals (better-sqlite3 above all), and
        // CJS is the well-trodden path for an Electron main process with a
        // native dependency. Rollup shims import.meta.url on the way out, so
        // the source stays ESM and the CLI keeps working unchanged.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: fileURLToPath(new URL('./electron/preload/index.ts', import.meta.url)),
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: fileURLToPath(new URL('./electron/renderer', import.meta.url)),
    plugins: [react()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: fileURLToPath(new URL('./electron/renderer/index.html', import.meta.url)),
      },
    },
  },
});
