import React, { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from '../api';
import { useApp } from '../state/AppStore';
import type { GithubAccount, GithubDeviceCode, Repository } from '@shared/types';

type Mode = 'list' | 'oauth' | 'pat' | 'rebind';

interface RebindState {
  account: GithubAccount;
  repos: Repository[];
  targetAccountId: number | null;
}

export default function GithubAuthDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useApp();
  const [accounts, setAccounts] = useState<GithubAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const [oauthConfigured, setOauthConfigured] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>('list');
  const [token, setToken] = useState('');
  const [device, setDevice] = useState<GithubDeviceCode | null>(null);
  const [oauthMessage, setOauthMessage] = useState<string | null>(null);
  const [rebind, setRebind] = useState<RebindState | null>(null);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  // GitHub's mandated polling interval (seconds). Kept in a ref so the poll
  // closure scheduled via setTimeout always reads the current value rather than
  // a stale `device` captured at schedule time.
  const intervalRef = useRef(5);

  const reload = async () => {
    const state = await api.ghAuthList();
    setAccounts(state.accounts);
  };

  useEffect(() => {
    void (async () => {
      try {
        const [state, cfg] = await Promise.all([api.ghAuthList(), api.ghOauthConfig()]);
        setAccounts(state.accounts);
        setOauthConfigured(cfg.configured);
      } catch (e) {
        toast('error', (e as Error).message);
      }
    })();
    return () => {
      cancelledRef.current = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
      void api.ghOauthCancel().catch(() => undefined);
    };
    // Mount-only: the cleanup cancels any in-flight OAuth, so this must not
    // re-run. `toast` from useApp is a stable callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startOAuth = async () => {
    setBusy(true);
    setOauthMessage(null);
    cancelledRef.current = false;
    try {
      const code = await api.ghOauthStart();
      setDevice(code);
      setMode('oauth');
      intervalRef.current = Math.max(1, code.interval);
      void api.openExternal(code.verificationUri).catch(() => undefined);
      schedulePoll(intervalRef.current);
    } catch (e) {
      toast('error', (e as Error).message);
      setMode('list');
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
      if (res.status === 'authorized' && res.account) {
        setDevice(null);
        setMode('list');
        toast('success', `Added @${res.account.login}`);
        await reload();
        return;
      }
      if (res.status === 'slow_down') {
        // Persist the backoff so subsequent pending polls keep the slower cadence.
        intervalRef.current = Math.max(intervalRef.current, res.nextIntervalSeconds ?? 10);
        setOauthMessage('GitHub asked to slow down. Retrying…');
        schedulePoll(intervalRef.current);
        return;
      }
      if (res.status === 'pending') {
        setOauthMessage('Waiting for you to authorize in the browser…');
        schedulePoll(intervalRef.current);
        return;
      }
      if (res.status === 'expired' || res.status === 'denied' || res.status === 'error') {
        toast('error', res.error || `OAuth ${res.status}`);
        setMode('list');
        setDevice(null);
        return;
      }
    } catch (e) {
      toast('error', (e as Error).message);
      setMode('list');
      setDevice(null);
    }
  };

  const cancelOAuth = async () => {
    cancelledRef.current = true;
    if (pollTimer.current) clearTimeout(pollTimer.current);
    await api.ghOauthCancel().catch(() => undefined);
    setMode('list');
    setDevice(null);
    setOauthMessage(null);
  };

  const savePat = async () => {
    setBusy(true);
    try {
      const account = await api.ghAuthAddToken(token.trim());
      setToken('');
      setMode('list');
      toast('success', `Added @${account.login}`);
      await reload();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const askSignOut = async (account: GithubAccount) => {
    setBusy(true);
    try {
      const repos = await api.ghAuthListReposForAccount(account.id);
      if (repos.length === 0) {
        await api.ghAuthRemove(account.id);
        toast('success', `Removed @${account.login}`);
        await reload();
      } else {
        setRebind({ account, repos, targetAccountId: null });
        setMode('rebind');
      }
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmRebind = async () => {
    if (!rebind) return;
    setBusy(true);
    try {
      await api.ghAuthRebindRepos(rebind.account.id, rebind.targetAccountId);
      await api.ghAuthRemove(rebind.account.id);
      const label =
        rebind.targetAccountId == null
          ? `(unbound ${rebind.repos.length} repo${rebind.repos.length === 1 ? '' : 's'})`
          : `(moved ${rebind.repos.length} to @${
              accounts.find((a) => a.id === rebind.targetAccountId)?.login ?? rebind.targetAccountId
            })`;
      toast('success', `Removed @${rebind.account.login} ${label}`);
      setRebind(null);
      setMode('list');
      await reload();
    } catch (e) {
      toast('error', (e as Error).message);
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
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[520px] panel-card p-4 shadow-raised">
          <Dialog.Title className="text-base font-semibold mb-3 tracking-tight">GitHub accounts</Dialog.Title>
          <Dialog.Description className="sr-only">
            Manage the GitHub accounts used to browse repositories and review pull requests.
          </Dialog.Description>

          {mode === 'oauth' && device ? (
            <div className="space-y-3">
              <p className="text-sm text-text-secondary">
                A browser window has been opened to{' '}
                <span className="font-mono">{device.verificationUri}</span>. Enter this code and authorize Differ:
              </p>
              <div className="flex items-center gap-2">
                <div className="font-mono text-2xl tracking-[0.3em] px-3 py-2 rounded bg-bg-subtle border border-border-subtle select-all">
                  {device.userCode}
                </div>
                <button className="btn h-9" onClick={() => void copyUserCode()}>
                  Copy
                </button>
                <button className="btn h-9" onClick={() => void api.openExternal(device.verificationUri)}>
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
                <button className="btn" onClick={() => setMode('list')}>
                  Back
                </button>
                <button className="btn-primary" disabled={busy || !token.trim()} onClick={() => void savePat()}>
                  Add account
                </button>
              </div>
            </div>
          ) : mode === 'rebind' && rebind ? (
            <div className="space-y-3">
              <p className="text-sm text-text-secondary">
                Removing <span className="text-accent">@{rebind.account.login}</span> will affect{' '}
                <strong>{rebind.repos.length}</strong> cloned{' '}
                {rebind.repos.length === 1 ? 'repository' : 'repositories'}. Choose where to rebind them:
              </p>
              <ul className="max-h-32 overflow-auto rounded border border-border-subtle bg-bg-subtle p-2 text-xs space-y-1">
                {rebind.repos.map((r) => (
                  <li key={r.id} className="font-mono">
                    {r.github_owner}/{r.github_repo}
                  </li>
                ))}
              </ul>
              <label className="block text-sm">
                <span className="block text-xs text-text-muted mb-1">Rebind to</span>
                <select
                  className="input"
                  value={rebind.targetAccountId == null ? '' : String(rebind.targetAccountId)}
                  onChange={(e) =>
                    setRebind({
                      ...rebind,
                      targetAccountId: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                >
                  <option value="">Leave unbound</option>
                  {accounts
                    .filter((a) => a.id !== rebind.account.id)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        @{a.login}
                      </option>
                    ))}
                </select>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn" onClick={() => { setRebind(null); setMode('list'); }}>
                  Cancel
                </button>
                <button className="btn-primary" disabled={busy} onClick={() => void confirmRebind()}>
                  Remove account
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {accounts.length === 0 ? (
                <p className="text-sm text-text-secondary">
                  Sign in to browse your repositories (including private and organization repos) and review pull
                  requests. You can add multiple accounts.
                </p>
              ) : (
                <ul className="space-y-2">
                  {accounts.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center gap-3 rounded border border-border-subtle bg-bg-subtle px-3 py-2"
                    >
                      {a.avatarUrl ? (
                        <img src={a.avatarUrl} alt={a.login} className="h-8 w-8 rounded-full" />
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-bg-muted text-xs flex items-center justify-center font-mono">
                          {a.login.slice(0, 2)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">@{a.login}</div>
                        <div className="text-xs text-text-muted font-mono truncate">
                          {a.scopes.length > 0 ? a.scopes.join(', ') : '(no scopes)'}
                        </div>
                      </div>
                      <button className="btn" disabled={busy} onClick={() => void askSignOut(a)}>
                        Sign out
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="grid gap-2 pt-1">
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
                  {accounts.length === 0 ? 'Sign in with GitHub' : 'Add another GitHub account'}
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
