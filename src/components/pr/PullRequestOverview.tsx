import React from 'react';
import { FileText, GitPullRequest } from 'lucide-react';
import { cn } from '../../utils/cn';
import type { FileDiff, GithubCheckRun, GithubPullRequestDetail } from '@shared/types';

export function ActivityView({
  detail,
  diffs,
  checks,
  loading,
}: {
  detail: GithubPullRequestDetail;
  diffs: FileDiff[];
  checks: GithubCheckRun[];
  loading: boolean;
}) {
  const body = detail.body.trim();
  const passingChecks = checks.filter((check) => check.conclusion === 'success').length;
  const failingChecks = checks.filter(
    (check) =>
      check.conclusion === 'failure' ||
      check.conclusion === 'timed_out' ||
      check.conclusion === 'action_required',
  ).length;

  return (
    <main className="min-h-0 overflow-auto bg-bg px-6 py-5">
      <div className="max-w-[920px] grid gap-5">
        <section>
          <div className="section-label mb-2">Description</div>
          <div className="panel-card p-4 text-sm leading-6 whitespace-pre-wrap">
            {body || <span className="text-text-muted">No PR description.</span>}
          </div>
        </section>

        <section className="grid grid-cols-3 gap-3">
          <Metric label="Files changed" value={detail.changedFiles || diffs.length} tone="neutral" />
          <Metric label="Additions" value={`+${detail.additions}`} tone="success" />
          <Metric label="Deletions" value={`-${detail.deletions}`} tone="danger" />
        </section>

        <section className="panel-card">
          <header className="px-4 py-3 border-b border-border flex items-center justify-between">
            <strong className="font-semibold">Changes</strong>
            <span className="small-mono">{diffs.length} files</span>
          </header>
          <div className="p-4 grid gap-2">
            {diffs.length === 0 && (
              <div className="text-sm text-text-muted">{loading ? 'Loading diff...' : 'No changed files found.'}</div>
            )}
            {diffs.slice(0, 8).map((diff) => (
              <div key={diff.filePath} className="flex items-center gap-2 text-sm">
                <FileText size={14} className="text-text-muted flex-none" />
                <span className="font-mono truncate">{diff.filePath}</span>
                {diff.isNew && <span className="tag">new</span>}
                {diff.isDeleted && <span className="tag">deleted</span>}
                {diff.isRenamed && <span className="tag">renamed</span>}
              </div>
            ))}
            {diffs.length > 8 && <div className="text-xs text-text-muted">+{diffs.length - 8} more files</div>}
          </div>
        </section>

        <section className="panel-card">
          <header className="px-4 py-3 border-b border-border flex items-center justify-between">
            <strong className="font-semibold">Checks</strong>
            <span className={cn('small-mono', failingChecks ? 'text-danger' : passingChecks ? 'text-success' : '')}>
              {checks.length ? `${passingChecks} / ${checks.length} passed` : 'none'}
            </span>
          </header>
          <div>
            {checks.length === 0 && <div className="px-4 py-3 text-sm text-text-muted">No checks reported.</div>}
            {checks.slice(0, 6).map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: 'success' | 'danger' | 'neutral';
}) {
  const color = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-text-primary';
  return (
    <div className="panel-card p-4">
      <div className={cn('text-xl font-mono tabular-nums', color)}>{value}</div>
      <div className="mt-1 text-xs text-text-muted">{label}</div>
    </div>
  );
}

export function PrSummaryPanel({
  detail,
  diffs,
  checks,
  commentCount,
  onSubmit,
}: {
  detail: GithubPullRequestDetail;
  diffs: FileDiff[];
  checks: GithubCheckRun[];
  commentCount: number;
  onSubmit: () => void;
}) {
  const passed = checks.filter((check) => check.conclusion === 'success').length;
  const failed = checks.filter(
    (check) =>
      check.conclusion === 'failure' ||
      check.conclusion === 'timed_out' ||
      check.conclusion === 'action_required',
  ).length;
  const statusText = detail.isDraft ? 'Draft' : detail.state === 'open' ? 'Open' : detail.state;

  return (
    <aside className="min-h-0 overflow-auto border-l border-border bg-bg p-3.5 grid gap-3.5 content-start">
      <section className="panel-card p-3">
        <div className="section-label mb-2">Status</div>
        <div className="flex items-center gap-2 text-sm">
          <GitPullRequest size={15} className={detail.state === 'open' ? 'text-success' : 'text-text-muted'} />
          <span className="font-medium capitalize">{statusText}</span>
          {failed > 0 ? (
            <span className="chip text-danger border-danger/30">Checks failing</span>
          ) : detail.mergeable === false ? (
            <span className="chip text-warn border-warn/30">Blocked</span>
          ) : (
            <span className="chip text-success border-success/30">Reviewable</span>
          )}
        </div>
      </section>

      <section className="panel-card">
        <header className="px-3 py-2.5 border-b border-border flex items-center justify-between">
          <strong className="text-sm font-semibold">Actions</strong>
          <span className="small-mono">PR #{detail.number}</span>
        </header>
        <div className="p-3 grid gap-2">
          <button className="btn-primary h-8" onClick={onSubmit}>
            Submit review
          </button>
        </div>
      </section>

      <section className="panel-card">
        <header className="px-3 py-2.5 border-b border-border">
          <strong className="text-sm font-semibold">Review summary</strong>
        </header>
        <SummaryRow label="Local comments" value={commentCount} />
        <SummaryRow label="Files changed" value={detail.changedFiles || diffs.length} />
        <SummaryRow
          label="Checks"
          value={checks.length ? `${passed}/${checks.length}` : 'none'}
          tone={failed ? 'danger' : passed ? 'success' : 'neutral'}
        />
      </section>

      <section className="panel-card">
        <header className="px-3 py-2.5 border-b border-border flex items-center justify-between">
          <strong className="text-sm font-semibold">Checks</strong>
          <span className={cn('small-mono', failed ? 'text-danger' : passed ? 'text-success' : '')}>
            {checks.length ? `${passed} / ${checks.length}` : 'none'}
          </span>
        </header>
        <div>
          {checks.length === 0 && <div className="px-3 py-3 text-sm text-text-muted">No checks reported.</div>}
          {checks.slice(0, 5).map((check) => (
            <CheckRow key={check.id} check={check} compact />
          ))}
        </div>
      </section>

      <section className="panel-card">
        <header className="px-3 py-2.5 border-b border-border flex items-center justify-between">
          <strong className="text-sm font-semibold">Files changed</strong>
          <span className="small-mono">{diffs.length}</span>
        </header>
        <div className="max-h-[280px] overflow-auto">
          {diffs.map((diff) => (
            <div key={diff.filePath} className="px-3 py-2 border-b last:border-b-0 border-border">
              <div className="text-xs font-mono truncate" title={diff.filePath}>
                {diff.filePath}
              </div>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}

function SummaryRow({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  tone?: 'success' | 'danger' | 'neutral';
}) {
  const valueClass = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-text-primary';
  return (
    <div className="flex items-center justify-between gap-2 min-h-[36px] px-3 py-2 border-b last:border-b-0 border-border">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className={cn('small-mono', valueClass)}>{value}</span>
    </div>
  );
}

function CheckRow({ check, compact = false }: { check: GithubCheckRun; compact?: boolean }) {
  const tone =
    check.conclusion === 'success'
      ? 'success'
      : check.conclusion === 'failure' || check.conclusion === 'timed_out' || check.conclusion === 'action_required'
      ? 'danger'
      : check.status !== 'completed'
      ? 'warn'
      : 'neutral';
  const dot =
    tone === 'success'
      ? 'bg-success'
      : tone === 'danger'
      ? 'bg-danger'
      : tone === 'warn'
      ? 'bg-warn'
      : 'bg-text-muted';
  const label = check.status !== 'completed' ? check.status.replace('_', ' ') : check.conclusion ?? 'completed';
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 border-b last:border-b-0 border-border',
        compact ? 'px-3 py-2' : 'px-4 py-2.5',
      )}
    >
      <span className="flex items-center text-sm min-w-0">
        <span className={cn('inline-block w-2 h-2 rounded-full mr-2 flex-none', dot)} />
        <span className="truncate" title={check.name}>
          {check.name}
        </span>
      </span>
      <span className="small-mono whitespace-nowrap">{label}</span>
    </div>
  );
}
