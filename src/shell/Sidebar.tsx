import { useEffect, useMemo, useState } from 'react';
import { FolderPlus, Laptop, MessageSquare, MoreHorizontal, PanelLeft, Pencil, Server, Settings, SquarePen, Trash2 } from 'lucide-react';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { EMPTY_RUNTIME, threadKey, useAgentStore, type ThreadRef } from '../agent/store';
import { IconButton, StatusDot, Tooltip } from '../ui';
import { cn } from '../utils/cn';
import AddProjectDialog from '../components/AddProjectDialog';
import { basename, relativeTime, statusDot, statusLabel } from './format';

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function groupThreads(threads: ThreadRef[]) {
  return [
    { title: 'Needs you', items: threads.filter((t) => t.status === 'waiting') },
    { title: 'Working', items: threads.filter((t) => t.status === 'running' || t.status === 'starting') },
    { title: 'Earlier', items: threads.filter((t) => t.status === 'idle' || t.status === 'failed') },
  ].filter((g) => g.items.length > 0);
}

function ThreadRow({
  t,
  machine,
  selected,
  collapsed,
  now,
  onSelect,
}: {
  t: ThreadRef;
  /** The machine's display name, shown when more than one is configured. */
  machine?: string;
  selected: boolean;
  collapsed: boolean;
  now: number;
  onSelect: () => void;
}) {
  const rename = useAgentStore((s) => s.rename);
  const remove = useAgentStore((s) => s.remove);
  const meta =
    t.status === 'waiting' ? (
      <span className="text-warn">{statusLabel.waiting}</span>
    ) : t.status === 'failed' ? (
      <span className="text-danger">{statusLabel.failed}</span>
    ) : (
      <>{t.status === 'idle' ? relativeTime(t.updatedAt, now) : statusLabel[t.status]}</>
    );

  if (collapsed) {
    const label = `${t.title} · ${statusLabel[t.status]}${machine ? ` · ${machine}` : ''}`;
    return (
      <Tooltip content={label} side="right">
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? 'page' : undefined}
          aria-label={label}
          className={cn(
            'relative h-9 w-full flex items-center justify-center gap-1.5 transition-colors duration-fast',
            selected ? 'bg-bg-raised text-text-primary' : 'text-text-muted hover:bg-bg-hover hover:text-text-secondary',
          )}
        >
          {selected && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-accent" />}
          <StatusDot status={statusDot(t.status)} />
          <MessageSquare size={15} strokeWidth={1.75} aria-hidden />
        </button>
      </Tooltip>
    );
  }

  const row = (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'group/row text-left rounded-lg transition-colors duration-fast w-full grid grid-cols-[16px_minmax(0,1fr)_auto] gap-x-2.5 px-2.5 py-[7px]',
        selected ? 'bg-bg-raised shadow-[inset_0_0_0_1px_rgb(var(--color-border-strong))]' : 'hover:bg-bg-hover',
      )}
    >
      <span className="grid place-items-center row-span-2 h-[21px]">
        <StatusDot status={statusDot(t.status)} />
      </span>
      <span className={cn('truncate text-base font-medium', selected ? 'text-text-primary' : 'text-text-secondary')}>{t.title}</span>
      <span className="row-span-2 self-center w-6" />
      <span className="truncate text-sm text-text-muted">
        {meta} · {basename(t.cwd)}
        {machine ? <span className="text-text-faint"> · {machine}</span> : null}
      </span>
    </button>
  );

  return (
    <div className="relative group">
      {row}
      <Dropdown.Root>
        <Dropdown.Trigger asChild>
          <button
            type="button"
            aria-label={`More actions for ${t.title}`}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md grid place-items-center text-text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 hover:bg-bg-hover hover:text-text-primary"
          >
            <MoreHorizontal size={15} />
          </button>
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content align="start" sideOffset={4} className="z-50 min-w-[160px] p-1.5 rounded-xl border border-border-strong bg-bg-raised shadow-popover animate-pop-in">
            <Dropdown.Item
              className="flex items-center gap-2.5 h-8 px-2.5 rounded-md text-sm outline-none data-[highlighted]:bg-bg-hover"
              onSelect={() => {
                const title = window.prompt('Rename thread', t.title);
                if (title?.trim()) void rename(t.envId, t.id, title);
              }}
            >
              <Pencil size={14} className="text-text-muted" /> Rename
            </Dropdown.Item>
            <Dropdown.Item
              className="flex items-center gap-2.5 h-8 rounded-md px-2.5 text-sm text-danger outline-none data-[highlighted]:bg-danger/10"
              onSelect={() => {
                if (window.confirm(`Delete “${t.title}”? This stops the agent and removes the conversation. Files it changed stay as they are.`)) void remove(t.envId, t.id);
              }}
            >
              <Trash2 size={14} /> Delete
            </Dropdown.Item>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
    </div>
  );
}

