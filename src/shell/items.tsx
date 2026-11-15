import { useEffect, useState } from 'react';
import {
  ArrowRightLeft,
  Brain,
  Check,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  FilePen,
  FileText,
  Globe,
  Info,
  ListChecks,
  Search,
  ShieldAlert,
  Terminal as TerminalIcon,
  ToggleLeft,
  Trash2,
  TriangleAlert,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { PermissionOption, PlanEntry, ToolCallContent, ToolCallUpdate, ToolKind } from '@agentclientprotocol/sdk';
import type { TerminalState, ThreadItem, ToolCallView } from '@shared/protocol';
import { Button, Card, Spinner } from '../ui';
import { cn } from '../utils/cn';
import { DiffView, useDiff } from './DiffView';
import { diffStats, lineDiff, relPath } from './format';
import { Markdown } from './Markdown';

const kindIcon: Record<ToolKind, LucideIcon> = {
  read: FileText,
  edit: FilePen,
  delete: Trash2,
  move: ArrowRightLeft,
  search: Search,
  execute: TerminalIcon,
  think: Brain,
  fetch: Globe,
  switch_mode: ToggleLeft,
  other: Wrench,
};

function TerminalOutput({ terminal }: { terminal: TerminalState | undefined }) {
  if (!terminal) return <div className="px-3 py-2 text-xs text-text-muted">Output is no longer available.</div>;
  return (
    <div className="bg-bg">
      <div className="flex items-center gap-2 px-3 pt-2 font-mono text-xs text-text-muted">
        <span className="truncate">$ {terminal.command}</span>
        <span className="ml-auto shrink-0">
          {terminal.running ? (
            <Spinner size={12} />
          ) : terminal.exitCode === 0 ? (
            <span className="text-success">exit 0</span>
          ) : (
            <span className="text-danger">{terminal.signal ?? `exit ${terminal.exitCode}`}</span>
          )}
        </span>
      </div>
      <pre className="px-3 py-2 max-h-72 overflow-auto font-mono text-xs leading-[1.6] text-text-secondary whitespace-pre-wrap select-text">
        {terminal.truncated && <span className="text-text-muted">…earlier output trimmed{'\n'}</span>}
        {terminal.output || (terminal.running ? '' : '(no output)')}
      </pre>
    </div>
  );
}

function ContentBlock({ c, cwd, terminals }: { c: ToolCallContent; cwd: string; terminals: Record<string, TerminalState> }) {
  const diff = useDiff(c.type === 'diff' ? c.oldText : null, c.type === 'diff' ? c.newText : '');
  if (c.type === 'diff') {
    return (
      <div>
        <div className="px-3 py-1.5 font-mono text-xs text-text-muted border-b border-border">{relPath(c.path, cwd)}</div>
        <DiffView lines={diff} className="max-h-96 overflow-y-auto" />
      </div>
    );
  }
  if (c.type === 'terminal') return <TerminalOutput terminal={terminals[c.terminalId]} />;
  if (c.content.type === 'text') {
    return (
      <div className="px-3 py-2 text-sm">
        <Markdown text={c.content.text} />
      </div>
    );
  }
  return null;
}

function statusIcon(tool: ToolCallView) {
  if (tool.status === 'pending' || tool.status === 'in_progress') return <Spinner size={13} className="text-text-muted" />;
  if (tool.status === 'failed') return <X size={14} className="text-danger" aria-label="Failed" />;
  return <Check size={14} className="text-text-muted" aria-label="Done" />;
}

export function ToolCallRow({ tool, cwd, terminals }: { tool: ToolCallView; cwd: string; terminals: Record<string, TerminalState> }) {
  const Icon = kindIcon[tool.kind] ?? Wrench;
  const hasTerminal = tool.content.some((c) => c.type === 'terminal');
  const running = tool.status === 'pending' || tool.status === 'in_progress';
  // Commands stay open while they run so you can watch the output.
  const [open, setOpen] = useState(hasTerminal && running);
  useEffect(() => {
    if (hasTerminal && running) setOpen(true);
  }, [hasTerminal, running]);

  const diffs = tool.content.filter((c): c is Extract<ToolCallContent, { type: 'diff' }> => c.type === 'diff');
  const stats = diffs.reduce(
    (acc, d) => {
      const s = diffStats(lineDiff(d.oldText, d.newText));
      return { added: acc.added + s.added, removed: acc.removed + s.removed };
    },
    { added: 0, removed: 0 },
  );
  const location = tool.locations[0]?.path;
  const expandable = tool.content.length > 0;

  return (
    <div className={cn('rounded-lg border border-border bg-bg-panel overflow-hidden', tool.status === 'failed' && 'border-danger/30')}>
      <button
        type="button"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setOpen((v) => !v)}
        className="w-full grid grid-cols-[22px_minmax(0,1fr)_auto_14px] items-center gap-2.5 px-3 h-9 text-left text-sm hover:bg-bg-hover/60 disabled:hover:bg-transparent transition-colors duration-fast"
      >
        <span className="w-[22px] h-[22px] rounded-md bg-bg-raised grid place-items-center text-text-muted">
          <Icon size={13} strokeWidth={1.75} />
        </span>
        <span className="truncate text-text-secondary">
          <span className="text-text-primary">{tool.title}</span>
          {location && !tool.title.includes(relPath(location, cwd)) && (
            <span className="ml-2 font-mono text-xs text-text-muted">{relPath(location, cwd)}</span>
          )}
        </span>
        <span className="flex items-center gap-2 font-mono text-xs">
          {(stats.added > 0 || stats.removed > 0) && (
            <span>
              <span className="text-success">+{stats.added}</span> <span className="text-danger">−{stats.removed}</span>
            </span>
          )}
          {statusIcon(tool)}
        </span>
        <ChevronRight size={14} className={cn('text-text-muted transition-transform duration-fast', open && 'rotate-90', !expandable && 'opacity-0')} />
      </button>
      {open && expandable && (
        <div className="border-t border-border divide-y divide-border">
          {tool.content.map((c, i) => (
            <ContentBlock key={i} c={c} cwd={cwd} terminals={terminals} />
          ))}
        </div>
      )}
    </div>
  );
}

