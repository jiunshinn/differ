import React, { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from '../api';
import { useApp } from '../state/AppStore';
import type { GithubOwnerRef, GithubRepoSummary } from '@shared/types';
import CloneFromUrlDialog from './CloneFromUrlDialog';

interface Props {
  onClose: () => void;
}

type Scope = { kind: 'me' } | { kind: 'org'; login: string };

export default function RepoBrowserDialog({ onClose }: Props) {
  const { toast } = useApp();
  const [orgs, setOrgs] = useState<GithubOwnerRef[]>([]);
  const [scope, setScope] = useState<Scope>({ kind: 'me' });
  const [reposByScope, setReposByScope] = useState<Record<string, GithubRepoSummary[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [cloneTarget, setCloneTarget] = useState<GithubRepoSummary | null>(null);
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const status = await api.ghAuthStatus();
        if (!status.authenticated) {
          setError('Sign in to GitHub first.');
          return;
        }
        setMe(status.login);
        const orgList = await api.ghListMyOrgs();
        setOrgs(orgList);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const scopeKey = scope.kind === 'me' ? '__me__' : `org:${scope.login}`;

  useEffect(() => {
    if (reposByScope[scopeKey]) return;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const repos =
          scope.kind === 'me' ? await api.ghListMyRepos() : await api.ghListOrgRepos(scope.login);
        setReposByScope((prev) => ({ ...prev, [scopeKey]: repos }));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [scopeKey, reposByScope, scope]);

  const repos = reposByScope[scopeKey] ?? [];
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q),
    );
  }, [repos, filter]);

  if (cloneTarget) {
    return (
      <CloneFromUrlDialog
        onClose={() => setCloneTarget(null)}
        initialUrl={cloneTarget.cloneUrl}
        initialFolderName={cloneTarget.name}
        initialUseAuthToken
        onCloned={() => {
          setCloneTarget(null);
          onClose();
        }}
      />
    );
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[720px] max-h-[80vh] panel-card p-0 shadow-raised flex flex-col">
          <div className="px-4 pt-4 pb-3 border-b border-border">
            <Dialog.Title className="text-base font-semibold tracking-tight mb-2">
              Browse your GitHub repositories
            </Dialog.Title>
            <div className="flex gap-2 items-center flex-wrap">
              <button
                className={scope.kind === 'me' ? 'chip-selected' : 'chip'}
                onClick={() => setScope({ kind: 'me' })}
              >
                {me ? `@${me}` : 'You'}
              </button>
              {orgs.map((o) => (
                <button
                  key={o.login}
                  className={
                    scope.kind === 'org' && scope.login === o.login ? 'chip-selected' : 'chip'
                  }
                  onClick={() => setScope({ kind: 'org', login: o.login })}
                >
                  {o.login}
                </button>
              ))}
            </div>
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
                <li key={r.id}>
                  <button
                    className="w-full text-left panel-card px-3 py-2.5 hover:border-accent transition-colors flex items-start gap-3"
                    onClick={() => setCloneTarget(r)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold tracking-tight">{r.fullName}</span>
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

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso.slice(0, 10);
  }
}
