import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/AppStore';
import type { Repository } from '@shared/types';

export default function RepositoryPicker() {
  const { dispatch, toast, refresh } = useApp();
  const [recent, setRecent] = useState<Repository[]>([]);

  const load = async () => {
    const list = await api.recentRepos();
    setRecent(list);
  };
  useEffect(() => {
    void load();
  }, []);

  const open = async (repo: Repository) => {
    try {
      const r = await api.openRepo(repo.path);
      dispatch({ type: 'setRepo', repo: r });
      dispatch({ type: 'setSession', session: null });
      dispatch({ type: 'view', view: 'local' });
      await refresh();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const pick = async () => {
    try {
      const r = await api.pickRepo();
      if (!r) return;
      dispatch({ type: 'setRepo', repo: r });
      dispatch({ type: 'setSession', session: null });
      dispatch({ type: 'view', view: 'local' });
      await refresh();
      await load();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const remove = async (id: number) => {
    await api.removeRecent(id);
    await load();
  };

  return (
    <div className="h-full w-full overflow-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold mb-1">Open a repository</h1>
          <p className="text-text-secondary text-sm">
            Differ is a local-first diff review surface for AI-native Git workflows. Open a Git repo to start reviewing.
          </p>
        </div>
        <div className="flex gap-2 mb-6">
          <button className="btn-primary" onClick={() => void pick()}>
            Open local repository…
          </button>
        </div>
        <div>
          <h2 className="text-sm uppercase tracking-wide text-text-muted mb-2">Recent</h2>
          {recent.length === 0 && (
            <div className="text-text-muted text-sm">No recent repositories yet.</div>
          )}
          <ul className="space-y-1">
            {recent.map((r) => (
              <li key={r.id} className="panel px-3 py-2 flex items-center gap-2 hover:bg-bg-hover">
                <button
                  className="flex-1 text-left"
                  onClick={() => void open(r)}
                >
                  <div className="text-sm font-medium">{r.name}</div>
                  <div className="text-xs text-text-muted truncate">{r.path}</div>
                </button>
                {r.github_owner && r.github_repo && (
                  <span className="tag">{r.github_owner}/{r.github_repo}</span>
                )}
                <button
                  className="btn-ghost text-text-muted hover:text-danger"
                  onClick={() => void remove(r.id)}
                  title="Remove from recents"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
