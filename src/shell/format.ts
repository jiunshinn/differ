import type { ThreadStatus } from '@shared/protocol';
import type { AgentStatus } from '../ui';

export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** Show a path relative to the thread's folder when it's inside it. */
export function relPath(p: string, root: string): string {
  const r = root.endsWith('/') ? root : `${root}/`;
  return p.startsWith(r) ? p.slice(r.length) : p;
}

export function statusDot(s: ThreadStatus): AgentStatus {
  switch (s) {
    case 'starting':
    case 'running':
      return 'running';
    case 'waiting':
      return 'waiting';
    case 'failed':
      return 'failed';
    default:
      return 'done';
  }
}

export const statusLabel: Record<ThreadStatus, string> = {
  starting: 'Starting',
  running: 'Working',
  waiting: 'Needs approval',
  idle: 'Idle',
  failed: 'Failed',
};

export type DiffLine = { kind: 'add' | 'del' | 'ctx'; text: string; oldNo: number | null; newNo: number | null };

const MAX_LCS = 1_500_000;

/** Line diff (LCS). Falls back to "all removed, all added" for very large inputs. */
export function lineDiff(oldText: string | null | undefined, newText: string): DiffLine[] {
  const a = oldText ? oldText.replace(/\n$/, '').split('\n') : [];
  const b = newText.replace(/\n$/, '').split('\n');
  const out: DiffLine[] = [];
  if (a.length * b.length > MAX_LCS) {
    a.forEach((t, i) => out.push({ kind: 'del', text: t, oldNo: i + 1, newNo: null }));
    b.forEach((t, i) => out.push({ kind: 'add', text: t, oldNo: null, newNo: i + 1 }));
    return out;
  }
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push({ kind: 'ctx', text: a[i], oldNo: i + 1, newNo: j + 1 });
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      out.push({ kind: 'add', text: b[j], oldNo: null, newNo: j + 1 });
      j++;
    } else {
      out.push({ kind: 'del', text: a[i], oldNo: i + 1, newNo: null });
      i++;
    }
  }
  return out;
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === 'add') added++;
    else if (l.kind === 'del') removed++;
  }
  return { added, removed };
}

/** Collapse long unchanged runs so a diff shows only changed regions plus context. */
export function hunks(lines: DiffLine[], context = 3): (DiffLine | { kind: 'gap'; count: number })[] {
  const keep = new Array(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.kind !== 'ctx') for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const out: (DiffLine | { kind: 'gap'; count: number })[] = [];
  let gap = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (gap) out.push({ kind: 'gap', count: gap });
      gap = 0;
      out.push(l);
    } else gap++;
  });
  if (gap) out.push({ kind: 'gap', count: gap });
  return out;
}
