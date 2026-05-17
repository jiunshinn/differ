import React, { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from '../api';
import { useApp } from '../state/AppStore';
import type { Repository } from '@shared/types';

interface Props {
  onClose: () => void;
  initialUrl?: string;
  initialFolderName?: string;
  initialUseAuthToken?: boolean;
  onCloned?: (repo: Repository) => void;
}

function deriveFolderName(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  const noGit = trimmed.replace(/\.git$/i, '');
  const parts = noGit.split(/[/:]/);
  return (parts[parts.length - 1] || '').trim();
}

export default function CloneFromUrlDialog({
  onClose,
  initialUrl = '',
  initialFolderName,
  initialUseAuthToken = true,
  onCloned,
}: Props) {
  const { dispatch, toast, refresh } = useApp();
  const [url, setUrl] = useState(initialUrl);
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [folderName, setFolderName] = useState(initialFolderName ?? deriveFolderName(initialUrl));
  const [useToken, setUseToken] = useState(initialUseAuthToken);
  const [authed, setAuthed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.ghAuthStatus().then((s) => setAuthed(s.authenticated));
  }, []);

  // Re-derive folder name when URL changes — but only if the user hasn't customized it.
  const userEditedFolder = React.useRef(false);
  useEffect(() => {
    if (!userEditedFolder.current) {
      setFolderName(deriveFolderName(url));
    }
  }, [url]);

  const pickParent = async () => {
    const dir = await api.pickDirectory('Choose a folder to clone into');
    if (dir) setParentDir(dir);
  };

  const submit = async () => {
    if (!url.trim()) {
      toast('error', 'Remote URL is required');
      return;
    }
    if (!parentDir) {
      toast('error', 'Choose a parent folder');
      return;
    }
    const name = folderName.trim() || deriveFolderName(url);
    if (!name) {
      toast('error', 'Could not determine a folder name');
      return;
    }
    setBusy(true);
    try {
      const repo = await api.cloneRepo({
        remoteUrl: url.trim(),
        parentDir,
        folderName: name,
        useAuthToken: useToken && authed,
      });
      toast('success', `Cloned ${repo.name}`);
      if (onCloned) {
        onCloned(repo);
      } else {
        dispatch({ type: 'setRepo', repo });
        dispatch({ type: 'setSession', session: null });
        dispatch({ type: 'view', view: 'local' });
        await refresh();
      }
      onClose();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[520px] panel-card p-4 shadow-raised">
          <Dialog.Title className="text-base font-semibold mb-3 tracking-tight">Clone repository</Dialog.Title>
          <div className="space-y-3">
            <label className="block">
              <div className="section-label mb-1">Remote URL</div>
              <input
                className="input font-mono"
                placeholder="https://github.com/owner/repo.git or git@github.com:owner/repo.git"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoFocus
              />
            </label>

            <div>
              <div className="section-label mb-1">Parent folder</div>
              <div className="flex gap-2">
                <input
                  className="input font-mono flex-1"
                  placeholder="/path/to/parent"
                  value={parentDir ?? ''}
                  onChange={(e) => setParentDir(e.target.value || null)}
                />
                <button className="btn" onClick={() => void pickParent()} disabled={busy}>
                  Browse…
                </button>
              </div>
            </div>

            <label className="block">
              <div className="section-label mb-1">Folder name</div>
              <input
                className="input font-mono"
                placeholder="repo"
                value={folderName}
                onChange={(e) => {
                  userEditedFolder.current = true;
                  setFolderName(e.target.value);
                }}
              />
              {parentDir && folderName && (
                <div className="text-xs text-text-muted mt-1 font-mono truncate">
                  Will clone into: {parentDir}/{folderName}
                </div>
              )}
            </label>

            {authed && /^https?:\/\/github\.com\//i.test(url) && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useToken}
                  onChange={(e) => setUseToken(e.target.checked)}
                />
                Use my GitHub credentials for this clone
              </label>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={busy || !url.trim() || !parentDir}
                onClick={() => void submit()}
              >
                {busy ? 'Cloning…' : 'Clone'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
