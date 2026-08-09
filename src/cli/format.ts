/**
 * Terminal formatting. Colors switch off when stdout is not a TTY or NO_COLOR
 * is set, so piping to a file gives you clean text.
 */
const enabled = process.stdout.isTTY === true && !process.env['NO_COLOR'];

const wrap = (code: number) => (s: string) => (enabled ? `[${code}m${s}[0m` : s);

export const dim = wrap(2);
export const bold = wrap(1);
export const red = wrap(31);
export const green = wrap(32);
export const yellow = wrap(33);
export const blue = wrap(34);
export const magenta = wrap(35);
export const cyan = wrap(36);

/** Visible width, ignoring the escape sequences. */
function width(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '').length;
}

function pad(s: string, to: number, align: 'left' | 'right'): string {
  const gap = Math.max(0, to - width(s));
  return align === 'right' ? ' '.repeat(gap) + s : s + ' '.repeat(gap);
}

export interface Column<T> {
  readonly header: string;
  readonly align?: 'left' | 'right';
  readonly max?: number;
  value(row: T): string;
}

export function table<T>(rows: readonly T[], columns: readonly Column<T>[]): string {
  if (rows.length === 0) return dim('  (nothing to show)');

  const cells = rows.map((row) =>
    columns.map((c) => {
      const raw = c.value(row);
      if (c.max && width(raw) > c.max) return `${raw.slice(0, Math.max(1, c.max - 1))}…`;
      return raw;
    }),
  );

  const widths = columns.map((c, i) =>
    Math.max(width(c.header), ...cells.map((r) => width(r[i] ?? ''))),
  );

  const line = (values: string[], colorize: (s: string) => string = (s) => s): string =>
    '  ' +
    values
      .map((v, i) => colorize(pad(v, widths[i] ?? 0, columns[i]?.align ?? 'left')))
      .join('  ');

  const head = line(
    columns.map((c) => c.header.toUpperCase()),
    dim,
  );
  const rule = '  ' + widths.map((w) => dim('─'.repeat(w))).join('  ');
  return [head, rule, ...cells.map((r) => line(r))].join('\n');
}

export function relativeTime(ms: number | null, now = Date.now()): string {
  if (ms == null) return '—';
  const delta = Math.max(0, now - ms);
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function heading(text: string): string {
  return `\n${bold(text)}\n`;
}
