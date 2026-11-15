import { useEffect, useState } from 'react';
import { Check, CircleAlert, Laptop, Pencil, Plus, Server, Trash2, UploadCloud, Zap } from 'lucide-react';
import type { Environment, EnvironmentDraft, EnvironmentCheck } from '@shared/types';
import { useAgentStore } from '../agent/store';
import { Badge, Button, Card, Field, Input } from '../ui';
import { cn } from '../utils/cn';

const emptyDraft: EnvironmentDraft = { name: '', host: '', port: 22, remoteDir: '~/.differ/server', command: '' };

function Message({ result }: { result: EnvironmentCheck | null }) {
  if (!result) return null;
  return (
    <p className={cn('flex items-start gap-2 text-sm', result.ok ? 'text-success' : 'text-danger')}>
      {result.ok ? <Check size={15} className="mt-0.5 shrink-0" /> : <CircleAlert size={15} className="mt-0.5 shrink-0" />}
      <span className="font-mono text-xs whitespace-pre-wrap break-all">{result.detail || (result.ok ? 'OK' : 'Failed')}</span>
    </p>
  );
}

function EnvironmentForm({ environment, onClose }: { environment: Environment | null; onClose: () => void }) {
  const save = useAgentStore((s) => s.saveEnvironment);
  const [draft, setDraft] = useState<EnvironmentDraft>(
    environment
      ? { id: environment.id, name: environment.name, host: environment.host, port: environment.port, remoteDir: environment.remoteDir, command: environment.command }
      : emptyDraft,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<EnvironmentDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await save(draft);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 flex flex-col gap-4">
      <h3 className="text-lg font-semibold">{environment ? `Edit ${environment.name}` : 'Add an SSH environment'}</h3>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" htmlFor="e-name">
          <Input id="e-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="devbox" autoFocus />
        </Field>
        <Field label="Port" htmlFor="e-port">
          <Input id="e-port" type="number" value={draft.port} onChange={(e) => set({ port: Number(e.target.value) })} placeholder="22" mono />
        </Field>
      </div>
      <Field label="Host" htmlFor="e-host" help="Anything ssh accepts, e.g. devbox or me@10.0.4.12">
        <Input id="e-host" value={draft.host} onChange={(e) => set({ host: e.target.value })} placeholder="devbox" mono />
      </Field>
      <Field label="Server folder on that machine" htmlFor="e-dir" help="Where Install puts the differ server">
        <Input id="e-dir" value={draft.remoteDir} onChange={(e) => set({ remoteDir: e.target.value })} placeholder="~/.differ/server" mono />
      </Field>
      <Field label="Start command" htmlFor="e-cmd" help="Optional. Leave empty to run node src/main.js --stdio in the folder above.">
        <Input id="e-cmd" value={draft.command} onChange={(e) => set({ command: e.target.value })} placeholder="node src/main.js --stdio" mono />
      </Field>
      <p className="text-sm text-text-secondary">
        Authentication uses your existing SSH setup (keys and <span className="font-mono text-xs">~/.ssh/config</span>); differ never asks for a password.
      </p>
      {error && (
        <p className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert size={15} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!draft.name || !draft.host}>
          {environment ? 'Save changes' : 'Add environment'}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function EnvironmentRow({ env, isDefault, onEdit }: { env: Environment; isDefault: boolean; onEdit: () => void }) {
  const runtime = useAgentStore((s) => s.envs[env.id]);
  const reconnectEnvironment = useAgentStore((s) => s.reconnectEnvironment);
  const disconnectEnvironment = useAgentStore((s) => s.disconnectEnvironment);
  const setDefaultEnvironment = useAgentStore((s) => s.setDefaultEnvironment);
  const deleteEnvironment = useAgentStore((s) => s.deleteEnvironment);
  const checkEnvironment = useAgentStore((s) => s.checkEnvironment);
  const bootstrapEnvironment = useAgentStore((s) => s.bootstrapEnvironment);
  const [busy, setBusy] = useState<'connect' | 'check' | 'install' | null>(null);
  const [result, setResult] = useState<EnvironmentCheck | null>(null);
  const [confirming, setConfirming] = useState(false);
  const Icon = env.kind === 'local' ? Laptop : Server;
  const status = runtime?.status ?? 'closed';
  const connected = status === 'open';

  const run = async (what: 'check' | 'install' | 'connect') => {
    setBusy(what);
    setResult(null);
    try {
      if (what === 'check') setResult(await checkEnvironment(env.id));
      else if (what === 'install') setResult(await bootstrapEnvironment(env.id));
      else reconnectEnvironment(env.id);
    } catch (err) {
      setResult({ ok: false, detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className={cn('w-8 h-8 rounded-lg border grid place-items-center shrink-0', connected ? 'bg-accent/12 border-accent/30 text-accent' : 'bg-bg-raised border-border text-text-secondary')}>
          <Icon size={16} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-medium truncate">{env.name}</span>
            {connected && (
              <Badge tone="success" dot>
                Connected
              </Badge>
            )}
            {status === 'connecting' && <Badge tone="warn" dot>Connecting</Badge>}
            <Badge>{env.kind === 'local' ? 'This machine' : 'SSH'}</Badge>
            {isDefault && <Badge tone="accent">Default for new threads</Badge>}
          </div>
          <div className="font-mono text-xs text-text-muted truncate">
            {env.kind === 'local' ? 'Runs the server with the app' : `${env.host}:${env.port} · ${env.remoteDir}`}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!connected && (
            <Button size="sm" icon={Zap} onClick={() => void run('connect')} loading={busy === 'connect' || status === 'connecting'}>
              Connect
            </Button>
          )}
          {connected && env.kind === 'ssh' && (
            <Button size="sm" variant="ghost" onClick={() => disconnectEnvironment(env.id)}>
              Disconnect
            </Button>
          )}
          {!isDefault && env.kind === 'ssh' && (
            <Button size="sm" variant="ghost" onClick={() => void setDefaultEnvironment(env.id)} title="New threads start on this machine">
              Make default
            </Button>
          )}
          {env.kind === 'ssh' && (
            <>
              <Button size="sm" variant="ghost" onClick={() => void run('check')} loading={busy === 'check'}>
                Test
              </Button>
              <Button size="sm" variant="ghost" icon={UploadCloud} onClick={() => void run('install')} loading={busy === 'install'}>
                Install
              </Button>
              <Button size="sm" variant="ghost" icon={Pencil} onClick={onEdit} aria-label={`Edit ${env.name}`} />
              {confirming ? (
                <>
                  <Button size="sm" variant="danger" onClick={() => void deleteEnvironment(env.id)}>
                    Remove
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setConfirming(true)} aria-label={`Remove ${env.name}`} />
              )}
            </>
          )}
        </div>
      </div>
      {result && (
        <div className="mt-2 pl-11">
          <Message result={result} />
        </div>
      )}
      {!result && status !== 'open' && runtime?.error && (
        <div className="mt-2 pl-11">
          <Message result={{ ok: false, detail: runtime.error }} />
        </div>
      )}
    </div>
  );
}

export function EnvironmentsSection() {
  const environments = useAgentStore((s) => s.environments);
  const refresh = useAgentStore((s) => s.refreshEnvironments);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Environment | null>(null);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const open = adding || editing;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">Environments</h2>
          <p className="text-sm text-text-secondary">
            Each machine runs its own agents and keeps its own threads. Connect as many as you like — they work in parallel.
          </p>
        </div>
        {!open && (
          <Button icon={Plus} onClick={() => setAdding(true)}>
            Add SSH environment
          </Button>
        )}
      </div>

      {open ? (
        <EnvironmentForm
          environment={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      ) : (
        <Card className="divide-y divide-border">
          {environments.environments.map((env) => (
            <EnvironmentRow key={env.id} env={env} isDefault={env.id === environments.activeId} onEdit={() => setEditing(env)} />
          ))}
        </Card>
      )}

      <div className="rounded-card border border-border bg-bg-panel p-4 flex flex-col gap-2 text-sm text-text-secondary">
        <p className="font-medium text-text-primary">Setting up a new machine</p>
        <ol className="list-decimal pl-5 flex flex-col gap-1">
          <li>Add the host, then press <span className="font-medium text-text-primary">Test</span> to check SSH and the Node version (22.5 or newer).</li>
          <li>
            Press <span className="font-medium text-text-primary">Install</span> to copy the differ server there and run <span className="font-mono text-xs">npm install</span>. This needs
            Node and npm on the remote machine.
          </li>
          <li>
            Press <span className="font-medium text-text-primary">Connect</span>. That machine stays connected alongside this one, so its threads show up under its name in the sidebar.
          </li>
        </ol>
        <p className="text-xs text-text-muted">Sign-in for the agents themselves (for example <span className="font-mono">claude</span> login) has to be done on the remote machine once.</p>
      </div>
    </div>
  );
}
