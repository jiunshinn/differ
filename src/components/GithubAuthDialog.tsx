import React, { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from '../api';
import { useApp } from '../state/AppStore';
import type { GithubDeviceCode } from '@shared/types';

type Mode = 'idle' | 'oauth' | 'pat';

export default function GithubAuthDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useApp();
  const [token, setToken] = useState('');
  const [login, setLogin] = useState<string | null>(null);
  const [scopes, setScopes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const [oauthConfigured, setOauthConfigured] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [device, setDevice] = useState<GithubDeviceCode | null>(null);
  const [oauthMessage, setOauthMessage] = useState<string | null>(null);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    void (async () => {
      const [auth, cfg] = await Promise.all([api.ghAuthStatus(), api.ghOauthConfig()]);
      setLogin(auth.login);
      setScopes(auth.scopes);
      setOauthConfigured(cfg.configured);
    })();
    return () => {
      cancelledRef.current = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
      void api.ghOauthCancel().catch(() => undefined);
    };
  }, []);

  const startOAuth = async () => {
    setBusy(true);
    setOauthMessage(null);
    cancelledRef.current = false;
    try {
      const code = await api.ghOauthStart();
      setDevice(code);
      setMode('oauth');
      void api.openExternal(code.verificationUri).catch(() => undefined);
      schedulePoll(code.interval);
    } catch (e) {
      toast('error', (e as Error).message);
      setMode('idle');
    } finally {
      setBusy(false);
    }
  };

  const schedulePoll = (seconds: number) => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = setTimeout(() => void poll(), Math.max(1, seconds) * 1000);
  };

  const poll = async () => {
    if (cancelledRef.current) return;
    try {
      const res = await api.ghOauthPoll();
      if (cancelledRef.current) return;
      if (res.status === 'authorized' && res.auth) {
        setLogin(res.auth.login);
        setScopes(res.auth.scopes);
        setDevice(null);
        setMode('idle');
        toast('success', `Signed in as ${res.auth.login}`);
        return;
      }
      if (res.status === 'slow_down') {
        setOauthMessage('GitHub asked to slow down. Retrying…');
        schedulePoll(res.nextIntervalSeconds ?? 10);
        return;
      }
      if (res.status === 'pending') {
        setOauthMessage('Waiting for you to authorize in the browser…');
        schedulePoll(device?.interval ?? 5);
        return;
      }
      if (res.status === 'expired' || res.status === 'denied' || res.status === 'error') {
        toast('error', res.error || `OAuth ${res.status}`);
        setMode('idle');
        setDevice(null);
        return;
      }
    } catch (e) {
      toast('error', (e as Error).message);
      setMode('idle');
      setDevice(null);
    }
  };

  const cancelOAuth = async () => {
    cancelledRef.current = true;
    if (pollTimer.current) clearTimeout(pollTimer.current);
    await api.ghOauthCancel().catch(() => undefined);
    setMode('idle');
    setDevice(null);
    setOauthMessage(null);
  };

  const savePat = async () => {
    setBusy(true);
    try {
      const s = await api.ghAuthSetToken(token.trim());
      if (s.authenticated) {
        setLogin(s.login);
        setScopes(s.scopes);
        setToken('');
        setMode('idle');
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

  const copyUserCode = async () => {
    if (!device) return;
    await api.copyToClipboard(device.userCode);
    toast('success', 'Code copied');
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[480px] panel-card p-4 shadow-raised">
          <Dialog.Title className="text-base font-semibold mb-2 tracking-tight">GitHub</Dialog.Title>

          {login ? (
            <div className="space-y-3">
              <div className="text-sm">
                Signed in as <span className="text-accent">{login}</span>
              </div>
              <div className="text-xs text-text-muted font-mono">
                Scopes: {scopes.join(', ') || '(none reported)'}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn" onClick={onClose}>
                  Close
                </button>
                <button className="btn" disabled={busy} onClick={() => void signOut()}>
                  Sign out
                </button>
              </div>
            </div>
          ) : mode === 'oauth' && device ? (
            <div className="space-y-3">
              <p className="text-sm text-text-secondary">
                A browser window has been opened to <span className="font-mono">{device.verificationUri}</span>. Enter
                this code and authorize Differ:
              </p>
              <div className="flex items-center gap-2">
                <div className="font-mono text-2xl tracking-[0.3em] px-3 py-2 rounded bg-bg-subtle border border-border-subtle select-all">
                  {device.userCode}
                </div>
                <button className="btn h-9" onClick={() => void copyUserCode()}>
                  Copy
                </button>
                <button
                  className="btn h-9"
                  onClick={() => void api.openExternal(device.verificationUri)}
                >
                  Reopen
                </button>
              </div>
              <div className="text-xs text-text-muted">
                {oauthMessage ?? 'Waiting for you to authorize in the browser…'}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn" onClick={() => void cancelOAuth()}>
                  Cancel
                </button>
              </div>
            </div>
          ) : mode === 'pat' ? (
            <div className="space-y-3">
              <p className="text-sm text-text-secondary">
                Paste a GitHub personal access token. For PR review and private repo browsing, the token needs{' '}
                <code>repo</code> scope (fine-grained tokens with Pull Requests + Contents work too).
              </p>
              <input
                className="input font-mono"
                placeholder="ghp_… or github_pat_…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn" onClick={() => setMode('idle')}>
                  Back
                </button>
                <button className="btn-primary" disabled={busy || !token.trim()} onClick={() => void savePat()}>
                  Save token
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-text-secondary">
                Sign in to browse your repositories (including private and organization repos) and review pull
                requests.
              </p>
              <div className="grid gap-2">
                <button
                  className="btn-primary h-10"
                  disabled={busy || oauthConfigured === false}
                  onClick={() => void startOAuth()}
                  title={
                    oauthConfigured === false
                      ? 'OAuth is not configured for this build. Use a personal access token instead.'
                      : undefined
                  }
                >
                  Sign in with GitHub
                </button>
                {oauthConfigured === false && (
                  <div className="text-xs text-text-muted">
                    OAuth is not configured for this build. Set <code>DIFFER_GITHUB_OAUTH_CLIENT_ID</code> or use a
                    personal access token below.
                  </div>
                )}
                <button className="btn h-10" onClick={() => setMode('pat')}>
                  Use a personal access token
                </button>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn" onClick={onClose}>
                  Close
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
