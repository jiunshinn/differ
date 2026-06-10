import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/AppStore';
import { cn } from '../utils/cn';
import { useCommitsQuery } from '../query/hooks';
import type { CommitSummary } from '@shared/types';

export default function HistoryView() {
  const { state, dispatch } = useApp();
  if (!state.repo) return null;

  const tabs: { id: 'graph' | 'resolve' | 'sync'; label: string }[] = [
    { id: 'graph', label: 'Graph' },
    { id: 'resolve', label: 'Resolve' },
    { id: 'sync', label: 'Sync' },
  ];

  return (
    <div className="h-full min-h-0 flex flex-col bg-bg">
      <header className="h-12 px-3.5 border-b border-border bg-bg-panel flex items-center justify-between gap-4">
        <div className="inline-flex bg-bg border border-border rounded-lg p-[3px] gap-1">
          {tabs.map((t) => {
            const active = state.historyTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => dispatch({ type: 'setHistoryTab', tab: t.id })}
                className={cn(
                  'min-h-[28px] px-2.5 rounded-md text-xs font-medium tracking-wide',
                  active
                    ? 'bg-bg-panel text-text-primary border border-border'
                    : 'text-text-muted hover:text-text-primary',
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <SubHeaderSummary />
      </header>
      <div className="flex-1 min-h-0 overflow-hidden">
        {state.historyTab === 'graph' && <GraphScreen />}
        {state.historyTab === 'resolve' && <ResolveScreen />}
        {state.historyTab === 'sync' && <SyncScreen />}
      </div>
    </div>
  );
}

function SubHeaderSummary() {
  const { state } = useApp();
  const conflicts = state.files.filter((f) => f.group === 'conflicted').length;
  const staged = state.files.filter((f) => f.group === 'staged').length;
  const ahead = state.status?.ahead ?? 0;
  const behind = state.status?.behind ?? 0;

  return (
    <div className="flex items-center gap-2 text-xs text-text-muted font-mono tabular-nums">
      {state.status?.branch && <span className="chip">{state.status.branch}</span>}
      {state.status?.upstream && <span className="chip">{state.status.upstream}</span>}
      {(ahead || behind) ? (
        <span className="chip">↑{ahead} ↓{behind}</span>
      ) : (
        <span className="chip">in sync</span>
      )}
      {conflicts > 0 && <span className="chip text-danger border-danger/30">{conflicts} conflicts</span>}
      {staged > 0 && <span className="chip">{staged} staged</span>}
    </div>
  );
}

// ── Graph ──────────────────────────────────────────────────────────────────

function GraphScreen() {
  const { state, toast } = useApp();
  const [filter, setFilter] = useState('');
  const repoId = state.repo?.id ?? null;
  const commitsQuery = useCommitsQuery(repoId, 80);
  const commits = commitsQuery.data ?? null;
  const loading = commitsQuery.isLoading;
  const commitError = commitsQuery.error instanceof Error ? commitsQuery.error.message : null;

  useEffect(() => {
    if (commitError) toast('error', commitError);
  }, [commitError, toast]);

  const filtered = useMemo(() => {
    if (!commits) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return commits;
    return commits.filter((c) =>
      [c.subject, c.authorName, c.authorEmail, c.shortSha].some((v) =>
        v.toLowerCase().includes(q),
      ),
    );
  }, [commits, filter]);

  const headSha = commits?.[0]?.sha ?? null;

  return (
    <div className="h-full min-h-0 grid grid-rows-[auto_minmax(0,1fr)]">
      <div className="px-3.5 py-3 border-b border-border bg-bg-panel flex items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Commit graph</h1>
          <p className="text-xs text-text-muted mt-0.5">
            Branch topology, remotes, and working tree state in one scan.
          </p>
        </div>
        <input
          className="input max-w-[260px]"
          type="search"
          placeholder="Filter author, subject, sha…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="min-h-0 overflow-auto p-3.5">
        <div className="panel-card">
          <div className="grid grid-cols-[80px_minmax(220px,1fr)_140px_88px] bg-bg-subtle text-text-muted text-[11px] font-semibold uppercase tracking-[0.07em] border-b border-border">
            <div className="px-3 py-2 border-r border-border">Graph</div>
            <div className="px-3 py-2 border-r border-border">Commit</div>
            <div className="px-3 py-2 border-r border-border">Author</div>
            <div className="px-3 py-2">Time</div>
          </div>

          {loading && (
            <div className="px-3 py-6 text-sm text-text-muted">Loading commits…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="px-3 py-6 text-sm text-text-muted">
              {commits && commits.length > 0 ? 'No commits match this filter.' : 'No commits in this repository yet.'}
            </div>
          )}

          {filtered.map((c, i) => (
            <CommitRow
              key={c.sha}
              commit={c}
              isHead={c.sha === headSha}
              branch={c.sha === headSha ? state.status?.branch ?? null : null}
              isLast={i === filtered.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CommitRow({
  commit,
  isHead,
  branch,
  isLast,
}: {
  commit: CommitSummary;
  isHead: boolean;
  branch: string | null;
  isLast: boolean;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-[80px_minmax(220px,1fr)_140px_88px] items-stretch',
        !isLast && 'border-b border-border',
      )}
    >
      <div className="px-3 py-3 border-r border-border flex items-center">
        <Lane />
      </div>
      <div className="px-3 py-3 border-r border-border min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {isHead && <span className="chip chip-selected">HEAD</span>}
          {branch && <span className="chip">{branch}</span>}
          <span className="text-xs text-text-muted font-mono tabular-nums">{commit.shortSha}</span>
        </div>
        <div className="text-sm font-medium truncate" title={commit.subject}>
          {commit.subject}
        </div>
      </div>
      <div className="px-3 py-3 border-r border-border text-xs text-text-muted font-mono truncate" title={commit.authorEmail}>
        {commit.authorName}
      </div>
      <div className="px-3 py-3 text-xs text-text-muted font-mono tabular-nums">
        {formatRelative(commit.authorDate)}
      </div>
    </div>
  );
}

function Lane() {
  return (
    <div className="relative h-9 w-14">
      <span className="absolute top-[-12px] bottom-[-12px] start-3 w-[2px] bg-border rounded-full" />
      <span className="absolute top-[-12px] bottom-[-12px] start-8 w-[2px] bg-accent/40 rounded-full" />
      <span className="absolute top-3 start-[26px] w-3 h-3 rounded-full bg-accent border-2 border-bg-panel shadow-card" />
    </div>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
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

// ── Resolve ────────────────────────────────────────────────────────────────

function ResolveScreen() {
  const { state, toast, refresh } = useApp();
  const conflicts = useMemo(() => state.files.filter((f) => f.group === 'conflicted'), [state.files]);
  const [activePath, setActivePath] = useState<string | null>(conflicts[0]?.path ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const repoId = state.repo?.id ?? null;
  const rebaseInProgress = !!state.status?.rebaseInProgress;
  const mergeInProgress = !!state.status?.mergeInProgress;
  const operationLabel = rebaseInProgress ? 'rebase' : mergeInProgress ? 'merge' : null;
  const hasUnresolved = conflicts.length > 0;
  const canContinue = operationLabel === 'rebase' && !hasUnresolved;

  useEffect(() => {
    if (!activePath && conflicts[0]) setActivePath(conflicts[0].path);
    if (activePath && !conflicts.some((c) => c.path === activePath)) {
      setActivePath(conflicts[0]?.path ?? null);
    }
  }, [activePath, conflicts]);

  const runOp = async (label: string, fn: () => Promise<void>) => {
    if (repoId === null) return;
    setBusy(label);
    try {
      await fn();
      await refresh();
      toast('success', `${label} succeeded`);
    } catch (e) {
      toast('error', (e as Error).message.split('\n')[0]?.slice(0, 240) ?? (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const continueRebase = () => {
    if (repoId === null) return;
    void runOp('Continue rebase', () => api.rebaseContinue(repoId).then(() => undefined));
  };
  const abortRebase = () => {
    if (repoId === null) return;
    void runOp('Abort rebase', () => api.rebaseAbort(repoId).then(() => undefined));
  };
  const abortMerge = () => {
    if (repoId === null) return;
    void runOp('Abort merge', () => api.mergeAbort(repoId).then(() => undefined));
  };

  return (
    <div className="h-full min-h-0 grid grid-rows-[auto_auto_minmax(0,1fr)]">
      <div className="px-3.5 py-3 border-b border-border bg-bg-panel flex items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Merge conflict resolver</h1>
          <p className="text-xs text-text-muted mt-0.5">
            Queue conflicts, compare both sides, and stage the resolved file.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn" onClick={() => toast('info', 'Use incoming — not yet wired')}>
            Use incoming
          </button>
          <button className="btn-primary" onClick={() => toast('info', 'Stage resolution — not yet wired')}>
            Stage resolution
          </button>
        </div>
      </div>

      {operationLabel && (
        <div className="px-3.5 py-2.5 border-b border-border bg-warn/10 flex items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-semibold capitalize">{operationLabel} in progress.</span>{' '}
            <span className="text-text-secondary">
              {hasUnresolved
                ? `Resolve the ${conflicts.length} remaining conflict${conflicts.length === 1 ? '' : 's'} and stage each file, then continue.`
                : operationLabel === 'rebase'
                ? 'All conflicts staged. Click Continue to resume the rebase.'
                : 'All conflicts staged. Create a merge commit from Local Changes to finish.'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {operationLabel === 'rebase' ? (
              <>
                <button
                  className="btn-primary"
                  disabled={!!busy || !canContinue}
                  title={canContinue ? 'git rebase --continue' : 'Stage all conflicted files first'}
                  onClick={continueRebase}
                >
                  {busy === 'Continue rebase' ? 'Continuing…' : 'Continue'}
                </button>
                <button className="btn" disabled={!!busy} onClick={abortRebase}>
                  {busy === 'Abort rebase' ? 'Aborting…' : 'Abort rebase'}
                </button>
              </>
            ) : (
              <button className="btn" disabled={!!busy} onClick={abortMerge}>
                {busy === 'Abort merge' ? 'Aborting…' : 'Abort merge'}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="min-h-0 p-3.5 grid grid-cols-[280px_minmax(0,1fr)] gap-3.5">
        <aside className="panel-card flex flex-col min-h-0">
          <div className="h-10 px-3 border-b border-border bg-bg-subtle flex items-center justify-between">
            <strong className="text-sm font-semibold">Conflict queue</strong>
            <span className={cn('chip', conflicts.length > 0 && 'text-danger border-danger/30')}>
              {conflicts.length} file{conflicts.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="min-h-0 overflow-auto">
            {conflicts.length === 0 && (
              <div className="px-3 py-6 text-sm text-text-muted">
                No conflicts in the working tree.
              </div>
            )}
            {conflicts.map((f) => {
              const active = f.path === activePath;
              const status = `${f.indexStatus}${f.worktreeStatus}`;
              return (
                <button
                  key={f.path}
                  onClick={() => setActivePath(f.path)}
                  className={cn(
                    'w-full text-left grid grid-cols-[1fr_auto] gap-2 px-3 py-3 border-b border-border last:border-b-0',
                    active ? 'bg-accent-soft' : 'hover:bg-bg-subtle',
                  )}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate" title={f.path}>
                      {f.path.split('/').pop()}
                    </div>
                    <div className="text-xs text-text-muted font-mono truncate" title={f.path}>
                      {f.path}
                    </div>
                  </div>
                  <span className="chip text-danger border-danger/30">{status}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="panel-card grid grid-rows-[40px_minmax(0,1fr)_48px] min-h-0">
          <div className="px-3 border-b border-border bg-bg-subtle flex items-center justify-between">
            <strong className="text-sm font-semibold truncate">{activePath ?? 'No file selected'}</strong>
            <span className="small-mono">three-way preview</span>
          </div>
          <div className="grid grid-cols-3 min-h-0">
            <MergePane label="Current" tag={state.status?.branch ?? 'local'} variant="remove" />
            <MergePane label="Incoming" tag={state.status?.upstream ?? 'origin'} variant="add" />
            <MergePane label="Resolved" tag="staged preview" variant="focus" />
          </div>
          <div className="px-3 border-t border-border flex items-center justify-between">
            <span className="small-mono">Autosaved resolution draft locally</span>
            <div className="flex items-center gap-2">
              <button className="btn" onClick={() => toast('info', 'Reopen block — not yet wired')}>
                Reopen block
              </button>
              <button className="btn-primary" onClick={() => toast('info', 'Accept and next — not yet wired')}>
                Accept and next
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function MergePane({
  label,
  tag,
  variant,
}: {
  label: string;
  tag: string;
  variant: 'add' | 'remove' | 'focus';
}) {
  const bg =
    variant === 'add'
      ? 'bg-success/10'
      : variant === 'remove'
        ? 'bg-danger/10'
        : 'bg-accent-soft';
  return (
    <section className="flex flex-col min-w-0 border-r border-border last:border-r-0">
      <div className="h-8 px-3 border-b border-border bg-bg-panel flex items-center justify-between text-xs uppercase tracking-[0.07em] text-text-muted">
        <span className="font-semibold">{label}</span>
        <span className="font-mono normal-case tracking-normal text-text-muted">{tag}</span>
      </div>
      <div className="min-h-0 overflow-auto py-2 font-mono text-xs leading-6 tabular-nums">
        {[1, 2, 3, 4, 5].map((n) => (
          <div
            key={n}
            className={cn(
              'grid grid-cols-[40px_1fr] gap-2 px-3 whitespace-pre',
              n === 2 || n === 3 ? bg : null,
            )}
          >
            <span className="text-text-muted text-right select-none">{71 + n}</span>
            <span className="text-text-secondary">// preview placeholder</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Sync ───────────────────────────────────────────────────────────────────

function SyncScreen() {
  const { state, refresh, toast, logActivity } = useApp();
  const repo = state.repo!;
  const staged = state.files.filter((f) => f.group === 'staged');
  const conflicted = state.files.filter((f) => f.group === 'conflicted');
  const ahead = state.status?.ahead ?? 0;
  const behind = state.status?.behind ?? 0;
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (
    label: string,
    kind: 'fetch' | 'pull' | 'push',
    fn: () => Promise<void>,
  ) => {
    setBusy(label);
    try {
      await fn();
      toast('success', `${label} done`);
      logActivity({ kind, message: `${label} ${repo.name}` });
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const steps: { label: string; detail: string; state: 'done' | 'active' | 'pending' }[] = [
    {
      label: 'Fetch remote refs',
      detail: state.status?.upstream
        ? `Tracking ${state.status.upstream}.`
        : 'No upstream configured yet.',
      state: state.status?.upstream ? 'done' : 'active',
    },
    {
      label: 'Resolve merge conflicts',
      detail:
        conflicted.length > 0
          ? `${conflicted.length} conflicted file${conflicted.length === 1 ? '' : 's'} still in the working tree.`
          : 'No outstanding conflicts.',
      state: conflicted.length > 0 ? 'active' : 'done',
    },
    {
      label: 'Stage changes',
      detail:
        staged.length > 0
          ? `${staged.length} file${staged.length === 1 ? '' : 's'} staged for commit.`
          : 'Nothing staged.',
      state: staged.length > 0 ? 'done' : 'pending',
    },
    {
      label: ahead > 0 ? `Push ${ahead} commit${ahead === 1 ? '' : 's'}` : 'Push branch',
      detail:
        ahead > 0
          ? `${ahead} commit${ahead === 1 ? '' : 's'} ahead of ${state.status?.upstream ?? 'origin'}.`
          : 'Nothing new to push.',
      state: ahead > 0 ? 'active' : 'pending',
    },
  ];

  return (
    <div className="h-full min-h-0 grid grid-rows-[auto_minmax(0,1fr)]">
      <div className="px-3.5 py-3 border-b border-border bg-bg-panel flex items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Sync review</h1>
          <p className="text-xs text-text-muted mt-0.5">
            Confirm staged files, remote divergence, and outstanding work before pushing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn"
            disabled={!!busy}
            onClick={() =>
              run('Fetch', 'fetch', async () => {
                await api.fetch(repo.id);
                await refresh();
              })
            }
          >
            Fetch
          </button>
          <button
            className="btn"
            disabled={!!busy || behind === 0}
            onClick={() =>
              run('Pull', 'pull', async () => {
                await api.pull(repo.id);
                await refresh();
              })
            }
          >
            Pull {behind > 0 ? `${behind}` : ''}
          </button>
          <button
            className="btn-primary"
            disabled={!!busy || ahead === 0}
            onClick={() =>
              run('Push', 'push', async () => {
                try {
                  await api.push(repo.id);
                } catch (e) {
                  if ((e as Error).message.includes('no upstream')) {
                    await api.push(repo.id, { setUpstream: true });
                  } else {
                    throw e;
                  }
                }
                await refresh();
              })
            }
          >
            Push {ahead > 0 ? `${ahead}` : ''}
          </button>
        </div>
      </div>

      <div className="min-h-0 p-3.5 grid grid-cols-2 gap-3.5">
        <section className="panel-card flex flex-col min-h-0">
          <div className="h-10 px-3 border-b border-border bg-bg-subtle flex items-center justify-between">
            <strong className="text-sm font-semibold">Staged changes</strong>
            <span className="chip chip-selected">{staged.length} file{staged.length === 1 ? '' : 's'}</span>
          </div>
          <div className="min-h-0 overflow-auto">
            {staged.length === 0 && (
              <div className="px-3 py-6 text-sm text-text-muted">
                Nothing staged. Stage files in the Local view to prepare a push.
              </div>
            )}
            {staged.map((f) => (
              <div
                key={f.path}
                className="grid grid-cols-[16px_1fr_auto] gap-3 items-center px-3 py-3 border-b border-border last:border-b-0"
              >
                <span className={cn('w-2 h-2 rounded-full', dotColor(f.indexStatus))} />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate" title={f.path}>
                    {f.path.split('/').pop()}
                  </div>
                  <div className="text-xs text-text-muted font-mono truncate" title={f.path}>
                    {f.path}
                  </div>
                </div>
                <span className="chip">{f.indexStatus}{f.worktreeStatus}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel-card flex flex-col min-h-0">
          <div className="h-10 px-3 border-b border-border bg-bg-subtle flex items-center justify-between">
            <strong className="text-sm font-semibold">Push checklist</strong>
            <span className={cn('chip', steps.some((s) => s.state === 'active') && 'text-warn border-warn/30')}>
              {steps.filter((s) => s.state === 'done').length}/{steps.length} ready
            </span>
          </div>
          <div className="min-h-0 overflow-auto p-3.5 grid gap-2.5">
            {steps.map((s, i) => (
              <div key={i} className="grid grid-cols-[24px_1fr] gap-2 items-start">
                <span
                  className={cn(
                    'w-5 h-5 rounded-full grid place-items-center text-[10px] font-mono border',
                    s.state === 'done' && 'border-success/30 bg-success/10 text-success',
                    s.state === 'active' && 'border-accent/30 bg-accent-soft text-accent',
                    s.state === 'pending' && 'border-border text-text-muted',
                  )}
                >
                  {i + 1}
                </span>
                <div>
                  <strong className="block text-sm font-medium leading-tight">{s.label}</strong>
                  <span className="block text-xs text-text-muted mt-0.5">{s.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function dotColor(indexStatus: string): string {
  switch (indexStatus) {
    case 'A':
      return 'bg-accent';
    case 'M':
      return 'bg-warn';
    case 'D':
      return 'bg-danger';
    case 'R':
    case 'C':
      return 'bg-success';
    default:
      return 'bg-border';
  }
}
