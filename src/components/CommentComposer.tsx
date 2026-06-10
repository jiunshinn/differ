import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useApp } from '../state/AppStore';
import { cn } from '../utils/cn';
import { useCreateCommentMutation } from '../query/hooks';
import type { CommentLabel, CommentTargetKind } from '@shared/types';

const LABELS: { label: string; value: CommentLabel }[] = [
  { label: '—', value: null },
  { label: 'issue', value: 'issue' },
  { label: 'question', value: 'question' },
  { label: 'refactor', value: 'refactor' },
  { label: 'test', value: 'test' },
  { label: 'ask-ai', value: 'ask-ai' },
];

export default function CommentComposer({
  filePath,
  target,
  side,
  line,
  hunkHeader,
  onClose,
}: {
  filePath: string;
  target: CommentTargetKind;
  side: 'old' | 'new' | 'none';
  line: number | null;
  hunkHeader: string | null;
  onClose: () => void;
}) {
  const { state, logActivity, toast } = useApp();
  const [body, setBody] = useState('');
  const [label, setLabel] = useState<CommentLabel>(null);

  const sessionId = state.session?.id;
  const createComment = useCreateCommentMutation(sessionId ?? null);
  const busy = createComment.isPending;

  const save = async () => {
    if (!sessionId) return;
    if (!body.trim()) {
      toast('error', 'Comment cannot be empty');
      return;
    }
    try {
      await createComment.mutateAsync({
        file_path: filePath,
        target_kind: target,
        diff_side: side,
        line_number: line,
        hunk_header: hunkHeader,
        body: body.trim(),
        label,
      });
      logActivity({
        kind: 'comment_created',
        message: `Added ${target} comment`,
        detail: target === 'line' && line ? `${filePath} L${line}` : filePath,
      });
      onClose();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const anchorLabel =
    target === 'file'
      ? 'File-level comment'
      : target === 'hunk'
      ? `Hunk comment ${hunkHeader ?? ''}`
      : `Line comment ${side === 'old' ? '−' : '+'}${line}`;

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[560px] panel-card p-4 shadow-raised">
          <Dialog.Title className="text-base font-semibold mb-1 tracking-tight">{anchorLabel}</Dialog.Title>
          <div className="text-xs text-text-muted mb-3 font-mono truncate">{filePath}</div>
          <textarea
            className="input min-h-[140px] font-sans"
            placeholder="Leave a comment. Mark as ask-ai to feed into the context bundle."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void save();
            }}
          />
          <div className="mt-3 flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-text-muted mr-1">Label:</span>
            {LABELS.map((l) => (
              <button
                key={l.label}
                className={cn(
                  'btn-ghost h-7 px-2 text-xs',
                  label === l.value && 'bg-bg-subtle text-accent border-accent border',
                )}
                onClick={() => setLabel(l.value)}
              >
                {l.label}
              </button>
            ))}
            <div className="flex-1" />
            <button className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn-primary" disabled={busy || !body.trim()} onClick={() => void save()}>
              Save comment <span className="kbd ml-1">⌘↵</span>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
