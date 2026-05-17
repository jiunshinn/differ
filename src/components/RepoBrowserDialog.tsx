import React, { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from '../api';
import type { GithubAccount, GithubOwnerRef, GithubRepoSummary } from '@shared/types';
import CloneFromUrlDialog from './CloneFromUrlDialog';

interface Props {
  onClose: () => void;
}

type Scope =
  | { kind: 'all' }
  | { kind: 'account'; accountId: number }
  | { kind: 'org'; accountId: number; org: string };

function scopeKey(s: Scope): string {
  if (s.kind === 'all') return '__all__';
  if (s.kind === 'account') return `acc:${s.accountId}`;
  return `acc:${s.accountId}:org:${s.org}`;
}

export default function RepoBrowserDialog({ onClose }: Props) {
  const [accounts, setAccounts] = useState<GithubAccount[]>([]);
  const [orgsByAccount, setOrgsByAccount] = useState<Record<number, GithubOwnerRef[]>>({});
  const [scope, setScope] = useState<Scope>({ kind: 'all' });
  const [reposByScope, setReposByScope] = useState<Record<string, GithubRepoSummary[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [cloneTarget, setCloneTarget] = useState<GithubRepoSummary | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const state = await api.ghAuthList();
        if (state.accounts.length === 0) {
          setError('Add a GitHub account first (top-right account menu).');
          return;
        }
        setAccounts(state.accounts);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  // Lazily fetch orgs the first time an account scope is selected.
  useEffect(() => {
    if (scope.kind === 'all') return;
    if (orgsByAccount[scope.accountId]) return;
    void (async () => {
      try {
        const list = await api.ghListMyOrgs(scope.accountId);
        setOrgsByAccount((prev) => ({ ...prev, [scope.accountId]: list }));
      } catch {
        // Silent — orgs are optional UI; the account row still works without them.
      }
    })();
  }, [scope, orgsByAccount]);

  const key = scopeKey(scope);

  useEffect(() => {
    if (reposByScope[key]) return;
    if (accounts.length === 0 && scope.kind !== 'all') return;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        let repos: GithubRepoSummary[];
        if (scope.kind === 'all') {
          repos = await api.ghListAllRepos();
        } else if (scope.kind === 'account') {
          // Reuse listAllRepos result if present; else fetch and filter.
          const all = reposByScope['__all__'] ?? (await api.ghListAllRepos());
          if (!reposByScope['__all__']) {
            setReposByScope((prev) => ({ ...prev, __all__: all }));
          }
          repos = all.filter((r) => r.accountId === scope.accountId);
        } else {
          repos = await api.ghListOrgRepos(scope.accountId, scope.org);
        }
        setReposByScope((prev) => ({ ...prev, [key]: repos }));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, accounts.length]);

  const repos = reposByScope[key] ?? [];
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.accountLogin.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q),
    );
  }, [repos, filter]);

  if (cloneTarget) {
    return (
      <CloneFromUrlDialog
        onClose={() => setCloneTarget(null)}
        initialUrl={cloneTarget.cloneUrl}
        initialFolderName={cloneTarget.name}
        initialUseAuthToken
        accountId={cloneTarget.accountId}
        onCloned={() => {
          setCloneTarget(null);
          onClose();
        }}
      />
    );
  }

  const activeAccountId = scope.kind === 'all' ? null : scope.accountId;
  const orgsForActive = activeAccountId != null ? orgsByAccount[activeAccountId] ?? [] : [];

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[760px] max-h-[80vh] panel-card p-0 shadow-raised flex flex-col">
          <div className="px-4 pt-4 pb-3 border-b border-border">
            <Dialog.Title className="text-base font-semibold tracking-tight mb-2">
              Browse your GitHub repositories
            </Dialog.Title>
            <div className="flex gap-2 items-center flex-wrap">
              <button
                className={scope.kind === 'all' ? 'chip-selected' : 'chip'}
                onClick={() => setScope({ kind: 'all' })}
              >
                All accounts
              </button>
              {accounts.map((a) => {
                const selected = scope.kind !== 'all' && scope.accountId === a.id;
                return (
                  <button
                    key={a.id}
                    className={selected ? 'chip-selected' : 'chip'}
                    onClick={() => setScope({ kind: 'account', accountId: a.id })}
                    title={`@${a.login}`}
                  >
                    {a.avatarUrl ? (
                      <img src={a.avatarUrl} alt="" className="inline h-4 w-4 rounded-full mr-1 -ml-0.5 align-text-bottom" />
                    ) : null}
                    @{a.login}
                  </button>
                );
              })}
            </div>
            {scope.kind !== 'all' && orgsForActive.length > 0 && (
              <div className="mt-2 flex gap-1.5 items-center flex-wrap">
                <span className="text-xs text-text-muted mr-1">Orgs:</span>
                <button
                  className={scope.kind === 'account' ? 'chip-selected' : 'chip'}
                  onClick={() => setScope({ kind: 'account', accountId: scope.accountId })}
                >
                  (none)
                </button>
                {orgsForActive.map((o) => (
                  <button
                    key={o.login}
                    className={
                      scope.kind === 'org' && scope.org === o.login ? 'chip-selected' : 'chip'
                    }
                    onClick={() => setScope({ kind: 'org', accountId: scope.accountId, org: o.login })}
                  >
                    {o.login}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-3">
              <input
                className="input"
                placeholder="Filter repositories…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto px-2 py-2">
            {error && <div className="px-3 py-2 text-sm text-danger">{error}</div>}
            {loading && <div className="px-3 py-2 text-sm text-text-muted">Loading…</div>}
            {!loading && !error && filtered.length === 0 && (
              <div className="px-3 py-6 text-sm text-text-muted text-center">No repositories.</div>
            )}
            <ul className="grid gap-1">
              {filtered.map((r) => (
                <li key={`${r.accountId}:${r.id}`}>
                  <button
                    className="w-full text-left panel-card px-3 py-2.5 hover:border-accent transition-colors flex items-start gap-3"
                    onClick={() => setCloneTarget(r)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold tracking-tight">{r.fullName}</span>
                        <AccountBadge
                          login={r.accountLogin}
                          avatarUrl={r.accountAvatarUrl}
                          showLabel={accounts.length > 1}
                        />
                        {r.private && <span className="chip">private</span>}
                        {r.fork && <span className="chip">fork</span>}
                        {r.archived && <span className="chip">archived</span>}
                      </div>
                      {r.description && (
                        <div className="text-xs text-text-secondary mt-0.5 line-clamp-2">
                          {r.description}
                        </div>
                      )}
                      <div className="small-mono mt-1">
                        {r.defaultBranch ?? '—'} · ★ {r.stargazersCount} · updated{' '}
                        {formatDate(r.updatedAt)}
                      </div>
                    </div>
                    <span className="btn h-8 px-3 self-center">Clone</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
            <button className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AccountBadge({
  login,
  avatarUrl,
  showLabel,
}: {
  login: string;
  avatarUrl: string | null;
  showLabel: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 chip"
      title={`Discovered via @${login}`}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="h-3.5 w-3.5 rounded-full" />
      ) : null}
      {showLabel && <span className="text-[10px]">@{login}</span>}
    </span>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso.slice(0, 10);
  }
}
