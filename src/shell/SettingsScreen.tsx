import { useState } from 'react';
import { Bot, Check, ChevronDown, CircleAlert, Info, Pencil, Plus, Server, Settings2, Trash2 } from 'lucide-react';
import type { ProviderInfo, ProviderSpec } from '@shared/protocol';
import { useAgentStore } from '../agent/store';
import { useTheme } from '../utils/theme';
import { Badge, Button, Card, Dialog, DialogClose, DialogContent, Field, IconButton, Input, ProviderIcon, Segmented, Textarea } from '../ui';
import { cn } from '../utils/cn';
import { EnvironmentsSection } from './EnvironmentsSection';
import { ModelsList } from './ModelsList';

// ─── Layout pieces ──────────────────────────────────────────────────────────

const EMPTY_PROVIDERS: ProviderInfo[] = [];

const sections = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'environments', label: 'Environments', icon: Server },
  { id: 'providers', label: 'Providers', icon: Bot },
  { id: 'about', label: 'About', icon: Info },
] as const;
type Section = (typeof sections)[number]['id'];

function Row({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-6 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-base font-medium">{title}</div>
        {description && <div className="mt-0.5 text-sm text-text-secondary">{description}</div>}
      </div>
      {children && <div className="shrink-0 flex items-center gap-2">{children}</div>}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-lg font-semibold">{title}</h3>
      <Card className="divide-y divide-border">{children}</Card>
    </section>
  );
}

// ─── Provider form ──────────────────────────────────────────────────────────

interface Draft {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string;
  env: string;
}

const emptyDraft: Draft = { id: '', name: '', description: '', command: '', args: '', env: '' };

const toDraft = (p: ProviderInfo): Draft => ({
  id: p.id,
  name: p.name,
  description: p.description ?? '',
  command: p.command,
  args: p.args.join(' '),
  env: Object.entries(p.env ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n'),
});

/** "KEY=value" per line → env object. */
function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1);
  }
  return env;
}

