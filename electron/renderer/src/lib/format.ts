export function relativeTime(ms: number | null | undefined, now = Date.now()): string {
  if (ms == null) return '—';
  const minutes = Math.round(Math.max(0, now - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function interval(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}

export function money(cents: number, currency = 'USD'): string {
  if (!cents) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** Maps an opportunity or source status to a Nocturne-derived class. */
export function statusClass(status: string): string {
  switch (status) {
    case 'queued':
    case 'published':
    case 'approved':
    case 'ok':
      return 'ok';
    case 'rules_unknown':
    case 'error':
      return 'block';
    case 'rejected':
    case 'skipped':
      return 'warn';
    default:
      return 'muted';
  }
}