const envStatusColor = (status: string) =>
  status === 'open' ? 'bg-success' : status === 'connecting' ? 'bg-warn' : 'bg-danger';

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const threads = useAgentStore((s) => s.threads);
  const environments = useAgentStore((s) => s.environments);
  const envs = useAgentStore((s) => s.envs);
  const selectedKey = useAgentStore((s) => s.selectedKey);
  const select = useAgentStore((s) => s.select);
  const openNewThread = useAgentStore((s) => s.openNewThread);
  const settingsOpen = useAgentStore((s) => s.settingsOpen);
  const openSettings = useAgentStore((s) => s.openSettings);
  const now = useNow();

  const [addProjectOpen, setAddProjectOpen] = useState(false);

  const machineList = environments.environments;
  const multi = machineList.length > 1;
  const machineName = (envId: string) => {
    const env = machineList.find((e) => e.id === envId);
    return env ? (env.kind === 'local' ? 'This Mac' : env.name) : envId;
  };

  const sections = useMemo(
    () =>
      machineList.map((env) => ({
        env,
        runtime: envs[env.id] ?? EMPTY_RUNTIME,
        groups: groupThreads(threads.filter((t) => t.envId === env.id)),
      })),
    [machineList, envs, threads],
  );

  const connectedCount = machineList.filter((e) => (envs[e.id] ?? EMPTY_RUNTIME).status === 'open').length;
  const anyConnecting = machineList.some((e) => (envs[e.id] ?? EMPTY_RUNTIME).status === 'connecting');
  const footerDot = connectedCount > 0 ? 'bg-success' : anyConnecting ? 'bg-warn' : 'bg-danger';
  const footerLabel =
    connectedCount === 0
      ? anyConnecting
        ? 'connecting…'
        : 'offline'
      : multi
        ? `${connectedCount}/${machineList.length} machines`
        : (envs[machineList[0]?.id ?? 'local']?.hostname?.split('.')[0] ?? 'local');

  const pickProject = (folder: string, environmentId: string) => {
    openNewThread(environmentId, folder);
  };

  return (
    <aside className="h-full min-h-0 flex flex-col bg-bg-panel border-r border-border overflow-hidden">
      {/* Folded, this strip is reserved for the traffic lights and stays empty;
          the expand control lives in the content header (AppShell). */}
      <div className={cn('shrink-0 drag-region', collapsed ? 'h-[46px]' : 'h-[46px] flex items-center justify-end pr-2.5')}>
        {!collapsed && (
          <IconButton icon={PanelLeft} label="Collapse sidebar" shortcut="⌘B" onClick={onToggle} className="no-drag" />
        )}
      </div>

      <div className={cn('flex shrink-0 items-center gap-1.5', collapsed ? 'justify-center' : 'px-2.5')}>
        <IconButton
          icon={SquarePen}
          label="New thread"
          shortcut="⌘N"
          variant={collapsed ? 'ghost' : 'secondary'}
          size="lg"
          onClick={() => openNewThread()}
        />
        <IconButton
          icon={FolderPlus}
          label="Add project"
          variant={collapsed ? 'ghost' : 'secondary'}
          size="lg"
          onClick={() => setAddProjectOpen(true)}
        />
      </div>

      <div className={cn('flex-1 min-h-0 overflow-y-auto pb-3 mt-2 border-t border-border', collapsed ? 'px-0 pt-2' : 'px-2.5')}>
        {threads.length === 0 && !collapsed && (
          <p className="px-2.5 pt-4 text-sm text-text-muted">No threads yet. Start one with New thread.</p>
        )}

        {sections.map(({ env, runtime, groups }) => (
          <div key={env.id}>
            {multi && !collapsed && (
              <div className="flex items-center gap-1.5 px-2.5 pt-3.5 pb-1">
                {env.kind === 'local' ? (
                  <Laptop size={13} strokeWidth={1.75} className="shrink-0 text-text-muted" aria-hidden />
                ) : (
                  <Server size={13} strokeWidth={1.75} className="shrink-0 text-text-muted" aria-hidden />
                )}
                <span className="truncate text-sm font-medium text-text-muted">{machineName(env.id)}</span>
                <span
                  className={cn('ml-auto w-1.5 h-1.5 rounded-full shrink-0', envStatusColor(runtime.status))}
                  title={runtime.error ?? runtime.status}
                />
              </div>
            )}
            {!multi && groups.map((g) => (
              <div key={g.title}>
                {!collapsed && (
                  <div className="flex items-center px-2.5 pt-3.5 pb-1.5 text-sm font-medium text-text-muted">
                    {g.title}
                    <span className="ml-1.5 font-mono text-xs">{g.items.length}</span>
                  </div>
                )}
                <div className={cn('flex flex-col', collapsed ? 'gap-0.5 pt-2' : 'gap-px')}>
                  {g.items.map((t) => (
                    <ThreadRow
                      key={threadKey(t.envId, t.id)}
                      t={t}
                      selected={threadKey(t.envId, t.id) === selectedKey}
                      collapsed={collapsed}
                      now={now}
                      onSelect={() => select(t.envId, t.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
            {multi &&
              !collapsed &&
              groups.map((g) => (
                <div key={g.title}>
                  {!collapsed && (
                    <div className="flex items-center pl-6 pr-2.5 pt-2 pb-1 text-2xs font-medium uppercase tracking-[0.06em] text-text-faint">
                      {g.title}
                      <span className="ml-1.5 font-mono">{g.items.length}</span>
                    </div>
                  )}
                  <div className={cn('flex flex-col', collapsed ? 'gap-0.5 pt-1' : 'gap-px')}>
                    {g.items.map((t) => (
                      <ThreadRow
                        key={threadKey(t.envId, t.id)}
                        t={t}
                        selected={threadKey(t.envId, t.id) === selectedKey}
                        collapsed={collapsed}
                        now={now}
                        onSelect={() => select(t.envId, t.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            {multi && collapsed &&
              threads
                .filter((t) => t.envId === env.id)
                .map((t) => (
                  <ThreadRow
                    key={threadKey(t.envId, t.id)}
                    t={t}
                    machine={machineName(t.envId)}
                    selected={threadKey(t.envId, t.id) === selectedKey}
                    collapsed
                    now={now}
                    onSelect={() => select(t.envId, t.id)}
                  />
                ))}
          </div>
        ))}
      </div>

      <div className={cn('shrink-0 border-t border-border', collapsed ? 'flex justify-center py-2' : 'px-2.5 py-2')}>
        {collapsed ? (
          <IconButton icon={Settings} label="Settings" shortcut="⌘," onClick={() => openSettings(true)} active={settingsOpen} />
        ) : (
          <button
            type="button"
            onClick={() => openSettings(true)}
            aria-current={settingsOpen ? 'page' : undefined}
            className={cn(
              'w-full h-[30px] flex items-center gap-2.5 px-2.5 rounded-[7px] text-base font-medium transition-colors duration-fast',
              settingsOpen ? 'bg-bg-raised text-text-primary' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
            )}
          >
            <Settings size={16} strokeWidth={1.75} className={settingsOpen ? 'text-accent' : undefined} />
            Settings
            <span className="ml-auto flex items-center gap-1.5 font-mono text-2xs text-text-muted" title={`${connectedCount} connected`}>
              <span className={cn('w-1.5 h-1.5 rounded-full', footerDot)} />
              {footerLabel}
            </span>
          </button>
        )}
      </div>

      {addProjectOpen && (
        <AddProjectDialog mode="folder" onClose={() => setAddProjectOpen(false)} onPicked={pickProject} />
      )}
    </aside>
  );
}
