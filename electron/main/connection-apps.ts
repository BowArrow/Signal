import { existsSync, readFileSync, statSync } from 'node:fs';
import { parseConnectionApps, type ConnectionApps } from '../../src/core/connections/app-config.js';

export function readConnectionApps(path: string): ConnectionApps {
  if (!existsSync(path)) return {};
  try {
    if (statSync(path).size > 32768) throw new Error('Too large');
    return parseConnectionApps(JSON.parse(readFileSync(path, 'utf8')));
  } catch { throw new Error('Signal connection configuration is invalid. Restore connection-apps.json with native/public app registrations.'); }
}
