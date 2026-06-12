// Centralized date parsing/formatting.
//
// SQLite columns default to `datetime('now')`, which yields a UTC wall-clock
// string like "2026-06-11 05:12:33" with NO timezone designator. V8 parses that
// non-ISO form as *local* time, so timestamps render shifted by the user's UTC
// offset. parseDbDate normalizes those to real UTC. GitHub API timestamps are
// already ISO-8601 with a zone, so they pass through untouched.

const SQLITE_UTC = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;

/** Parse a timestamp that may be a SQLite UTC string or an ISO-8601 string. */
export function parseDbDate(value: string): Date {
  if (SQLITE_UTC.test(value)) {
    // Treat the space-separated, zone-less SQLite value as UTC.
    return new Date(value.replace(' ', 'T') + 'Z');
  }
  return new Date(value);
}

/** Locale date+time (medium date, short time). Safe for DB or ISO inputs. */
export function formatDateTime(value: string): string {
  const date = parseDbDate(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/** Locale date only. */
export function formatDate(value: string): string {
  if (!value) return '—';
  const date = parseDbDate(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

/** Locale time only (HH:MM). */
export function formatTime(value: string): string {
  const date = parseDbDate(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Compact relative age: "just now", "5m", "3h", "2d", "4mo", "1y". */
export function formatRelativeTime(value: string): string {
  const t = parseDbDate(value).getTime();
  if (Number.isNaN(t)) return value;
  const diff = Date.now() - t;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.round(mo / 12)}y`;
}