const planIcon = { completed: Check, in_progress: CircleDashed, pending: CircleDashed } as const;

export function PlanCard({ entries }: { entries: PlanEntry[] }) {
  const done = entries.filter((e) => e.status === 'completed').length;
  return (
    <Card className="px-4 py-3">
      <div className="flex items-center gap-2 mb-2 text-sm font-medium">
        <ListChecks size={15} className="text-text-muted" />
        Plan
        <span className="ml-auto font-mono text-xs text-text-muted">
          {done}/{entries.length}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {entries.map((e, i) => {
          const Icon = planIcon[e.status];
          return (
            <li key={i} className={cn('flex items-start gap-2.5 text-sm', e.status === 'completed' ? 'text-text-muted line-through decoration-text-faint' : 'text-text-secondary', e.status === 'in_progress' && 'text-text-primary')}>
              <Icon size={14} className={cn('mt-[3px] shrink-0', e.status === 'completed' ? 'text-success' : e.status === 'in_progress' ? 'text-accent' : 'text-text-faint')} />
              {e.content}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function Thought({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-left group">
      <span className="flex items-center gap-1.5 text-sm text-text-muted group-hover:text-text-secondary">
        <Brain size={14} />
        Thinking
        <ChevronRight size={13} className={cn('transition-transform duration-fast', open && 'rotate-90')} />
      </span>
      {open ? (
        <span className="block mt-1.5 pl-3 border-l-2 border-border-strong text-sm text-text-muted whitespace-pre-wrap select-text">{text}</span>
      ) : null}
    </button>
  );
}

function permissionSummary(toolCall: ToolCallUpdate, cwd: string): string | null {
  const input = toolCall.rawInput as Record<string, unknown> | undefined;
  if (input && typeof input.command === 'string') return input.command;
  const diff = toolCall.content?.find((c) => c.type === 'diff');
  if (diff && diff.type === 'diff') return relPath(diff.path, cwd);
  if (toolCall.locations?.[0]) return relPath(toolCall.locations[0].path, cwd);
  if (input && Object.keys(input).length) return JSON.stringify(input, null, 2).slice(0, 600);
  return null;
}

const resolvedLabel = (options: PermissionOption[], optionId: string | null) => {
  const opt = options.find((o) => o.optionId === optionId);
  if (!opt) return 'No answer (turn ended)';
  return opt.name;
};

export function PermissionCard({
  item,
  agentName,
  cwd,
  latest,
  onRespond,
}: {
  item: Extract<ThreadItem, { type: 'permission' }>;
  agentName: string;
  cwd: string;
  /** The newest unresolved request answers to ↵. */
  latest: boolean;
  onRespond: (optionId: string | null) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const allowOnce = item.options.find((o) => o.kind === 'allow_once') ?? item.options[0];

  useEffect(() => {
    if (!latest || item.resolved || !allowOnce) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || target?.closest('textarea, input')) return;
      e.preventDefault();
      setBusy(allowOnce.optionId);
      void onRespond(allowOnce.optionId).finally(() => setBusy(null));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [latest, item.resolved, allowOnce, onRespond]);

  if (item.resolved) {
    const rejected = item.options.find((o) => o.optionId === item.optionId)?.kind.startsWith('reject') ?? true;
    return (
      <div className="flex items-center gap-2 text-sm text-text-muted">
        {rejected ? <X size={14} className="text-danger" /> : <Check size={14} className="text-success" />}
        <span className="truncate">
          {item.toolCall.title ?? 'Permission'} · <span className="text-text-secondary">{resolvedLabel(item.options, item.optionId)}</span>
        </span>
      </div>
    );
  }

  const summary = permissionSummary(item.toolCall, cwd);
  return (
    <Card tone="warn" className="p-4 flex flex-col gap-3" role="group" aria-label="Permission request">
      <h3 className="flex items-center gap-2 text-lg font-semibold">
        <ShieldAlert size={16} className="text-warn shrink-0" />
        {agentName} wants to: {item.toolCall.title ?? 'use a tool'}
      </h3>
      {summary && <pre className="font-mono text-sm bg-bg border border-border rounded-lg px-3 py-2.5 whitespace-pre-wrap break-all select-text max-h-48 overflow-auto">{summary}</pre>}
      <div className="flex flex-wrap gap-2">
        {item.options.map((o) => (
          <Button
            key={o.optionId}
            variant={o === allowOnce ? 'primary' : o.kind.startsWith('allow') ? 'secondary' : 'ghost'}
            kbd={o === allowOnce && latest ? '↵' : undefined}
            loading={busy === o.optionId}
            disabled={busy !== null && busy !== o.optionId}
            onClick={() => {
              setBusy(o.optionId);
              void onRespond(o.optionId).finally(() => setBusy(null));
            }}
          >
            {o.name}
          </Button>
        ))}
      </div>
    </Card>
  );
}

export function NoticeRow({ item }: { item: Extract<ThreadItem, { type: 'notice' }> }) {
  const Icon = item.severity === 'error' ? CircleAlert : item.severity === 'warning' ? TriangleAlert : Info;
  return (
    <div className={cn('flex gap-2 text-sm', item.severity === 'error' ? 'text-danger' : item.severity === 'warning' ? 'text-warn' : 'text-text-muted')}>
      <Icon size={15} className="mt-0.5 shrink-0" />
      <div>
        <div className="font-medium">{item.title}</div>
        {item.description && <div className="text-text-muted">{item.description}</div>}
      </div>
    </div>
  );
}

export function ErrorRow({ message }: { message: string }) {
  return (
    <Card tone="danger" className="px-4 py-3 flex gap-2.5 text-sm">
      <CircleAlert size={16} className="text-danger mt-0.5 shrink-0" />
      <pre className="whitespace-pre-wrap font-sans text-text-secondary select-text">{message}</pre>
    </Card>
  );
}

const stopText: Record<string, string> = {
  cancelled: 'Stopped',
  max_tokens: 'Stopped: the agent hit its output limit',
  max_turn_requests: 'Stopped: the agent hit its step limit for one turn',
  refusal: 'The agent declined to continue',
};

export function TurnEnd({ stopReason }: { stopReason: string }) {
  const text = stopText[stopReason];
  if (!text) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-text-muted">
      <span className="h-px flex-1 bg-border" />
      {text}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

