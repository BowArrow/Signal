export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

function format(level: LogLevel, msg: string, fields: Record<string, unknown>): string {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
  const stamp = new Date().toISOString().slice(11, 23);
  return `${stamp} ${level.toUpperCase().padEnd(5)} ${msg}${parts.length ? '  ' + parts.join(' ') : ''}`;
}

export function createLogger(level: LogLevel = 'info', bindings: Record<string, unknown> = {}): Logger {
  const threshold = RANK[level];

  const emit = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (RANK[lvl] < threshold) return;
    const line = format(lvl, msg, { ...bindings, ...fields });
    if (lvl === 'error' || lvl === 'warn') console.error(line);
    else console.log(line);
  };

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (extra) => createLogger(level, { ...bindings, ...extra }),
  };
}

/** Swallows everything. Tests use this so output stays readable. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};
