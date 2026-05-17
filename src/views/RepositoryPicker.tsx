import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/AppStore';
import type { Repository } from '@shared/types';
import GithubAuthDialog from '../components/GithubAuthDialog';
import CloneFromUrlDialog from '../components/CloneFromUrlDialog';
import RepoBrowserDialog from '../components/RepoBrowserDialog';

export default function RepositoryPicker() {
  const { dispatch, toast, refresh } = useApp();
  const [recent, setRecent] = useState<Repository[]>([]);
  const [authed, setAuthed] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showClone, setShowClone] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);

  const load = async () => {
    const list = await api.recentRepos();
    setRecent(list);
  };
  const loadAuth = async () => {
    const s = await api.ghAuthStatus();
    setAuthed(s.authenticated);
  };
  useEffect(() => {
    void load();
    void loadAuth();
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

  const onBrowseClick = () => {
    if (!authed) {
      setShowAuth(true);
      return;
    }
    setShowBrowser(true);
  };

  const remove = async (id: number) => {
    await api.removeRecent(id);
    await load();
  };

  return (
    <div className="h-full w-full overflow-auto p-8 bg-bg">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold mb-2 tracking-tight">Open a repository</h1>
          <p className="text-text-secondary">
            Differ is a local-first diff review surface for AI-native Git workflows. Open a Git repo to start reviewing.
          </p>
        </div>
        <div className="flex gap-2 mb-8 flex-wrap">
          <button className="btn-primary h-10 px-4" onClick={() => void pick()}>
            Open local repository…
          </button>
          <button className="btn h-10 px-4" onClick={() => setShowClone(true)}>
            Clone from URL…
          </button>
          <button className="btn h-10 px-4" onClick={onBrowseClick}>
            {authed ? 'Browse your GitHub repos…' : 'Sign in with GitHub'}
          </button>
        </div>
        <div>
          <h2 className="section-label mb-3">Recent</h2>
          {recent.length === 0 && <div className="text-text-muted text-sm">No recent repositories yet.</div>}
          <ul className="grid gap-2">
            {recent.map((r) => (
              <li
                key={r.id}
                className="panel-card px-3.5 py-3 flex items-center gap-3 hover:border-accent transition-colors"
              >
                <button className="flex-1 text-left min-w-0" onClick={() => void open(r)}>
                  <div className="font-semibold tracking-tight">{r.name}</div>
                  <div className="text-xs text-text-muted truncate font-mono">{r.path}</div>
                </button>
                {r.github_owner && r.github_repo && (
                  <span className="chip">
                    {r.github_owner}/{r.github_repo}
                  </span>
                )}
                <button
                  className="btn-ghost h-8 w-8 p-0 text-text-muted hover:text-danger"
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

      {showAuth && (
        <GithubAuthDialog
          onClose={() => {
            setShowAuth(false);
            void loadAuth();
          }}
        />
      )}
      {showClone && <CloneFromUrlDialog onClose={() => setShowClone(false)} />}
      {showBrowser && <RepoBrowserDialog onClose={() => setShowBrowser(false)} />}
    </div>
  );
}
