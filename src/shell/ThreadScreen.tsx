import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FileDiff, FolderGit2, GitCompare, MessageSquare, Square, SquareTerminal } from 'lucide-react';
import type { ToolCallContent } from '@agentclientprotocol/sdk';
import { modelSelector, reduceThread, type ThreadSummary, type ThreadView } from '@shared/protocol';
import { EMPTY_RUNTIME, useAgentStore, type ThreadRef } from '../agent/store';
import { cn } from '../utils/cn';
import {
  Badge,
  Card,
  FloatingSurface,
  Kbd,
  MenuList,
  MenuRow,
  MenuSeparator,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ProgressRing,
  ProviderIcon,
  Segmented,
  Spinner,
} from '../ui';
import { Composer } from './Composer';
import { ConfigPicker } from './ConfigPicker';
import { DiffView } from './DiffView';
import { basename, diffStats, lineDiff, relPath, statusLabel, type DiffLine } from './format';
import { ErrorRow, NoticeRow, PermissionCard, PlanCard, Thought, ToolCallRow, TurnEnd } from './items';
import { Markdown } from './Markdown';

type Tab = 'conversation' | 'review' | 'terminal';

const fmtTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);

interface FileChange {
  path: string;
  lines: DiffLine[];
  added: number;
  removed: number;
}

/** Net change per file across every edit in the thread: first known old text → last new text. */
function collectChanges(view: ThreadView): FileChange[] {
  const files = new Map<string, { oldText: string | null; newText: string }>();
  for (const it of view.items) {
    if (it.type !== 'tool' || it.tool.status === 'failed') continue;
    for (const c of it.tool.content) {
      if (c.type !== 'diff') continue;
      const d = c as Extract<ToolCallContent, { type: 'diff' }>;
      const prev = files.get(d.path);
      files.set(d.path, { oldText: prev ? prev.oldText : (d.oldText ?? null), newText: d.newText });
    }
  }
  return [...files.entries()].map(([path, f]) => {
    const lines = lineDiff(f.oldText, f.newText);
    return { path, lines, ...diffStats(lines) };
  });
}

function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const onScroll = useCallback(() => {
    const el = ref.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return { ref, onScroll };
}

function useWide(threshold: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWide(e.contentRect.width >= threshold));
    ro.observe(el);
    return () => ro.disconnect();
  }, [threshold]);
  return { ref, wide };
}

function SessionCards({
  thread,
  view,
  tab,
  setTab,
  changes,
  wide,
  hostname,
  onStop,
}: {
  thread: ThreadSummary;
  view: ThreadView;
  tab: Tab;
  setTab: (t: Tab) => void;
  changes: FileChange[];
  wide: boolean;
  hostname: string | null;
  onStop: () => void;
}) {
  const busy = thread.status === 'running' || thread.status === 'waiting' || thread.status === 'starting';
  const usage = view.usage;
  const added = changes.reduce((n, c) => n + c.added, 0);
  const removed = changes.reduce((n, c) => n + c.removed, 0);
  const terminals = Object.keys(view.terminals).length;
  const mode = view.modes?.availableModes.find((m) => m.id === view.modes?.currentModeId)?.name;

  const contextRow = (
    <Popover>
      <PopoverTrigger asChild>
        <MenuRow
          leading={<ProgressRing value={usage ? usage.used / usage.size : 0} />}
          label="Context"
          value={usage ? `${fmtTokens(usage.used)} / ${fmtTokens(usage.size)}` : '—'}
          trailing="submenu"
        />
      </PopoverTrigger>
      <PopoverContent side="left" align="start" title="Context window" footer={<>Reported by the agent after each step</>}>
        {usage ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold">{fmtTokens(usage.used)}</span>
              <span className="font-mono text-xs text-text-muted">
                of {fmtTokens(usage.size)} tokens · {Math.round((usage.used / usage.size) * 100)}%
              </span>
            </div>
            <div className="h-2 rounded bg-bg overflow-hidden">
              <div className="h-full bg-accent" style={{ width: `${Math.min(100, (usage.used / usage.size) * 100)}%` }} />
            </div>
          </>
        ) : (
          <p className="text-sm text-text-secondary">This agent hasn’t reported context usage yet.</p>
        )}
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="absolute top-2.5 right-3.5 z-20 flex flex-col gap-1.5 items-stretch">
      <FloatingSurface className="p-1">
        <Segmented
          aria-label="Thread view"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'conversation', label: 'Conversation', icon: MessageSquare },
            { value: 'review', label: 'Review', icon: GitCompare, count: changes.length || undefined },
            { value: 'terminal', label: 'Terminal', icon: SquareTerminal, count: terminals || undefined },
          ]}
        />
      </FloatingSurface>
      {wide ? (
        <FloatingSurface>
          <MenuList>
            {contextRow}
            <MenuSeparator />
            <MenuRow leading={<ProviderIcon id={thread.agentId} name={view.agentName} size={16} />} label={view.agentName ?? 'Agent'} value={mode} tone="muted" />
            <MenuRow icon={FolderGit2} label={basename(thread.cwd)} value={hostname ?? undefined} tone="muted" title={thread.cwd} />
            <MenuRow
              icon={FileDiff}
              label="Changes"
              tone="muted"
              value={
                changes.length ? (
                  <>
                    <span className="text-success">+{added}</span> <span className="text-danger">−{removed}</span>
                  </>
                ) : (
                  'none'
                )
              }
              trailing={changes.length ? 'submenu' : undefined}
              onClick={changes.length ? () => setTab('review') : undefined}
            />
            {busy && (
              <>
                <MenuSeparator />
                <MenuRow icon={Square} label="Stop agent" tone="danger" value={<Kbd>⌃C</Kbd>} onClick={onStop} />
              </>
            )}
          </MenuList>
        </FloatingSurface>
      ) : (
        <FloatingSurface className="self-end flex items-center gap-1 p-1">
          <span className="flex items-center gap-1.5 px-2 h-7 font-mono text-xs text-text-secondary" title="Context window">
            <ProgressRing value={usage ? usage.used / usage.size : 0} />
            {usage ? `${Math.round((usage.used / usage.size) * 100)}%` : '—'}
          </span>
          {busy && (
            <button type="button" onClick={onStop} aria-label="Stop agent" className="w-7 h-7 rounded-lg grid place-items-center text-text-muted hover:bg-danger/10 hover:text-danger">
              <Square size={14} />
            </button>
          )}
        </FloatingSurface>
      )}
    </div>
  );
}

