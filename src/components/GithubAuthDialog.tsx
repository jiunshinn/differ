import React, { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from '../api';
import { useApp } from '../state/AppStore';

export default function GithubAuthDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useApp();
  const [token, setToken] = useState('');
  const [login, setLogin] = useState<string | null>(null);
  const [scopes, setScopes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.ghAuthStatus().then((s) => {
      setLogin(s.login);
      setScopes(s.scopes);
    });
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const s = await api.ghAuthSetToken(token.trim());
      if (s.authenticated) {
        setLogin(s.login);
        setScopes(s.scopes);
        setToken('');
        toast('success', `Signed in as ${s.login}`);
      } else {
        toast('error', 'Token did not authenticate');
      }
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await api.ghAuthClear();
      setLogin(null);
      setScopes([]);
      toast('success', 'Signed out of GitHub');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[460px] panel p-4">
          <Dialog.Title className="text-base font-semibold mb-2">GitHub</Dialog.Title>
          {login ? (
            <div className="space-y-3">
              <div className="text-sm">
                Signed in as <span className="text-accent">{login}</span>
              </div>
              <div className="text-xs text-text-muted">Scopes: {scopes.join(', ') || '(none reported)'}</div>
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn" onClick={onClose}>
                  Close
                </button>
                <button className="btn" disabled={busy} onClick={() => void signOut()}>
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-text-secondary">
                Paste a GitHub personal access token. For PR review, the token needs <code>repo</code> scope (fine-grained
                tokens with Pull Requests read+write also work).
              </p>
              <input
                className="input font-mono"
                placeholder="ghp_… or github_pat_…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn" onClick={onClose}>
                  Cancel
                </button>
                <button className="btn-primary" disabled={busy || !token.trim()} onClick={() => void save()}>
                  Save token
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
