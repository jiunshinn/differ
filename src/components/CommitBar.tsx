import React, { useMemo, useState } from 'react';
import { useApp } from '../state/AppStore';
import { api } from '../api';

export default function CommitBar() {
  const { state, refresh, toast } = useApp();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const stagedCount = useMemo(
    () => state.files.filter((f) => f.group === 'staged').length,
    [state.files],
  );

  const commit = async () => {
    if (!state.repo) return;
    if (!message.trim()) {
      toast('error', 'Commit message is empty');
      return;
    }
    if (stagedCount === 0) {
      toast('error', 'Nothing staged to commit');
      return;
    }
    setBusy(true);
    try {
      await api.commit(state.repo.id, message.trim());
      setMessage('');
      await refresh();
      toast('success', 'Committed');
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const amend = async () => {
    if (!state.repo) return;
    setBusy(true);
    try {
      await api.amend(state.repo.id, message.trim() || null);
      setMessage('');
      await refresh();
      toast('success', 'Amended last commit');
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-2 border-t border-border bg-bg-panel">
      <div className="text-xs text-text-muted mb-1">
        Staged: <span className="text-text-secondary">{stagedCount}</span>
      </div>
      <textarea
        className="input font-mono min-h-[68px] resize-y"
        placeholder="Commit message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void commit();
        }}
      />
      <div className="mt-2 flex gap-1">
        <button className="btn-primary flex-1" disabled={busy} onClick={() => void commit()}>
          Commit <span className="kbd ml-1">⌘↵</span>
        </button>
        <button className="btn" disabled={busy} onClick={() => void amend()}>
          Amend
        </button>
      </div>
    </div>
  );
}
