import React, { useMemo, useState } from 'react';
import { useApp } from '../state/AppStore';
import { useAmendMutation, useCommitMutation } from '../query/hooks';

export default function CommitBar() {
  const { state, refresh, toast, logActivity } = useApp();
  const [message, setMessage] = useState('');
  const repoId = state.repo?.id ?? null;
  const commitMutation = useCommitMutation(repoId);
  const amendMutation = useAmendMutation(repoId);
  const busy = commitMutation.isPending || amendMutation.isPending;
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
    try {
      await commitMutation.mutateAsync(message.trim());
      const subject = message.trim().split('\n')[0]!;
      setMessage('');
      await refresh();
      toast('success', 'Committed');
      logActivity({ kind: 'commit', message: 'Commit', detail: subject });
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const amend = async () => {
    if (!state.repo) return;
    try {
      await amendMutation.mutateAsync(message.trim() || null);
      setMessage('');
      await refresh();
      toast('success', 'Amended last commit');
      logActivity({ kind: 'commit', message: 'Amended last commit' });
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  return (
    <section className="panel-card p-3">
      <div className="flex items-center justify-between mb-2.5">
        <div className="font-semibold tracking-tight">Commit draft</div>
        <span className="text-xs text-text-muted font-mono tabular-nums">{stagedCount} staged</span>
      </div>
      <textarea
        className="input min-h-[72px] resize-none font-sans leading-5"
        placeholder="Commit message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void commit();
        }}
      />
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <button className="btn" disabled={busy} onClick={() => void amend()}>
          Amend
        </button>
        <button className="btn-primary" disabled={busy} onClick={() => void commit()}>
          Commit
        </button>
      </div>
    </section>
  );
}
