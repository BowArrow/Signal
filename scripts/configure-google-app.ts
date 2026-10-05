// Import a Google Desktop client for the next Signal build. Never log credentials.
import { mkdirSync, readFileSync, existsSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConnectionApps, parseGoogleDesktopClient } from '../src/core/connections/app-config.js';

try {
  const input = process.argv[2];
  if (!input) throw new Error('Usage: node --import tsx scripts/configure-google-app.ts <downloaded-desktop-client.json>');
  if (statSync(input).size > 32768) throw new Error('Credential file exceeds 32 KB.');
  let value: unknown;
  try { value = JSON.parse(readFileSync(input, 'utf8')); } catch { throw new Error('Credential file is not valid JSON.'); }
  const client = parseGoogleDesktopClient(value);
  const destination = resolve(dirname(fileURLToPath(import.meta.url)), '../config/connection-apps.json');
  let previous = {};
  if (existsSync(destination)) {
    try { previous = parseConnectionApps(JSON.parse(readFileSync(destination, 'utf8'))); }
    catch { throw new Error('Existing connection configuration is invalid; it was not replaced.'); }
  }
  const next = parseConnectionApps({ ...previous, google: { clientId: client.clientId, clientSecret: client.clientSecret } });
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(`${destination}.tmp`, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  renameSync(`${destination}.tmp`, destination);
  console.log('Signal Google Desktop registration saved for the next build. No account tokens were imported.');
} catch (error) {
  // Filesystem errors contain paths only; parser errors are deliberately generic.
  console.error(error instanceof Error ? error.message : 'Google configuration failed.'); process.exitCode = 1;
}
