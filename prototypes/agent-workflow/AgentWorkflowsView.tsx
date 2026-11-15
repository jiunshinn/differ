import React, { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Box,
  Brain,
  ChevronDown,
  Copy,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Star,
  StickyNote,
  Terminal,
  Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../state/AppStore';
import {
  useAgentHistoryQuery,
  useAgentSessionsQuery,
  useAgentSideChatQuery,
  useCaptureAgentSessionMutation,
  useCodexModelsQuery,
  useCodexLoginStatusQuery,
  useCreateAgentSideChatMessageMutation,
  useCreateAgentSessionMutation,
  useDeleteAgentSideChatMessageMutation,
  useDeleteAgentSessionMutation,
  useLaunchAgentSessionMutation,
  useSendAgentPromptMutation,
  useStartCodexLoginMutation,
  useTmuxPanesQuery,
  useUpdateAgentSessionMutation,
  useCreateWorktreeMutation,
  useRemoveWorktreeMutation,
  useWorktreesQuery,
} from '../query/hooks';
import { cn } from '../utils/cn';
import { formatRelativeTime } from '../utils/date';
import type {
  AgentHistoryEntry,
  AgentHistoryProvider,
  AgentKind,
  AgentSession,
  AgentSideChatMessage,
  CodexModel,
  CodexLoginStatus,
  GitWorktree,
  TmuxPane,
} from '@shared/types';

const AGENT_LABEL: Record<AgentKind, string> = {
  codex: 'Codex',
  claude: 'Claude',
  opencode: 'OpenCode',
  terminal: 'Terminal',
};

const HISTORY_LABEL: Record<AgentHistoryProvider | 'all', string> = {
  all: 'All',
  codex: 'Codex',
  claude: 'Claude',
  opencode: 'OpenCode',
};

const DEFAULT_OBJECTIVE = 'Review the current repo context, wait for instructions, and keep changes reviewable.';
const EMPTY_AGENT_SESSIONS: AgentSession[] = [];
const EMPTY_TMUX_PANES: TmuxPane[] = [];
const EMPTY_HISTORY: AgentHistoryEntry[] = [];
const EMPTY_WORKTREES: GitWorktree[] = [];
const EMPTY_SIDE_CHAT: AgentSideChatMessage[] = [];
const EMPTY_CODEX_MODELS: CodexModel[] = [];

const PROVIDER_OPTIONS: { kind: AgentKind; label: string; icon: LucideIcon }[] = [
  { kind: 'codex', label: 'Codex', icon: Sparkles },
  { kind: 'claude', label: 'Claude', icon: Bot },
  { kind: 'opencode', label: 'OpenCode', icon: Box },
  { kind: 'terminal', label: 'Terminal', icon: Terminal },
];

export default function AgentWorkflowsView() {
  const { state, toast, refresh } = useApp();
  const repo = state.repo;
  const repoId = repo?.id ?? null;
  const sessionsQuery = useAgentSessionsQuery(repoId);
  const sessions = sessionsQuery.data ?? EMPTY_AGENT_SESSIONS;
  const tmuxQuery = useTmuxPanesQuery(!!repo);
  const tmuxPanes = tmuxQuery.data ?? EMPTY_TMUX_PANES;
  const worktreesQuery = useWorktreesQuery(repoId, !!repo);
  const worktrees = worktreesQuery.data ?? EMPTY_WORKTREES;
  const [historyProvider, setHistoryProvider] = useState<AgentHistoryProvider | 'all'>('all');
  const historyQuery = useAgentHistoryQuery(repoId, historyProvider, !!repo);
  const historyEntries = historyQuery.data ?? EMPTY_HISTORY;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mode, setMode] = useState<'launch' | 'attach'>('launch');
  const [agentKind, setAgentKind] = useState<AgentKind>('codex');
  const [title, setTitle] = useState('Codex agent');
  const [objective, setObjective] = useState(DEFAULT_OBJECTIVE);
  const [launchCodexModel, setLaunchCodexModel] = useState('');
  const [launchCodexEffort, setLaunchCodexEffort] = useState('');
  const [launchCodexServiceTier, setLaunchCodexServiceTier] = useState('');
  const [paneTarget, setPaneTarget] = useState('');
  const [selectedWorktreePath, setSelectedWorktreePath] = useState('');
  const [newWorktreeBranch, setNewWorktreeBranch] = useState(() => `agent/${Date.now().toString(36)}`);
  const [prompt, setPrompt] = useState('');
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false);
  const [sideChatOpen, setSideChatOpen] = useState(false);
  const [sideChatDraft, setSideChatDraft] = useState('');
  const [historyBusyId, setHistoryBusyId] = useState<string | null>(null);
  const codexStatusQuery = useCodexLoginStatusQuery(!!repo);
  const codexModelsQuery = useCodexModelsQuery(!!repo);
  const codexModels = codexModelsQuery.data ?? EMPTY_CODEX_MODELS;

  const createMutation = useCreateAgentSessionMutation(repoId);
  const launchMutation = useLaunchAgentSessionMutation(repoId);
  const captureMutation = useCaptureAgentSessionMutation(repoId);
  const sendMutation = useSendAgentPromptMutation(repoId);
  const updateMutation = useUpdateAgentSessionMutation(repoId);
  const deleteMutation = useDeleteAgentSessionMutation(repoId);
  const startCodexLoginMutation = useStartCodexLoginMutation(repoId);
  const createWorktreeMutation = useCreateWorktreeMutation(repoId);
  const removeWorktreeMutation = useRemoveWorktreeMutation(repoId);

  useEffect(() => {
    if (selectedId != null && sessions.some((s) => s.id === selectedId)) return;
    setSelectedId(sessions[0]?.id ?? null);
  }, [selectedId, sessions]);

  useEffect(() => {
    setTitle(`${AGENT_LABEL[agentKind]} agent`);
  }, [agentKind]);

  useEffect(() => {
    if (launchCodexModel || codexModels.length === 0) return;
    const model = defaultCodexModel(codexModels);
    setLaunchCodexModel(model.model);
    setLaunchCodexEffort(model.defaultReasoningEffort);
    setLaunchCodexServiceTier(model.defaultServiceTier ?? '');
  }, [codexModels, launchCodexModel]);

  const selected = useMemo(
    () => sessions.find((s) => s.id === selectedId) ?? sessions[0] ?? null,
    [selectedId, sessions],
  );
  const selectedIsCodex = selected?.agent_kind === 'codex';
  const selectedCodexModel = selectedIsCodex
    ? resolveCodexModel(codexModels, selected?.codex_model ?? null)
    : null;
  const selectedCodexEffort = selected?.codex_effort || selectedCodexModel?.defaultReasoningEffort || 'medium';
  const selectedCodexServiceTier = selected?.codex_service_tier || selectedCodexModel?.defaultServiceTier || '';
  const sideChatQuery = useAgentSideChatQuery(selected?.id ?? null);
  const sideChatMessages = sideChatQuery.data ?? EMPTY_SIDE_CHAT;
  const createSideChatMutation = useCreateAgentSideChatMessageMutation(repoId, selected?.id ?? null);
  const deleteSideChatMutation = useDeleteAgentSideChatMessageMutation(selected?.id ?? null);

  const selectedPane = useMemo(
    () => tmuxPanes.find((pane) => pane.target === paneTarget) ?? null,
    [paneTarget, tmuxPanes],
  );

  if (!repo) return null;

  const busy =
    createMutation.isPending ||
    launchMutation.isPending ||
    captureMutation.isPending ||
    sendMutation.isPending ||
    deleteMutation.isPending ||
    startCodexLoginMutation.isPending ||
    createWorktreeMutation.isPending ||
    removeWorktreeMutation.isPending ||
    createSideChatMutation.isPending ||
    deleteSideChatMutation.isPending ||
    updateMutation.isPending ||
    historyBusyId != null;

  const submitSession = async () => {
    try {
      if (mode === 'launch') {
        const created = await launchMutation.mutateAsync({
          title,
          objective,
          agent_kind: agentKind,
          worktree_path: selectedWorktreePath || null,
          codex_model: agentKind === 'codex' ? launchCodexModel || null : null,
          codex_effort: agentKind === 'codex' ? launchCodexEffort || null : null,
          codex_service_tier: agentKind === 'codex' ? launchCodexServiceTier || null : null,
        });
        setSelectedId(created.id);
        toast('success', `${AGENT_LABEL[agentKind]} session launched`);
        return;
      }
      if (!selectedPane) throw new Error('Select a tmux pane to attach');
      const created = await createMutation.mutateAsync({
        title,
        objective,
        agent_kind: agentKind,
        tmux_session: selectedPane.session,
        tmux_window: selectedPane.window,
        tmux_pane: selectedPane.pane,
      });
      setSelectedId(created.id);
      toast('success', 'tmux pane attached');
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const capture = async (session: AgentSession) => {
    try {
      await captureMutation.mutateAsync(session.id);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const sendPrompt = async () => {
    if (!selected || !prompt.trim()) return;
    try {
      await sendMutation.mutateAsync({ id: selected.id, text: prompt });
      setPrompt('');
      if (selected.agent_kind === 'codex') await sideChatQuery.refetch();
      await refresh();
      toast('success', 'Prompt sent');
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const updateSelectedCodexSettings = async (patch: {
    codex_model?: string | null;
    codex_effort?: string | null;
    codex_service_tier?: string | null;
  }) => {
    if (!selected || selected.agent_kind !== 'codex') return;
    try {
      await updateMutation.mutateAsync({ id: selected.id, patch });
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const saveSideChatNote = async () => {
    if (!selected || !sideChatDraft.trim()) return;
    try {
      await createSideChatMutation.mutateAsync({
        agent_session_id: selected.id,
        role: 'note',
        body: sideChatDraft,
      });
      setSideChatDraft('');
      toast('success', 'Side chat note saved');
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const sendSideChatToAgent = async () => {
    if (!selected || !sideChatDraft.trim()) return;
    try {
      await createSideChatMutation.mutateAsync({
        agent_session_id: selected.id,
        role: 'user',
        body: sideChatDraft,
        send_to_agent: true,
      });
      setSideChatDraft('');
      toast('success', 'Side chat sent to agent');
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const captureOutputToSideChat = async () => {
    if (!selected) return;
    const body = selected.last_output?.trim();
    if (!body) {
      toast('error', 'Capture terminal output first');
      return;
    }
    try {
      await createSideChatMutation.mutateAsync({
        agent_session_id: selected.id,
        role: 'agent',
        body,
      });
      toast('success', 'Captured output into side chat');
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const deleteSideChatMessage = async (message: AgentSideChatMessage) => {
    try {
      await deleteSideChatMutation.mutateAsync(message.id);
      toast('success', 'Side chat message removed');
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const deleteSession = async (session: AgentSession) => {
    try {
      await deleteMutation.mutateAsync(session.id);
      toast('success', 'Session removed');
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const copyObjective = async (session: AgentSession) => {
    await api.copyToClipboard(session.objective);
    toast('success', 'Objective copied');
  };

  const loadHistory = async (entry: AgentHistoryEntry) => {
    setHistoryBusyId(entry.id);
    try {
      const detail = await api.readAgentHistory(entry.provider, entry.id);
      setPrompt((prev) => (prev.trim() ? `${prev.trim()}\n\n${detail.context}` : detail.context));
      toast('success', `${HISTORY_LABEL[entry.provider]} history loaded`);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setHistoryBusyId(null);
    }
  };

  const startCodexLogin = async () => {
    try {
      const created = await startCodexLoginMutation.mutateAsync({ deviceAuth: true });
      setSelectedId(created.id);
      toast('success', 'Codex login session started');
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const createWorktree = async () => {
    try {
      const created = await createWorktreeMutation.mutateAsync({
        branch: newWorktreeBranch,
        base: state.status?.branch ?? 'HEAD',
      });
      setSelectedWorktreePath(created.path);
      setNewWorktreeBranch(`agent/${Date.now().toString(36)}`);
      toast('success', 'Worktree created');
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const removeSelectedWorktree = async () => {
    if (!selectedWorktreePath) return;
    try {
      await removeWorktreeMutation.mutateAsync(selectedWorktreePath);
      setSelectedWorktreePath('');
      toast('success', 'Worktree removed');
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  return (
    <div
      className={cn(
        'h-full min-h-0 bg-bg grid',
        sessionPanelOpen && sideChatOpen
          ? 'grid-cols-[300px_minmax(0,1fr)_360px]'
          : sessionPanelOpen
            ? 'grid-cols-[300px_minmax(0,1fr)]'
            : sideChatOpen
              ? 'grid-cols-[minmax(0,1fr)_360px]'
              : 'grid-cols-[minmax(0,1fr)]',
      )}
    >
      {sessionPanelOpen && (
      <aside className="min-h-0 border-r border-border bg-bg-panel grid grid-rows-[auto_auto_minmax(0,1fr)]">
        <header className="px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold tracking-tight m-0">Agent sessions</h2>
            <button
              className="btn-icon h-8 w-8"
              onClick={() => void sessionsQuery.refetch()}
              title="Refresh sessions"
              aria-label="Refresh sessions"
            >
              <RefreshCw size={14} strokeWidth={2} className={cn(sessionsQuery.isFetching && 'animate-spin')} />
            </button>
          </div>
          <div className="mt-1 small-mono truncate">{repo.path}</div>
        </header>

        <section className="p-3.5 border-b border-border grid gap-3">
          <CodexLoginCard
            status={codexStatusQuery.data ?? null}
            loading={codexStatusQuery.isFetching}
            busy={busy}
            onRefresh={() => void codexStatusQuery.refetch()}
            onLogin={() => void startCodexLogin()}
          />

          <div className="inline-flex bg-bg border border-border rounded-lg p-[3px] gap-1">
            <ModeButton active={mode === 'launch'} onClick={() => setMode('launch')}>
              Launch
            </ModeButton>
            <ModeButton active={mode === 'attach'} onClick={() => setMode('attach')}>
              Attach
            </ModeButton>
          </div>

          <div className="grid gap-2">
            <div className="text-xs text-text-muted">Provider</div>
            <div className="grid grid-cols-4 gap-1.5">
              {PROVIDER_OPTIONS.map((provider) => {
                const Icon = provider.icon;
                return (
                  <button
                    key={provider.kind}
                    className={cn(
                      'h-14 rounded-lg border grid place-items-center gap-1 text-xs transition-colors',
                      agentKind === provider.kind
                        ? 'bg-bg-panel border-accent text-text-primary'
                        : 'bg-bg border-border text-text-muted hover:text-text-primary hover:border-border-strong',
                    )}
                    onClick={() => setAgentKind(provider.kind)}
                    title={provider.label}
                  >
                    <Icon size={17} strokeWidth={2} />
                    <span className="truncate px-1">{provider.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {agentKind === 'codex' && (
            <CodexLaunchSettings
              models={codexModels}
              loading={codexModelsQuery.isFetching}
              model={launchCodexModel}
              effort={launchCodexEffort}
              serviceTier={launchCodexServiceTier}
              onModelChange={(model) => {
                setLaunchCodexModel(model.model);
                setLaunchCodexEffort(model.defaultReasoningEffort);
                setLaunchCodexServiceTier(model.defaultServiceTier ?? '');
              }}
              onEffortChange={setLaunchCodexEffort}
              onServiceTierChange={setLaunchCodexServiceTier}
            />
          )}

          <div className="grid gap-2">
            <label className="grid gap-1 text-xs text-text-muted">
              Title
              <input
                className="bg-bg border border-border rounded-md h-8 px-2 text-sm text-text-primary"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
          </div>

          <label className="grid gap-1 text-xs text-text-muted">
            Objective
            <textarea
              className="bg-bg border border-border rounded-md min-h-[82px] resize-none p-2 text-sm text-text-primary leading-5"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            />
          </label>

          {mode === 'launch' && (
            <WorktreeLaunchCard
              repoPath={repo.path}
              worktrees={worktrees}
              selectedPath={selectedWorktreePath}
              branch={newWorktreeBranch}
              busy={busy}
              loading={worktreesQuery.isFetching}
              onSelectedPathChange={setSelectedWorktreePath}
              onBranchChange={setNewWorktreeBranch}
              onRefresh={() => void worktreesQuery.refetch()}
              onCreate={() => void createWorktree()}
              onRemove={() => void removeSelectedWorktree()}
            />
          )}

          {mode === 'attach' && (
            <label className="grid gap-1 text-xs text-text-muted">
              tmux pane
              <select
                className="bg-bg border border-border rounded-md h-8 px-2 text-sm text-text-primary"
                value={paneTarget}
                onChange={(e) => setPaneTarget(e.target.value)}
              >
                <option value="">Select pane</option>
                {tmuxPanes.map((pane) => (
                  <option key={pane.target} value={pane.target}>
                    {paneLabel(pane)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button className="btn-primary h-9 justify-center" disabled={busy} onClick={() => void submitSession()}>
            {mode === 'launch' ? <Play size={14} strokeWidth={2} /> : <Plus size={14} strokeWidth={2} />}
            {mode === 'launch' ? 'Launch session' : 'Attach pane'}
          </button>
        </section>

        <div className="min-h-0 overflow-auto p-3.5">
          {sessions.length === 0 && (
            <div className="panel-card p-4 text-sm text-text-muted">No agent sessions yet.</div>
          )}
          <div className="grid gap-2">
            {sessions.map((session) => (
              <button
                key={session.id}
                className={cn(
                  'text-left panel-card p-3 transition-colors',
                  selected?.id === session.id
                    ? 'border-accent shadow-card'
                    : 'hover:border-text-muted',
                )}
                onClick={() => setSelectedId(session.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{session.title}</span>
                  <span className={cn('chip shrink-0', statusClass(session.status))}>{session.status}</span>
                </div>
                <div className="mt-1 text-xs text-text-muted line-clamp-2">{session.objective}</div>
                <div className="mt-2 small-mono truncate">
                  {session.agent_kind === 'codex'
                    ? `Codex · ${codexModelLabel(codexModels, session.codex_model)}`
                    : `${AGENT_LABEL[session.agent_kind]} · ${session.tmux_session}:${session.tmux_window}.${session.tmux_pane}`}
                </div>
                {session.agent_kind === 'codex' && (
                  <div className="mt-1 small-mono truncate">
                    app-server · {session.codex_thread_id ?? 'thread pending'}
                  </div>
                )}
                {session.worktree_path && (
                  <div className="mt-1 small-mono truncate">worktree · {session.worktree_path}</div>
                )}
              </button>
            ))}
          </div>
        </div>
      </aside>
      )}

      <main className="min-h-0 grid grid-rows-[auto_minmax(0,1fr)_auto] bg-bg-panel">
        {selected ? (
          <>
            <header className="px-4 py-3 border-b border-border bg-bg-panel grid grid-cols-[minmax(0,1fr)_auto] gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Terminal size={16} strokeWidth={2} className="text-text-muted shrink-0" />
                  <h1 className="m-0 text-base font-semibold tracking-tight truncate">{selected.title}</h1>
                  <span className="chip shrink-0">{AGENT_LABEL[selected.agent_kind]}</span>
                  <span className={cn('chip shrink-0', statusClass(selected.status))}>{selected.status}</span>
                </div>
                <div className="mt-1 text-xs text-text-muted truncate">{selected.objective}</div>
                {selected.agent_kind === 'codex' && selected.codex_thread_id && (
                  <div className="mt-1 small-mono truncate">
                    {codexModelLabel(codexModels, selected.codex_model)} · {selectedCodexEffort} · thread {selected.codex_thread_id}
                  </div>
                )}
                {selected.worktree_path && (
                  <div className="mt-1 small-mono truncate">worktree · {selected.worktree_path}</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className={cn('btn', sessionPanelOpen && 'border-accent text-accent')}
                  onClick={() => setSessionPanelOpen((open) => !open)}
                  title={sessionPanelOpen ? 'Hide agent actions' : 'Show agent actions'}
                >
                  <Plus size={14} strokeWidth={2} />
                  Add action
                </button>
                <button className="btn" disabled={busy} onClick={() => void copyObjective(selected)}>
                  <Copy size={14} strokeWidth={2} />
                  Copy
                </button>
                {!selectedIsCodex && (
                  <button className="btn" disabled={busy} onClick={() => void capture(selected)}>
                    <RefreshCw size={14} strokeWidth={2} className={cn(captureMutation.isPending && 'animate-spin')} />
                    Capture
                  </button>
                )}
                <button
                  className={cn('btn', sideChatOpen && 'border-accent text-accent')}
                  onClick={() => setSideChatOpen((open) => !open)}
                  title={sideChatOpen ? 'Hide side chat' : 'Show side chat'}
                >
                  {sideChatOpen ? (
                    <PanelRightClose size={14} strokeWidth={2} />
                  ) : (
                    <PanelRightOpen size={14} strokeWidth={2} />
                  )}
                  Side chat
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => void deleteSession(selected)}
                  title="Remove session from Differ"
                >
                  <Trash2 size={14} strokeWidth={2} />
                </button>
              </div>
            </header>

            <section className="min-h-0 overflow-auto p-4 bg-bg">
              <section className="panel-card mb-4">
                <div className="h-10 px-3 border-b border-border bg-bg-subtle flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-sm">History hook</span>
                    <span className="small-mono">{historyEntries.length}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      className="bg-bg border border-border rounded-md h-7 px-2 text-xs text-text-primary"
                      value={historyProvider}
                      onChange={(e) => setHistoryProvider(e.target.value as AgentHistoryProvider | 'all')}
                    >
                      <option value="all">All agents</option>
                      <option value="codex">Codex</option>
                      <option value="claude">Claude</option>
                      <option value="opencode">OpenCode</option>
                    </select>
                    <button
                      className="btn-ghost h-7 px-2"
                      onClick={() => void historyQuery.refetch()}
                      title="Refresh history"
                    >
                      <RefreshCw
                        size={13}
                        strokeWidth={2}
                        className={cn(historyQuery.isFetching && 'animate-spin')}
                      />
                    </button>
                  </div>
                </div>
                <div className="max-h-[168px] overflow-auto divide-y divide-border">
                  {historyEntries.length === 0 && (
                    <div className="px-3 py-3 text-sm text-text-muted">
                      No matching agent history found for this repository.
                    </div>
                  )}
                  {historyEntries.slice(0, 12).map((entry) => (
                    <HistoryRow
                      key={`${entry.provider}:${entry.id}`}
                      entry={entry}
                      busy={historyBusyId === entry.id}
                      onLoad={() => void loadHistory(entry)}
                    />
                  ))}
                </div>
              </section>

              {selectedIsCodex ? (
                <CodexConversation messages={sideChatMessages} loading={sideChatQuery.isFetching} />
              ) : (
                <div className="panel-card overflow-hidden">
                  <div className="h-10 px-3 border-b border-border bg-bg-subtle flex items-center justify-between">
                    <span className="small-mono truncate">
                      {selected.tmux_session}:{selected.tmux_window}.{selected.tmux_pane}
                    </span>
                    <span className="small-mono">
                      updated {formatRelativeTime(selected.updated_at)} ago
                    </span>
                  </div>
                  <pre className="m-0 p-3.5 min-h-[420px] overflow-auto bg-[#0b1020] text-[#d8dee9] text-xs leading-5 font-mono whitespace-pre-wrap">
                    {selected.last_output ?? 'Capture this session to show terminal output.'}
                  </pre>
                </div>
              )}
            </section>

            <footer className="border-t border-border bg-bg-panel p-3.5">
              {selectedIsCodex ? (
                <CodexComposer
                  models={codexModels}
                  modelsLoading={codexModelsQuery.isFetching}
                  prompt={prompt}
                  busy={busy}
                  selectedModel={selectedCodexModel}
                  selectedEffort={selectedCodexEffort}
                  selectedServiceTier={selectedCodexServiceTier}
                  onPromptChange={setPrompt}
                  onSend={() => void sendPrompt()}
                  onModelChange={(model) => {
                    void updateSelectedCodexSettings({
                      codex_model: model.model,
                      codex_effort: model.defaultReasoningEffort,
                      codex_service_tier: model.defaultServiceTier ?? null,
                    });
                  }}
                  onEffortChange={(effort) => {
                    void updateSelectedCodexSettings({ codex_effort: effort || null });
                  }}
                  onServiceTierChange={(serviceTier) => {
                    void updateSelectedCodexSettings({ codex_service_tier: serviceTier || null });
                  }}
                />
              ) : (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <textarea
                    className="bg-bg border border-border resize-none p-2.5 text-sm text-text-primary leading-5 min-h-[72px] rounded-md"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Send a prompt to the selected tmux pane"
                  />
                  <button
                    className="btn-primary self-stretch px-4"
                    disabled={busy || !prompt.trim()}
                    onClick={() => void sendPrompt()}
                  >
                    <Send size={15} strokeWidth={2} />
                    Send
                  </button>
                </div>
              )}
            </footer>
          </>
        ) : (
          <div className="h-full grid place-items-center p-6 bg-bg">
            <div className="text-center grid gap-3">
              <div className="mx-auto h-10 w-10 rounded-xl border border-border bg-bg-panel grid place-items-center text-text-muted">
                <Terminal size={18} strokeWidth={2} />
              </div>
              <div className="text-sm text-text-muted">Launch or attach an agent session.</div>
              <button className="btn-primary h-8" onClick={() => setSessionPanelOpen(true)}>
                <Plus size={14} strokeWidth={2} />
                Add action
              </button>
            </div>
          </div>
        )}
      </main>

      {selected && sideChatOpen && (
        <SideChatPanel
          selected={selected}
          messages={sideChatMessages}
          draft={sideChatDraft}
          busy={busy}
          loading={sideChatQuery.isFetching}
          creating={createSideChatMutation.isPending}
          deletingId={
            deleteSideChatMutation.variables && deleteSideChatMutation.isPending
              ? deleteSideChatMutation.variables
              : null
          }
          onDraftChange={setSideChatDraft}
          onRefresh={() => void sideChatQuery.refetch()}
          onSaveNote={() => void saveSideChatNote()}
          onSendToAgent={() => void sendSideChatToAgent()}
          onCaptureOutput={() => void captureOutputToSideChat()}
          onDelete={(message) => void deleteSideChatMessage(message)}
        />
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={cn(
        'min-h-[28px] px-2.5 rounded-md text-xs font-medium tracking-wide flex-1',
        active
          ? 'bg-bg-panel text-text-primary border border-border'
          : 'text-text-muted hover:text-text-primary',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function WorktreeLaunchCard({
  repoPath,
  worktrees,
  selectedPath,
  branch,
  busy,
  loading,
  onSelectedPathChange,
  onBranchChange,
  onRefresh,
  onCreate,
  onRemove,
}: {
  repoPath: string;
  worktrees: GitWorktree[];
  selectedPath: string;
  branch: string;
  busy: boolean;
  loading: boolean;
  onSelectedPathChange: (path: string) => void;
  onBranchChange: (branch: string) => void;
  onRefresh: () => void;
  onCreate: () => void;
  onRemove: () => void;
}) {
  const selected = worktrees.find((w) => w.path === selectedPath) ?? null;
  const removable = !!selected && !selected.isMain;

  return (
    <section className="panel-card">
      <div className="px-3 py-2.5 border-b border-border bg-bg-subtle flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-sm">Worktree</div>
          <div className="mt-0.5 small-mono truncate">
            {selectedPath || repoPath}
          </div>
        </div>
        <button className="btn-ghost h-7 px-2" disabled={busy || loading} onClick={onRefresh} title="Refresh worktrees">
          <RefreshCw size={13} strokeWidth={2} className={cn(loading && 'animate-spin')} />
        </button>
      </div>
      <div className="p-3 grid gap-2">
        <select
          className="bg-bg border border-border rounded-md h-8 px-2 text-sm text-text-primary"
          value={selectedPath}
          onChange={(e) => onSelectedPathChange(e.target.value)}
          disabled={busy}
        >
          <option value="">Main checkout</option>
          {worktrees
            .filter((worktree) => !worktree.isMain)
            .map((worktree) => (
              <option key={worktree.path} value={worktree.path}>
                {worktree.branch ?? 'detached'} · {worktree.path}
              </option>
            ))}
        </select>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
          <input
            className="bg-bg border border-border rounded-md h-8 px-2 text-sm text-text-primary"
            value={branch}
            onChange={(e) => onBranchChange(e.target.value)}
            placeholder="agent/new-task"
            disabled={busy}
          />
          <button className="btn h-8" disabled={busy || !branch.trim()} onClick={onCreate}>
            <Plus size={14} strokeWidth={2} />
            New
          </button>
          <button
            className="btn h-8"
            disabled={busy || !removable}
            onClick={onRemove}
            title={removable ? 'Remove selected worktree' : 'Select a non-main worktree to remove'}
          >
            <Trash2 size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
    </section>
  );
}

function CodexLoginCard({
  status,
  loading,
  busy,
  onRefresh,
  onLogin,
}: {
  status: CodexLoginStatus | null;
  loading: boolean;
  busy: boolean;
  onRefresh: () => void;
  onLogin: () => void;
}) {
  const unavailable = status && !status.available;
  const loggedIn = !!status?.logged_in;
  const tone = unavailable ? 'text-danger border-danger/30' : loggedIn ? 'text-success border-success/30' : 'text-warn border-warn/30';
  const label = unavailable ? 'missing' : loggedIn ? status?.mode ?? 'logged in' : 'login needed';

  return (
    <section className="panel-card">
      <div className="px-3 py-2.5 border-b border-border bg-bg-subtle flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-sm">Codex auth</div>
          <div className="mt-0.5 small-mono truncate">
            {status?.detail ?? 'Check Codex CLI login status'}
          </div>
        </div>
        <span className={cn('chip shrink-0', tone)}>{label}</span>
      </div>
      <div className="p-3 flex items-center gap-2">
        <button className="btn h-8" disabled={busy || loading} onClick={onRefresh}>
          <RefreshCw size={14} strokeWidth={2} className={cn(loading && 'animate-spin')} />
          Status
        </button>
        <button className="btn-primary h-8 flex-1" disabled={busy || loading} onClick={onLogin}>
          <Terminal size={14} strokeWidth={2} />
          Device login
        </button>
      </div>
    </section>
  );
}

function CodexLaunchSettings({
  models,
  loading,
  model,
  effort,
  serviceTier,
  onModelChange,
  onEffortChange,
  onServiceTierChange,
}: {
  models: CodexModel[];
  loading: boolean;
  model: string;
  effort: string;
  serviceTier: string;
  onModelChange: (model: CodexModel) => void;
  onEffortChange: (effort: string) => void;
  onServiceTierChange: (serviceTier: string) => void;
}) {
  const options = visibleCodexModels(models);
  const selected = resolveCodexModel(options, model);
  const efforts = effortOptionsForModel(selected, effort);
  const tiers = serviceTiersForModel(selected, serviceTier);

  return (
    <section className="panel-card p-2.5 grid gap-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center">
        <label className="grid gap-1 text-xs text-text-muted min-w-0">
          Model
          <select
            className="bg-bg border border-border rounded-md h-8 px-2 text-sm text-text-primary"
            value={selected.model}
            disabled={loading && options.length <= 1}
            onChange={(e) => {
              const next = options.find((option) => option.model === e.target.value);
              if (next) onModelChange(next);
            }}
          >
            {options.map((option) => (
              <option key={option.id} value={option.model}>
                {option.displayName}
              </option>
            ))}
          </select>
        </label>
        <span className="chip self-end h-8">{loading ? 'loading' : `${options.length} models`}</span>
      </div>
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <label className="grid gap-1 text-xs text-text-muted">
          Effort
          <select
            className="bg-bg border border-border rounded-md h-8 px-2 text-sm text-text-primary"
            value={effort || selected.defaultReasoningEffort}
            onChange={(e) => onEffortChange(e.target.value)}
          >
            {efforts.map((option) => (
              <option key={option} value={option}>
                {capitalize(option)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-text-muted">
          Tier
          <select
            className="bg-bg border border-border rounded-md h-8 px-2 text-sm text-text-primary"
            value={serviceTier || selected.defaultServiceTier || ''}
            onChange={(e) => onServiceTierChange(e.target.value)}
          >
            {tiers.map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function CodexComposer({
  models,
  modelsLoading,
  prompt,
  busy,
  selectedModel,
  selectedEffort,
  selectedServiceTier,
  onPromptChange,
  onSend,
  onModelChange,
  onEffortChange,
  onServiceTierChange,
}: {
  models: CodexModel[];
  modelsLoading: boolean;
  prompt: string;
  busy: boolean;
  selectedModel: CodexModel | null;
  selectedEffort: string;
  selectedServiceTier: string;
  onPromptChange: (value: string) => void;
  onSend: () => void;
  onModelChange: (model: CodexModel) => void;
  onEffortChange: (effort: string) => void;
  onServiceTierChange: (serviceTier: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const model = selectedModel ?? defaultCodexModel(models);
  const efforts = effortOptionsForModel(model, selectedEffort);
  const tiers = serviceTiersForModel(model, selectedServiceTier);

  return (
    <div className="relative mx-auto max-w-4xl">
      {pickerOpen && (
        <CodexModelPicker
          models={models}
          loading={modelsLoading}
          selectedModel={model.model}
          onClose={() => setPickerOpen(false)}
          onSelect={(next) => {
            onModelChange(next);
            setPickerOpen(false);
          }}
        />
      )}

      <div className="rounded-2xl border border-border bg-bg shadow-card overflow-hidden focus-within:border-accent">
        <textarea
          className="w-full min-h-[96px] resize-none bg-transparent px-4 pt-4 pb-2 text-sm leading-6 text-text-primary placeholder:text-text-muted outline-none"
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="Ask Codex anything..."
        />
        <div className="min-h-[48px] px-3 pb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <button
              className="h-9 min-w-0 max-w-[240px] rounded-xl bg-bg-subtle border border-border px-3 text-sm font-medium text-text-primary flex items-center gap-2 hover:bg-bg-hover"
              onClick={() => setPickerOpen((open) => !open)}
              title="Choose Codex model"
            >
              <Sparkles size={16} strokeWidth={2} className="text-accent shrink-0" />
              <span className="truncate">{model.displayName}</span>
              <ChevronDown size={14} strokeWidth={2} className="text-text-muted shrink-0" />
            </button>
            <select
              className="h-9 rounded-xl bg-transparent border border-transparent px-2 text-sm text-text-muted hover:text-text-primary hover:bg-bg-subtle"
              value={selectedEffort || model.defaultReasoningEffort}
              onChange={(e) => onEffortChange(e.target.value)}
              title="Reasoning effort"
            >
              {efforts.map((option) => (
                <option key={option} value={option}>
                  {capitalize(option)}
                </option>
              ))}
            </select>
            <select
              className="h-9 rounded-xl bg-transparent border border-transparent px-2 text-sm text-text-muted hover:text-text-primary hover:bg-bg-subtle"
              value={selectedServiceTier || model.defaultServiceTier || ''}
              onChange={(e) => onServiceTierChange(e.target.value)}
              title="Service tier"
            >
              {tiers.map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.name}
                </option>
              ))}
            </select>
          </div>
          <button
            className="h-10 w-10 rounded-full bg-accent text-on-accent grid place-items-center disabled:opacity-40 hover:bg-accent-hover transition-colors"
            disabled={busy || !prompt.trim()}
            onClick={onSend}
            title="Send"
          >
            <Send size={17} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </div>
  );
}

function CodexModelPicker({
  models,
  loading,
  selectedModel,
  onClose,
  onSelect,
}: {
  models: CodexModel[];
  loading: boolean;
  selectedModel: string;
  onClose: () => void;
  onSelect: (model: CodexModel) => void;
}) {
  const [query, setQuery] = useState('');
  const options = visibleCodexModels(models);
  const filtered = options.filter((model) => {
    const haystack = `${model.displayName} ${model.model} ${model.description}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  return (
    <div className="absolute left-0 bottom-[calc(100%+10px)] z-20 w-[560px] max-w-[min(560px,calc(100vw-64px))] rounded-2xl border border-border bg-bg-panel shadow-2xl overflow-hidden">
      <div className="grid grid-cols-[64px_minmax(0,1fr)] min-h-[420px]">
        <aside className="border-r border-border bg-bg-subtle p-2 grid content-start gap-2">
          {[
            { label: 'Favorites', icon: Star, active: false },
            { label: 'Codex', icon: Sparkles, active: true },
            { label: 'OpenAI', icon: Brain, active: false },
            { label: 'Local', icon: Box, active: false },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                className={cn(
                  'h-11 rounded-lg grid place-items-center border',
                  item.active
                    ? 'bg-bg-panel border-accent text-accent'
                    : 'border-transparent text-text-muted hover:text-text-primary hover:bg-bg-panel',
                )}
                title={item.label}
                onClick={item.active ? undefined : onClose}
              >
                <Icon size={19} strokeWidth={2} />
              </button>
            );
          })}
        </aside>

        <section className="min-w-0 grid grid-rows-[auto_minmax(0,1fr)]">
          <div className="p-3 border-b border-border">
            <div className="h-10 rounded-xl border border-border bg-bg flex items-center gap-2 px-3 focus-within:border-accent">
              <Search size={17} strokeWidth={2} className="text-text-muted shrink-0" />
              <input
                className="min-w-0 flex-1 bg-transparent outline-none text-sm text-text-primary placeholder:text-text-muted"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models..."
                autoFocus
              />
            </div>
          </div>
          <div className="min-h-0 overflow-auto p-2">
            {loading && <div className="px-3 py-2 small-mono">Loading Codex models...</div>}
            {filtered.map((model, index) => (
              <button
                key={model.id}
                className={cn(
                  'w-full min-h-[70px] rounded-lg px-3 py-2 grid grid-cols-[24px_minmax(0,1fr)_auto] gap-3 items-center text-left border transition-colors',
                  selectedModel === model.model
                    ? 'bg-bg-subtle border-border-strong'
                    : 'border-transparent hover:bg-bg-subtle',
                )}
                onClick={() => onSelect(model)}
              >
                <Star
                  size={17}
                  strokeWidth={2}
                  className={selectedModel === model.model ? 'text-accent' : 'text-text-muted'}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-text-primary truncate">{model.displayName}</span>
                  <span className="mt-1 block text-xs text-text-muted truncate">
                    {model.description || model.model}
                  </span>
                </span>
                <span className="kbd">#{index + 1}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-text-muted">No models found.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function CodexConversation({
  messages,
  loading,
}: {
  messages: AgentSideChatMessage[];
  loading: boolean;
}) {
  const chatMessages = messages.filter((message) => message.role === 'user' || message.role === 'agent');

  return (
    <div className="min-h-[420px] max-w-3xl mx-auto grid content-end gap-3 py-8">
      {chatMessages.length === 0 && (
        <div className="text-center text-sm text-text-muted">
          <div className="mx-auto mb-3 h-10 w-10 rounded-xl border border-border bg-bg-panel grid place-items-center">
            <MessageSquare size={18} strokeWidth={2} />
          </div>
          No Codex messages yet.
        </div>
      )}
      {chatMessages.map((message) => {
        const isUser = message.role === 'user';

        return (
          <div key={message.id} className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
            <article
              className={cn(
                'max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-6 whitespace-pre-wrap break-words',
                isUser
                  ? 'border border-border bg-bg-panel text-text-primary'
                  : 'border border-transparent bg-transparent text-text-secondary',
              )}
            >
              {message.body}
              <div className="mt-2 small-mono text-text-faint">{formatRelativeTime(message.created_at)} ago</div>
            </article>
          </div>
        );
      })}
      {loading && <div className="small-mono text-center text-text-muted">Loading Codex conversation...</div>}
    </div>
  );
}

function SideChatPanel({
  selected,
  messages,
  draft,
  busy,
  loading,
  creating,
  deletingId,
  onDraftChange,
  onRefresh,
  onSaveNote,
  onSendToAgent,
  onCaptureOutput,
  onDelete,
}: {
  selected: AgentSession;
  messages: AgentSideChatMessage[];
  draft: string;
  busy: boolean;
  loading: boolean;
  creating: boolean;
  deletingId: number | null;
  onDraftChange: (value: string) => void;
  onRefresh: () => void;
  onSaveNote: () => void;
  onSendToAgent: () => void;
  onCaptureOutput: () => void;
  onDelete: (message: AgentSideChatMessage) => void;
}) {
  return (
    <aside className="min-h-0 border-l border-border bg-bg-panel grid grid-rows-[auto_minmax(0,1fr)_auto]">
      <header className="px-3.5 py-3 border-b border-border bg-bg-panel">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <MessageSquare size={15} strokeWidth={2} className="text-text-muted shrink-0" />
              <h2 className="m-0 text-sm font-semibold tracking-tight truncate">Side chat</h2>
              <span className="chip shrink-0">{messages.length}</span>
            </div>
            <div className="mt-1 small-mono truncate">{selected.title}</div>
          </div>
          <button className="btn-icon h-8 w-8" disabled={loading} onClick={onRefresh} title="Refresh side chat">
            <RefreshCw size={14} strokeWidth={2} className={cn(loading && 'animate-spin')} />
          </button>
        </div>
      </header>

      <section className="min-h-0 overflow-auto p-3 bg-bg grid content-start gap-2">
        {messages.length === 0 && (
          <div className="panel-card p-4 text-sm text-text-muted">
            Keep side questions, notes, and agent handoffs here without disturbing the main terminal thread.
          </div>
        )}
        {messages.map((message) => (
          <SideChatMessageRow
            key={message.id}
            message={message}
            deleting={deletingId === message.id}
            onDelete={() => onDelete(message)}
          />
        ))}
      </section>

      <footer className="border-t border-border bg-bg-panel p-3 grid gap-2">
        <textarea
          className="bg-bg border border-border rounded-md min-h-[104px] resize-none p-2.5 text-sm text-text-primary leading-5"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="Ask a side question, save a note, or send this to the selected agent"
        />
        <div className="grid grid-cols-[1fr_1fr] gap-2">
          <button className="btn h-8" disabled={busy || !draft.trim()} onClick={onSaveNote}>
            <StickyNote size={14} strokeWidth={2} />
            Save note
          </button>
          <button className="btn-primary h-8" disabled={busy || !draft.trim()} onClick={onSendToAgent}>
            <Send size={14} strokeWidth={2} />
            Send
          </button>
        </div>
        {selected.agent_kind !== 'codex' && (
          <button
            className="btn h-8 justify-center"
            disabled={busy || creating || !selected.last_output?.trim()}
            onClick={onCaptureOutput}
            title="Store the latest captured terminal output as an agent message"
          >
            <Terminal size={14} strokeWidth={2} />
            Capture output into chat
          </button>
        )}
      </footer>
    </aside>
  );
}

function SideChatMessageRow({
  message,
  deleting,
  onDelete,
}: {
  message: AgentSideChatMessage;
  deleting: boolean;
  onDelete: () => void;
}) {
  const isAgent = message.role === 'agent';
  const isNote = message.role === 'note';
  const label = isAgent ? 'Agent output' : isNote ? 'Note' : 'You';
  const tone = isAgent
    ? 'border-success/30 text-success'
    : isNote
      ? 'border-warn/30 text-warn'
      : 'border-accent/30 text-accent';

  return (
    <article
      className={cn(
        'panel-card p-3 min-w-0',
        message.sent_to_agent ? 'border-accent/50' : '',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('chip shrink-0', tone)}>{label}</span>
          {message.sent_to_agent ? <span className="chip shrink-0">sent</span> : null}
          <span className="small-mono truncate">{formatRelativeTime(message.created_at)} ago</span>
        </div>
        <button className="btn-icon h-7 w-7" disabled={deleting} onClick={onDelete} title="Delete message">
          {deleting ? (
            <RefreshCw size={13} strokeWidth={2} className="animate-spin" />
          ) : (
            <Trash2 size={13} strokeWidth={2} />
          )}
        </button>
      </div>
      <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-5 text-text-secondary">
        {message.body}
      </div>
    </article>
  );
}

function visibleCodexModels(models: CodexModel[]): CodexModel[] {
  const visible = models.filter((model) => !model.hidden);
  return visible.length > 0 ? visible : [fallbackCodexModel()];
}

function defaultCodexModel(models: CodexModel[]): CodexModel {
  const visible = visibleCodexModels(models);
  return visible.find((model) => model.isDefault) ?? visible[0] ?? fallbackCodexModel();
}

function resolveCodexModel(models: CodexModel[], modelId: string | null): CodexModel {
  const visible = visibleCodexModels(models);
  return visible.find((model) => model.model === modelId || model.id === modelId) ?? defaultCodexModel(visible);
}

function codexModelLabel(models: CodexModel[], modelId: string | null): string {
  if (!modelId) return defaultCodexModel(models).displayName;
  return resolveCodexModel(models, modelId).displayName;
}

function effortOptionsForModel(model: CodexModel, selected: string): string[] {
  const efforts = model.supportedReasoningEfforts.map((option) => option.reasoningEffort).filter(Boolean);
  const merged = new Set([selected || model.defaultReasoningEffort || 'medium', ...efforts]);
  return Array.from(merged).filter(Boolean);
}

function serviceTiersForModel(model: CodexModel, selected: string): CodexModel['serviceTiers'] {
  const tiers = model.serviceTiers.length > 0 ? model.serviceTiers : [{ id: '', name: 'Default', description: '' }];
  if (!selected || tiers.some((tier) => tier.id === selected)) return tiers;
  return [{ id: selected, name: selected, description: '' }, ...tiers];
}

function fallbackCodexModel(): CodexModel {
  return {
    id: 'codex-default',
    model: '',
    displayName: 'Codex default',
    description: 'Use the default model from Codex configuration',
    hidden: false,
    isDefault: true,
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: '' },
      { reasoningEffort: 'medium', description: '' },
      { reasoningEffort: 'high', description: '' },
    ],
    defaultReasoningEffort: 'medium',
    serviceTiers: [{ id: '', name: 'Default', description: '' }],
    defaultServiceTier: null,
  };
}

function capitalize(value: string): string {
  return value ? `${value.slice(0, 1).toUpperCase()}${value.slice(1)}` : 'Default';
}

function paneLabel(pane: TmuxPane): string {
  const command = pane.command ? ` · ${pane.command}` : '';
  const cwd = pane.currentPath ? ` · ${pane.currentPath}` : '';
  return `${pane.session}:${pane.window}.${pane.pane}${command}${cwd}`;
}

function HistoryRow({
  entry,
  busy,
  onLoad,
}: {
  entry: AgentHistoryEntry;
  busy: boolean;
  onLoad: () => void;
}) {
  return (
    <div className="px-3 py-2.5 grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="chip shrink-0">{HISTORY_LABEL[entry.provider]}</span>
          <span className="text-sm font-medium truncate">{entry.title}</span>
          <span className="small-mono shrink-0">{entry.message_count}</span>
        </div>
        <div className="mt-1 text-xs text-text-muted truncate">{entry.preview}</div>
        <div className="mt-1 small-mono truncate">
          {entry.cwd ?? entry.file_path ?? entry.session_id ?? 'history'}
        </div>
      </div>
      <button className="btn h-8" disabled={busy} onClick={onLoad}>
        {busy ? <RefreshCw size={14} strokeWidth={2} className="animate-spin" /> : <Plus size={14} strokeWidth={2} />}
        Load
      </button>
    </div>
  );
}

function statusClass(status: AgentSession['status']): string {
  if (status === 'running') return 'text-success border-success/30';
  if (status === 'stopped') return 'text-danger border-danger/30';
  if (status === 'idle') return 'text-warn border-warn/30';
  return '';
}
