import React, { useEffect, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useApp } from '../state/AppStore';
import { api } from '../api';
import type { BranchInfo } from '@shared/types';

export default function BranchMenu() {
  const { state, refresh, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open || !state.repo) return;
    api.branches(state.repo.id).then(setBranches).catch((e) => toast('error', e.message));
  }, [open, state.repo, toast]);

  if (!state.repo || !state.status) return null;
  const current = state.status.branch ?? (state.status.detached ? 'DETACHED' : '?');

  const doCheckout = async (b: string) => {
    try {
      await api.checkout(state.repo!.id, b);
      await refresh();
      toast('success', `Checked out ${b}`);
    } catch (e) {
      toast('error', (e as Error).message);
    }
    handleOpenChange(false);
  };

  const doCreate = async () => {
    if (pending) return;
    const name = newName.trim();
    if (!name) return;
    setPending(true);
    try {
      await api.createBranch(state.repo!.id, name, true);
      await refresh();
      toast('success', `Created ${name}`);
      handleOpenChange(false);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setPending(false);
    }
  };

  // Reset the create form whenever the menu closes so a half-filled form does
  // not survive to the next open.
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setCreating(false);
      setNewName('');
    }
  };

  return (
    <DropdownMenu.Root open={open} onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button className="chip-selected">
          <span className="text-accent mr-1">⎇</span>
          {current}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[280px] bg-bg-panel border border-border rounded-card shadow-raised p-1"
          sideOffset={6}
          // While the create form is open, Escape should only close the form
          // (handled on the input), not dismiss the whole menu via Radix's
          // document-level escape listener.
          onEscapeKeyDown={(e) => {
            if (creating) e.preventDefault();
          }}
        >
          {branches.map((b) => (
            <DropdownMenu.Item
              key={b.name}
              className="px-2.5 py-1.5 text-sm rounded-md cursor-pointer outline-none data-[highlighted]:bg-bg-subtle"
              onSelect={() => void doCheckout(b.name)}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[12.5px]">
                  {b.isCurrent && <span className="text-accent mr-1">●</span>}
                  {b.name}
                </span>
                {b.upstream && (
                  <span className="text-[11px] text-text-muted tabular-nums">
                    {b.upstream}
                    {b.ahead ? ` ↑${b.ahead}` : ''}
                    {b.behind ? ` ↓${b.behind}` : ''}
                  </span>
                )}
              </div>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          {!creating ? (
            <DropdownMenu.Item
              className="px-2.5 py-1.5 text-sm rounded-md cursor-pointer outline-none data-[highlighted]:bg-bg-subtle text-accent"
              onSelect={(e) => {
                e.preventDefault();
                setCreating(true);
              }}
            >
              + New branch
            </DropdownMenu.Item>
          ) : (
            <div className="p-1 flex items-center gap-2">
              <input
                className="input"
                placeholder="new-branch-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                // Stop keydown from bubbling to Radix's Menu typeahead, which
                // would otherwise focus a branch item whose name shares a prefix
                // with what's being typed and steal focus from this input.
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') void doCreate();
                  if (e.key === 'Escape') {
                    setCreating(false);
                    setNewName('');
                  }
                }}
              />
              <button
                className="btn-primary"
                disabled={pending || !newName.trim()}
                onClick={() => void doCreate()}
              >
                Create
              </button>
            </div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
