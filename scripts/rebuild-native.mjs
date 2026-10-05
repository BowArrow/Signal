/**
 * better-sqlite3 is a native module, and Electron and Node ship different
 * ABIs. Building it for one breaks the other, which would mean rebuilding
 * every time you switch between `pnpm dev` and `pnpm test`.
 *
 * So we build it twice and keep both binaries in native/. src/core/db/client.ts
 * picks the right one at runtime from process.versions. Run this once after
 * install, and again after upgrading Node, Electron, or better-sqlite3.
 *
 *   node scripts/rebuild-native.mjs           # both
 *   node scripts/rebuild-native.mjs node      # just the Node ABI
 *   node scripts/rebuild-native.mjs electron  # just the Electron ABI
 *
 * Each step deletes the previous artifact before rebuilding. The rebuild
 * caches are keyed on things that do not change when you merely switch
 * runtimes, so without this an unforced run leaves the other ABI's binary
 * sitting in build/Release for us to copy — which then fails at load time, a
 * long way from here and with a much worse error message.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nativeDir = join(root, 'native');

/** Where better-sqlite3 drops its freshly built binding. */
function builtBindingPath() {
  const pkgMain = require.resolve('better-sqlite3');
  return resolve(dirname(pkgMain), '..', 'build', 'Release', 'better_sqlite3.node');
}

function electronVersion() {
  const distVersion = join(root, 'node_modules', 'electron', 'dist', 'version');
  if (existsSync(distVersion)) return readFileSync(distVersion, 'utf8').trim();
  const pkg = JSON.parse(readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8'));
  return pkg.version;
}

function run(cmd, args) {
  console.log(`  $ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', windowsHide: true, shell: process.platform === 'win32' });
}

function sha(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
}

/** Remove the previous artifact so a cached no-op rebuild cannot fool us. */
function clearPreviousBuild() {
  rmSync(builtBindingPath(), { force: true });
}

function stash(label) {
  const src = builtBindingPath();
  if (!existsSync(src)) {
    throw new Error(`expected a built binding at ${src} but it is not there`);
  }
  mkdirSync(nativeDir, { recursive: true });
  const dest = join(nativeDir, `better_sqlite3-${label}.node`);
  copyFileSync(src, dest);
  console.log(`  → native/better_sqlite3-${label}.node  ${sha(dest)}`);
  return dest;
}

const target = process.argv[2] ?? 'both';
const stashed = {};

if (target === 'node' || target === 'both') {
  console.log(`Building better-sqlite3 for Node ${process.versions.node} (ABI ${process.versions.modules})`);
  clearPreviousBuild();
  run('pnpm', ['rebuild', 'better-sqlite3']);
  stashed.node = stash('node');

  // The Node build is the one this process can actually load, so prove it.
  const Database = require('better-sqlite3');
  const probe = new Database(':memory:', { nativeBinding: stashed.node });
  probe.exec('create table t(a)');
  probe.close();
  console.log('  ✓ loads under Node');
}

if (target === 'electron' || target === 'both') {
  const version = electronVersion();
  console.log(`Building better-sqlite3 for Electron ${version}`);
  clearPreviousBuild();
  run('pnpm', [
    'exec',
    'electron-rebuild',
    '--force',
    '--version',
    version,
    '--only',
    'better-sqlite3',
  ]);
  stashed.electron = stash('electron');
}

if (stashed.node && stashed.electron && sha(stashed.node) === sha(stashed.electron)) {
  // Identical bytes mean one of the two rebuilds silently did nothing, and we
  // just copied the same ABI twice. Electron would fail to load at startup
  // with a NODE_MODULE_VERSION mismatch — catch it here instead.
  throw new Error(
    'The Node and Electron bindings are byte-identical, so one rebuild did not run.\n' +
      'Delete node_modules/.pnpm/better-sqlite3*/node_modules/better-sqlite3/build and try again.',
  );
}

console.log('\nBoth ABIs are in native/. client.ts selects between them at runtime.');