function Conversation({ thread, view }: { thread: ThreadRef; view: ThreadView }) {
  const respond = useAgentStore((s) => s.respondPermission);
  const agentName = view.agentName ?? 'The agent';
  const latestPending = view.pendingPermissions.at(-1);
  return (
    <>
      {view.items.map((it) => {
        switch (it.type) {
          case 'user':
            return (
              <div key={it.key} className="pl-3.5 border-l-2 border-border-strong text-md text-text-primary whitespace-pre-wrap select-text">
                {it.text}
              </div>
            );
          case 'agent':
            return <Markdown key={it.key} text={it.text} />;
          case 'thought':
            return <Thought key={it.key} text={it.text} />;
          case 'tool':
            return <ToolCallRow key={it.key} tool={it.tool} cwd={thread.cwd} terminals={view.terminals} />;
          case 'plan':
            return <PlanCard key={it.key} entries={it.entries} />;
          case 'permission':
            return (
              <PermissionCard
                key={it.key}
                item={it}
                agentName={agentName}
                cwd={thread.cwd}
                latest={it.requestId === latestPending}
                onRespond={(optionId) => respond(thread.envId, thread.id, it.requestId, optionId)}
              />
            );
          case 'notice':
            return <NoticeRow key={it.key} item={it} />;
          case 'error':
            return <ErrorRow key={it.key} message={it.message} />;
          case 'turn_end':
            return <TurnEnd key={it.key} stopReason={it.stopReason} />;
        }
      })}
      {(thread.status === 'running' || thread.status === 'starting') && (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Spinner size={14} />
          {thread.status === 'starting' ? `Starting ${view.agentName ?? 'agent'}…` : 'Working…'}
        </div>
      )}
    </>
  );
}

function Review({ thread, changes }: { thread: ThreadSummary; changes: FileChange[] }) {
  if (!changes.length) return <p className="text-text-muted">No file changes in this thread yet.</p>;
  return (
    <>
      <p className="text-sm text-text-muted">
        Net changes the agent reported in this thread. Files it changed with shell commands don’t appear here.
      </p>
      {changes.map((c) => (
        <Card key={c.path} className="overflow-hidden">
          <div className="flex items-center gap-2 px-4 h-10 border-b border-border">
            <span className="font-mono text-sm truncate">{relPath(c.path, thread.cwd)}</span>
            <span className="ml-auto font-mono text-xs">
              <span className="text-success">+{c.added}</span> <span className="text-danger">−{c.removed}</span>
            </span>
          </div>
          <DiffView lines={c.lines} />
        </Card>
      ))}
    </>
  );
}

function Terminals({ view }: { view: ThreadView }) {
  const list = Object.values(view.terminals);
  if (!list.length) return <p className="text-text-muted">The agent hasn’t run any commands in this thread.</p>;
  return (
    <>
      {list.map((t) => (
        <Card key={t.terminalId} className="overflow-hidden">
          <div className="flex items-center gap-2 px-4 h-10 border-b border-border font-mono text-sm">
            <span className="truncate">$ {t.command}</span>
            <span className="ml-auto text-xs">
              {t.running ? <Badge tone="accent" dot>Running</Badge> : t.exitCode === 0 ? <span className="text-success">exit 0</span> : <span className="text-danger">{t.signal ?? `exit ${t.exitCode}`}</span>}
            </span>
          </div>
          <pre className="px-4 py-3 max-h-[480px] overflow-auto font-mono text-xs leading-[1.6] text-text-secondary whitespace-pre-wrap select-text bg-bg">
            {t.truncated && <span className="text-text-muted">…earlier output trimmed{'\n'}</span>}
            {t.output || '(no output)'}
          </pre>
        </Card>
      ))}
    </>
  );
}

