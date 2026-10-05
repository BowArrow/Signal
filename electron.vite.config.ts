import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseConnectionApps } from './src/core/connections/app-config.js';
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
      copy('./build/icon.png', './out/main/brand/icon.png');
      copy('./build/tray.png', './out/main/brand/tray.png');
      copy('./src/core/video/blockout.py', './out/main/video/blockout.py');
      copy('./src/core/video/limited_runtime.py', './out/main/video/limited_runtime.py');
      copy('./src/core/video/ltx_runtime.py', './out/main/video/ltx_runtime.py');
      copy('./src/core/video/ltx_upscaler.py', './out/main/video/ltx_upscaler.py');
      copy('./src/core/video/narrate.py', './out/main/video/narrate.py');
      copy('./docs/marketing-research/Signal-Growth-Research.pdf', './out/main/marketing-report.pdf');
      const appsPath = fileURLToPath(new URL('./config/connection-apps.json', import.meta.url));
      let apps = {};
      if (existsSync(appsPath)) {
        try { apps = parseConnectionApps(JSON.parse(readFileSync(appsPath, 'utf8'))); }
        catch { throw new Error('Invalid config/connection-apps.json. Only native/public registrations can be bundled.'); }
      }
      mkdirSync(fileURLToPath(new URL('./out/main', import.meta.url)), { recursive: true });
      // Always overwrite, including an empty configuration, to prevent stale clients.
      writeFileSync(fileURLToPath(new URL('./out/main/connection-apps.json', import.meta.url)), JSON.stringify(apps));
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
