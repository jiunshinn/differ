import type { GithubCheckRun } from '@shared/types';

export type CheckTone = 'success' | 'danger' | 'warn' | 'neutral';

/** Map a single check run to a UI tone. Single source of truth for the
 *  success/failure/in-progress classification duplicated across check views. */
export function checkRunTone(check: Pick<GithubCheckRun, 'status' | 'conclusion'>): CheckTone {
  if (check.conclusion === 'success') return 'success';
  if (
    check.conclusion === 'failure' ||
    check.conclusion === 'timed_out' ||
    check.conclusion === 'action_required'
  ) {
    return 'danger';
  }
  if (check.status !== 'completed') return 'warn';
  return 'neutral';
}

/** Human label for a check run: its in-progress status, or its conclusion. */
export function checkRunLabel(check: Pick<GithubCheckRun, 'status' | 'conclusion'>): string {
  return check.status !== 'completed' ? check.status.replace('_', ' ') : check.conclusion ?? 'completed';
}

/** Aggregate pass/fail/pending counts over a list of check runs. */
export function summarizeChecks(checks: ReadonlyArray<GithubCheckRun>): {
  passed: number;
  failed: number;
  pending: number;
  total: number;
} {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const c of checks) {
    const tone = checkRunTone(c);
    if (tone === 'success') passed++;
    else if (tone === 'danger') failed++;
    else if (tone === 'warn') pending++;
  }
  return { passed, failed, pending, total: checks.length };
}