/** Split on whitespace, keeping "quoted args" together. */
function parseArgs(text: string): string[] {
  return (text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((a) => a.replace(/^["']|["']$/g, ''));
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function ProviderForm({ envId, provider, onClose }: { envId: string; provider: ProviderInfo | null; onClose: () => void }) {
  const save = useAgentStore((s) => s.saveProvider);
  const [draft, setDraft] = useState<Draft>(provider ? toDraft(provider) : emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    const spec: ProviderSpec = {
      id: draft.id.trim() || slug(draft.name),
      name: draft.name,
      description: draft.description || undefined,
      command: draft.command,
      args: parseArgs(draft.args),
      env: parseEnv(draft.env),
    };
    try {
      await save(envId, spec);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 flex flex-col gap-4">
      <h3 className="flex items-center gap-2 text-lg font-semibold">
        {(draft.id || draft.name) && <ProviderIcon id={draft.id} name={draft.name} size={18} />}
        {provider ? `Edit ${provider.name}` : 'Add a provider'}
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" htmlFor="p-name" help="Shown in the thread composer">
          <Input id="p-name" value={draft.name} onChange={(e) => set({ name: e.target.value, id: provider ? draft.id : slug(e.target.value) })} placeholder="Gemini CLI" autoFocus />
        </Field>
        <Field label="Id" htmlFor="p-id" help="Lowercase letters, numbers and dashes">
          <Input id="p-id" value={draft.id} onChange={(e) => set({ id: e.target.value })} placeholder="gemini-cli" mono disabled={!!provider} />
        </Field>
      </div>
      <Field label="Command" htmlFor="p-command" help="Starts the agent and speaks ACP over stdio">
        <Input id="p-command" value={draft.command} onChange={(e) => set({ command: e.target.value })} placeholder="gemini" mono />
      </Field>
      <Field label="Arguments" htmlFor="p-args" help="Space separated; quote arguments that contain spaces">
        <Input id="p-args" value={draft.args} onChange={(e) => set({ args: e.target.value })} placeholder="--experimental-acp" mono />
      </Field>
      <Field label="Environment" htmlFor="p-env" help="One KEY=value per line, optional">
        <Textarea id="p-env" rows={2} value={draft.env} onChange={(e) => set({ env: e.target.value })} placeholder="GEMINI_API_KEY=…" className="font-mono text-sm" />
      </Field>
      <Field label="Description" htmlFor="p-desc" help="Optional">
        <Input id="p-desc" value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Google’s coding agent" />
      </Field>
      {error && (
        <p className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert size={15} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!draft.name || !draft.command}>
          {provider ? 'Save changes' : 'Add provider'}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

// ─── Providers ──────────────────────────────────────────────────────────────

const sourceLabel: Record<ProviderInfo['source'], string> = {
  builtin: 'Built in',
  detected: 'Detected',
  file: 'Added by you',
  env: 'From DIFFER_AGENTS',
};

function ProviderRow({ envId, p, onEdit }: { envId: string; p: ProviderInfo; onEdit: () => void }) {
  const remove = useAgentStore((s) => s.deleteProvider);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="w-8 h-8 rounded-lg bg-bg-raised border border-border grid place-items-center text-text-secondary shrink-0">
        <ProviderIcon id={p.id} name={p.name} size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-base font-medium truncate">{p.name}</span>
          {p.available ? (
            <Badge tone="success" dot>
              Ready
            </Badge>
          ) : (
            <Badge tone="danger" dot>
              Command not found
            </Badge>
          )}
          <Badge>{sourceLabel[p.source]}</Badge>
        </div>
        <div className="font-mono text-xs text-text-muted truncate" title={[p.command, ...p.args].join(' ')}>
          {[p.command, ...p.args].join(' ')}
        </div>
        {p.description && <div className="text-sm text-text-secondary truncate">{p.description}</div>}
      </div>
      {p.source === 'file' && (
        <div className="flex items-center gap-1 shrink-0">
          <IconButton icon={Pencil} label="Edit" onClick={onEdit} />
          {confirming ? (
            <>
              <Button size="sm" variant="danger" onClick={() => void remove(envId, p.id)}>
                Remove
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <IconButton icon={Trash2} label="Remove" onClick={() => setConfirming(true)} />
          )}
        </div>
      )}
    </div>
  );
}

function ProvidersSection() {
  const envId = useAgentStore((s) => s.environments.activeId);
  const env = useAgentStore((s) => s.environments.environments.find((e) => e.id === s.environments.activeId));
  const providers = useAgentStore((s) => s.envs[envId]?.providers ?? EMPTY_PROVIDERS);
  const machine = env?.kind === 'local' || !env ? 'this Mac' : env.name;
  const [editing, setEditing] = useState<ProviderInfo | null>(null);
  const [adding, setAdding] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const open = adding || editing;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">Providers</h2>
          <p className="text-sm text-text-secondary">
            Any agent that speaks the Agent Client Protocol (ACP) can be used. Agents installed on {machine} are detected automatically.
            {' '}Providers are configured per machine — switch the default machine in Environments to edit another one's.
          </p>
        </div>
        {!open && (
          <Button icon={Plus} onClick={() => setAdding(true)}>
            Add provider
          </Button>
        )}
      </div>

      {open ? (
        <ProviderForm
          envId={envId}
          provider={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      ) : (
        <Card className="divide-y divide-border">
          {providers.length === 0 && <p className="px-4 py-6 text-sm text-text-muted">No providers yet.</p>}
          {providers.map((p) => (
            <ProviderRow key={p.id} envId={envId} p={p} onEdit={() => setEditing(p)} />
          ))}
        </Card>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-semibold">Models</h3>
        <p className="text-sm text-text-secondary">
          Turn a model off to keep the composer short. Hidden models are still available to the agent; differ just stops offering them.
        </p>
      </div>
      <Card className="divide-y divide-border">
        {providers.filter((p) => p.available).length === 0 && <p className="px-4 py-6 text-sm text-text-muted">No installed providers yet.</p>}
        <ModelsList envId={envId} providers={providers} />
      </Card>

      <div className="rounded-card border border-border bg-bg-panel">
        <button
          type="button"
          onClick={() => setShowHelp((v) => !v)}
          aria-expanded={showHelp}
          className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-bg-hover/60 rounded-card"
        >
          <ChevronDown size={15} className={cn('text-text-muted transition-transform duration-fast', showHelp && 'rotate-180')} />
          How do providers work?
        </button>
        {showHelp && (
          <div className="px-4 pb-4 -mt-1 flex flex-col gap-3 text-sm text-text-secondary">
            <p>
              Each provider is a command the server starts for every thread. It speaks ACP over stdin/stdout, so differ never needs agent-specific code: Claude Code, Gemini
              CLI, Codex and others all work the same way.
            </p>
            <p>
              Claude Code ships with differ. Codex, Cursor, OpenCode, Devin, Gemini CLI, GitHub Copilot and goose show up as <span className="font-medium text-text-primary">Detected</span>{' '}
              as soon as their CLI is installed, so there is nothing to configure. Add a provider with the same id to override one, or point at any other ACP agent.
            </p>
            <ul className="flex flex-col gap-1.5">
              <li className="flex gap-2">
                <Check size={14} className="mt-1 text-success shrink-0" />A thread keeps one agent process, so it remembers the conversation while the server runs.
              </li>
              <li className="flex gap-2">
                <Check size={14} className="mt-1 text-success shrink-0" />The agent can only read and write inside the folder you pick for the thread.
              </li>
              <li className="flex gap-2">
                <Check size={14} className="mt-1 text-success shrink-0" />Commands and file changes ask for approval first, depending on the agent’s mode.
              </li>
            </ul>
            <p>
              Custom providers are saved to <span className="font-mono text-xs text-text-primary">agents.json</span> in the server’s data folder (
              <span className="font-mono text-xs text-text-primary">~/Library/Application Support/differ/server</span> on macOS). No restart needed: new threads pick
              them up immediately.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── General & About ────────────────────────────────────────────────────────

function GeneralSection() {
  const { mode, setMode } = useTheme();
  const environments = useAgentStore((s) => s.environments);
  const envs = useAgentStore((s) => s.envs);
  const running = environments.environments.filter((e) => (envs[e.id]?.status ?? 'closed') === 'open');
  const connecting = environments.environments.some((e) => (envs[e.id]?.status ?? 'closed') === 'connecting');
  const total = environments.environments.length;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold">General</h2>
        <p className="text-sm text-text-secondary">Appearance and the machine differ is connected to.</p>
      </div>
      <Group title="Appearance">
        <Row title="Theme" description="Follow the system setting, or pick one.">
          <Segmented
            aria-label="Theme"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </Row>
      </Group>
      <Group title="Server">
        <Row title="Machines" description="Agents run wherever their thread lives; several machines can be connected at once.">
          <span className="font-mono text-sm text-text-secondary">
            {running.length}/{total} connected
          </span>
        </Row>
        <Row title="Connection">
          <Badge tone={running.length ? 'success' : connecting ? 'warn' : 'danger'} dot>
            {running.length
              ? running.map((e) => (e.kind === 'local' ? 'this Mac' : e.name)).join(', ')
              : connecting
                ? 'Connecting'
                : 'Disconnected'}
          </Badge>
        </Row>
      </Group>
    </div>
  );
}

function AboutSection() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold">About</h2>
        <p className="text-sm text-text-secondary">differ runs agents locally and keeps their threads on your machine.</p>
      </div>
      <Group title="Version">
        <Row title="differ" description="Desktop app and local server">
          <span className="font-mono text-sm text-text-secondary">0.1.0</span>
        </Row>
        <Row title="Protocol" description="Client–server protocol version">
          <span className="font-mono text-sm text-text-secondary">1</span>
        </Row>
      </Group>
      <Group title="Where things are stored">
        <Row title="Provider list" description="Custom ACP agents you add">
          <span className="font-mono text-xs text-text-secondary">agents.json</span>
        </Row>
        <Row title="Model list" description="Models you turned off, per provider">
          <span className="font-mono text-xs text-text-secondary">models.json</span>
        </Row>
        <Row title="Threads" description="Conversations and their events">
          <span className="font-mono text-xs text-text-secondary">server.sqlite3</span>
        </Row>
        <Row title="Data folder" description="~/Library/Application Support/differ/server on macOS">
          <span className="font-mono text-xs text-text-secondary">server data</span>
        </Row>
      </Group>
    </div>
  );
}

// ─── Dialog ─────────────────────────────────────────────────────────────────

/** Settings window (⌘,): a full-size modal with section navigation. */
export function SettingsDialog() {
  const settingsOpen = useAgentStore((s) => s.settingsOpen);
  const openSettings = useAgentStore((s) => s.openSettings);
  const [section, setSection] = useState<Section>('general');

  const close = (next: boolean) => {
    if (!next) openSettings(false);
  };

  return (
    <Dialog open={settingsOpen} onOpenChange={close}>
      <DialogContent bare size="xl" title="Settings">
        <div className="grid grid-cols-[240px_minmax(0,1fr)] h-full min-h-0">
          <nav aria-label="Settings sections" className="flex flex-col min-h-0 bg-bg border-r border-border">
            <div className="h-[52px] shrink-0 flex items-center px-4 drag-region">
              <span className="text-base font-semibold">Settings</span>
            </div>
            <div className="flex flex-col gap-px px-2 pb-2">
              {sections.map((s) => {
                const Icon = s.icon;
                const on = s.id === section;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSection(s.id)}
                    aria-current={on ? 'page' : undefined}
                    className={cn(
                      'h-8 flex items-center gap-2.5 px-2.5 rounded-lg text-base font-medium text-left transition-colors duration-fast',
                      on ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary',
                    )}
                  >
                    <Icon size={15} strokeWidth={1.75} className={on ? 'text-accent' : 'text-text-muted'} />
                    {s.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-auto px-4 pb-4 pt-2 text-xs text-text-muted">
              <kbd className="font-mono">⌘,</kbd> opens and closes this window
            </div>
          </nav>

          <section className="flex flex-col min-h-0">
            <header className="h-[52px] shrink-0 flex items-center gap-2 px-6 border-b border-border">
              <span className="text-sm text-text-muted">Settings</span>
              <span className="text-sm text-text-faint">/</span>
              <span className="text-sm font-medium capitalize">{section}</span>
              <span className="flex-1" />
              <DialogClose asChild>
                <Button variant="ghost" size="sm">
                  Close
                </Button>
              </DialogClose>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6">
              <div className="max-w-[680px]">
                {section === 'general' ? (
                  <GeneralSection />
                ) : section === 'environments' ? (
                  <EnvironmentsSection />
                ) : section === 'providers' ? (
                  <ProvidersSection />
                ) : (
                  <AboutSection />
                )}
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