export function ThreadScreen({ thread, sidebarCollapsed = false }: { thread: ThreadRef; sidebarCollapsed?: boolean }) {
  const data = useAgentStore((s) => s.data[`${thread.envId}:${thread.id}`]);
  const runtime = useAgentStore((s) => s.envs[thread.envId]) ?? EMPTY_RUNTIME;
  const connected = runtime.status === 'open';
  const prompt = useAgentStore((s) => s.prompt);
  const cancel = useAgentStore((s) => s.cancel);
  const setConfig = useAgentStore((s) => s.setThreadConfig);
  const hidden = runtime.hiddenModels[thread.agentId] ?? [];
  const [tab, setTab] = useState<Tab>('conversation');
  const [error, setError] = useState<string | null>(null);

  const view = useMemo(() => reduceThread(data?.events ?? [], Object.values(data?.terminals ?? {})), [data]);
  const model = useMemo(() => modelSelector(view.configOptions), [view.configOptions]);
  const changes = useMemo(() => collectChanges(view), [view]);
  const busy = thread.status === 'running' || thread.status === 'waiting' || thread.status === 'starting';
  const scroll = useStickToBottom(`${tab}:${data?.events.length}:${Object.values(data?.terminals ?? {}).map((t) => t.output.length).join()}`);
  // Full info card only when it fits beside the 720px column (column + 2 × (card 340 + gutters)).
  const { ref: sizeRef, wide } = useWide(1480);

  useEffect(() => setTab('conversation'), [thread.id]);

  const stop = useCallback(() => void cancel(thread.envId, thread.id), [cancel, thread.envId, thread.id]);

  const changeModel = async (value: string) => {
    if (!model) return;
    setError(null);
    try {
      await setConfig(thread.envId, thread.id, model.configId, value);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.metaKey && e.key === 'c' && !window.getSelection()?.toString()) {
        e.preventDefault();
        stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, stop]);

  return (
    <div ref={sizeRef} className="relative h-full grid grid-rows-[52px_minmax(0,1fr)_auto] min-w-0">
      <header className={cn('flex items-center gap-2 min-w-0 drag-region pr-[380px]', sidebarCollapsed ? 'pl-11' : 'pl-5')}>
        <h1 className="text-base font-medium truncate">{view.title ?? thread.title}</h1>
        {thread.status !== 'idle' && <span className="text-xs text-text-muted shrink-0">· {statusLabel[thread.status]}</span>}
      </header>

      <SessionCards thread={thread} view={view} tab={tab} setTab={setTab} changes={changes} wide={wide} hostname={runtime.hostname} onStop={stop} />

      <div ref={scroll.ref} onScroll={scroll.onScroll} className="overflow-y-auto">
        <div className="max-w-[720px] mx-auto px-8 pt-6 pb-10 flex flex-col gap-5">
          {!data?.loaded ? (
            <div className="flex items-center gap-2 text-text-muted">
              <Spinner /> Loading thread…
            </div>
          ) : tab === 'conversation' ? (
            <Conversation thread={thread} view={view} />
          ) : tab === 'review' ? (
            <Review thread={thread} changes={changes} />
          ) : (
            <Terminals view={view} />
          )}
        </div>
      </div>

      <div className="px-8 pb-5 pt-2">
        <div className="max-w-[720px] mx-auto">
          <Composer
            placeholder={busy ? `${view.agentName ?? 'The agent'} is working…` : `Reply to ${view.agentName ?? 'the agent'}`}
            running={busy}
            onStop={stop}
            disabled={!connected}
            autoFocus
            error={error}
            onSend={async (text) => {
              setError(null);
              try {
                await prompt(thread.envId, thread.id, text);
                setTab('conversation');
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
                throw err;
              }
            }}
            footer={
              <div className="flex items-center gap-1.5">
                <span className="flex items-center gap-1.5 px-2 h-7 text-sm text-text-secondary">
                  <ProviderIcon id={thread.agentId} name={view.agentName} size={14} /> {view.agentName ?? 'Agent'}
                </span>
                {model && <ConfigPicker selector={model} value={model.current} disabled={busy} hidden={hidden} onChange={(value) => void changeModel(value)} />}
                <span className="flex items-center gap-1.5 px-2 h-7">
                  <span className="font-mono text-xs text-text-muted truncate max-w-[200px]" title={thread.cwd}>
                    {basename(thread.cwd)}
                  </span>
                </span>
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}
