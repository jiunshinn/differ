import { useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronDown, FolderGit2, FolderOpen, Laptop, Server, Settings, Zap, type LucideIcon } from 'lucide-react';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import type { Repository } from '@shared/types';
import { visibleChoices, type ConfigSelector, type ProviderInfo } from '@shared/protocol';
import { api } from '../api';
import { EMPTY_RUNTIME, useAgentStore } from '../agent/store';
import { Button, ProviderIcon, Spinner } from '../ui';
import { ConfigPicker } from './ConfigPicker';
import { cn } from '../utils/cn';
import { Composer } from './Composer';
import AddProjectDialog from '../components/AddProjectDialog';
import { basename } from './format';

const LAST_AGENT = 'differ.lastAgent';
const modelKey = (envId: string, providerId: string) => `differ.model.${envId}.${providerId}`;

const menuItem =
  'flex items-center gap-2.5 h-8 px-2.5 rounded-md text-sm text-text-primary outline-none cursor-default data-[highlighted]:bg-bg-hover data-[disabled]:opacity-45';

const agentTile =
  'grid place-items-center size-9 rounded-lg text-text-secondary outline-none cursor-default data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-primary data-[disabled]:opacity-30';

/** Icon-only provider picker: the marks identify the agent, the name is the tooltip. */
function AgentPicker({ providers, value, onSelect }: { providers: ProviderInfo[]; value: ProviderInfo; onSelect: (id: string) => void }) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          aria-label={`Agent: ${value.name}`}
          title={value.name}
          className="h-7 inline-flex items-center gap-1 px-1.5 rounded-lg text-text-secondary hover:bg-bg-hover hover:text-text-primary data-[state=open]:bg-bg-hover"
        >
          <ProviderIcon id={value.id} name={value.name} size={15} />
          <ChevronDown size={13} className="text-text-muted" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          side="top"
          align="start"
          sideOffset={6}
          className="z-50 grid grid-cols-4 gap-1 p-1.5 rounded-xl border border-border-strong bg-bg-raised shadow-popover animate-pop-in"
        >
          {providers.map((a) => (
            <Dropdown.Item
              key={a.id}
              disabled={!a.available}
              aria-label={a.name}
              title={a.available ? a.name : `${a.name} — not installed`}
              onSelect={() => onSelect(a.id)}
              className={cn(agentTile, a.id === value.id && 'bg-bg-hover text-text-primary ring-1 ring-inset ring-border-strong')}
            >
              <ProviderIcon id={a.id} name={a.name} size={17} />
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

function Picker({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          className="h-7 inline-flex items-center gap-1.5 px-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary data-[state=open]:bg-bg-hover max-w-[260px]"
        >
          <Icon size={14} />
          <span className="truncate">{label}</span>
          <ChevronDown size={13} className="text-text-muted" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          side="top"
          align="start"
          sideOffset={6}
          className="z-50 min-w-[240px] max-w-[360px] p-1.5 rounded-xl border border-border-strong bg-bg-raised shadow-popover animate-pop-in"
        >
          {children}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

export function NewThread() {
  const openSettings = useAgentStore((s) => s.openSettings);
  const createThread = useAgentStore((s) => s.createThread);
  const providerModels = useAgentStore((s) => s.providerModels);
  const openNewThread = useAgentStore((s) => s.openNewThread);
  const connectEnvironment = useAgentStore((s) => s.connectEnvironment);
  const environments = useAgentStore((s) => s.environments);
  const envs = useAgentStore((s) => s.envs);
  const seed = useAgentStore((s) => s.newThread);
  const envId = seed.envId;
  const runtime = useAgentStore((s) => s.envs[envId]) ?? EMPTY_RUNTIME;
  const providers = runtime.providers;
  const status = runtime.status;
  const hiddenByProvider = runtime.hiddenModels;
  const [repos, setRepos] = useState<Repository[]>([]);
  const [agentId, setAgentId] = useState<string | null>(() => localStorage.getItem(LAST_AGENT));
  const [folder, setFolder] = useState<string | null>(() => seed.folder ?? localStorage.getItem(`differ.lastFolder.${envId}`));
  const [error, setError] = useState<string | null>(null);
  const [selector, setSelector] = useState<ConfigSelector | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);

  useEffect(() => {
    api.recentRepos().then(setRepos, () => setRepos([]));
  }, []);

  // A folder from "Add project", or the one last used on this machine.
  useEffect(() => {
    const remembered = localStorage.getItem(`differ.lastFolder.${envId}`);
    setFolder(seed.folder ?? remembered ?? null);
  }, [envId, seed.folder]);

  const available = providers.filter((p) => p.available);
  const provider = providers.find((p) => p.id === agentId && p.available) ?? available[0] ?? null;
  const providerId = provider?.id ?? null;
  const hidden = providerId ? hiddenByProvider[providerId] ?? [] : [];
  // Only repos on the machine this thread will run on are valid here.
  const localRepos = repos.filter((r) => (r.environment_id ?? 'local') === envId);
  const cwd = folder ?? localRepos[0]?.path ?? null;

  const envName = environments.environments.find((e) => e.id === envId);
  const machineLabel = envName ? (envName.kind === 'local' ? 'This Mac' : envName.name) : 'this machine';

  // Agents only reveal their model selector once a session exists, so ask the
  // server (it probes with a throwaway one and caches the answer).
  useEffect(() => {
    if (!providerId) {
      setSelector(null);
      return;
    }
    let alive = true;
    setModelsBusy(true);
    providerModels(envId, providerId, cwd ?? undefined)
      .then((res) => {
        if (!alive) return;
        setSelector(res.selector);
        const sel = res.selector;
        if (!sel) return setModelId(null);
        const remembered = localStorage.getItem(modelKey(envId, providerId));
        setModelId((cur) => {
          const keep = [cur, remembered].find((v) => v && sel.choices.some((c) => c.value === v));
          return keep ?? sel.current ?? sel.choices[0]?.value ?? null;
        });
      })
      .catch(() => {
        if (alive) setSelector(null);
      })
      .finally(() => {
        if (alive) setModelsBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [envId, providerId, cwd, providerModels]);

  const choices = visibleChoices(selector, hidden);
  const activeModel = modelId && choices.some((c) => c.value === modelId) ? modelId : choices[0]?.value ?? null;

  const chooseModel = (value: string) => {
    setModelId(value);
    if (providerId) localStorage.setItem(modelKey(envId, providerId), value);
  };

  const chooseFolder = () => setFolderOpen(true);

  // The folder browser works on any machine, so pick the folder and the machine together.
  const pickFolder = (dir: string, environmentId: string) => {
    localStorage.setItem(`differ.lastFolder.${environmentId}`, dir);
    if (environmentId === envId) setFolder(dir);
    else openNewThread(environmentId, dir);
  };

  if (status !== 'open' && providers.length === 0) {
    return (
      <div className="h-full grid place-items-center text-text-muted">
        <span className="flex items-center gap-2">
          <Spinner /> Connecting to the differ server…
        </span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="min-h-full max-w-[720px] mx-auto px-8 flex flex-col justify-center gap-6 py-16">
        <div>
          <h1 className="text-3xl font-semibold">What should the agent work on?</h1>
          <p className="mt-2 text-text-secondary">
            It works in the folder you choose and asks before running commands or changing files.
          </p>
        </div>

        {!provider ? (
          <div className="flex flex-col gap-2">
            <p className="text-danger text-sm">
              {status === 'open'
                ? `No providers are available on ${machineLabel}.`
                : `Not connected to ${machineLabel}${runtime.error ? `: ${runtime.error}` : '.'}`}
            </p>
            <div className="flex gap-2">
              {status !== 'open' && (
                <Button variant="secondary" icon={Zap} onClick={() => connectEnvironment(envId)} className="self-start">
                  Reconnect
                </Button>
              )}
              <Button variant="secondary" icon={Settings} onClick={() => openSettings(true)} className="self-start">
                Set up a provider
              </Button>
            </div>
          </div>
        ) : (
          <Composer
            placeholder="Describe the task…"
            autoFocus
            disabled={status !== 'open'}
            error={error}
            onSend={async (text) => {
              setError(null);
              if (!cwd) {
                setError('Choose a folder for the agent first.');
                throw new Error('no folder');
              }
              try {
                await createThread({
                  envId,
                  providerId: provider.id,
                  cwd,
                  text,
                  ...(selector && activeModel ? { model: { configId: selector.configId, value: activeModel } } : {}),
                });
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
                throw err;
              }
            }}
            footer={
              <>
                <AgentPicker
                  providers={providers}
                  value={provider}
                  onSelect={(id) => {
                    setAgentId(id);
                    localStorage.setItem(LAST_AGENT, id);
                  }}
                />
                {selector && <ConfigPicker selector={selector} value={activeModel} onChange={chooseModel} hidden={hidden} />}
                {!selector && modelsBusy && (
                  <span className="h-7 inline-flex items-center gap-1.5 px-2 text-sm text-text-muted">
                    <Spinner size={13} label="Loading models" />
                  </span>
                )}
                <Picker
                  icon={environments.environments.find((e) => e.id === envId)?.kind === 'local' ? Laptop : Server}
                  label={machineLabel}
                >
                  {environments.environments.map((e) => {
                    const rt = envs[e.id] ?? EMPTY_RUNTIME;
                    return (
                      <Dropdown.Item key={e.id} className={menuItem} onSelect={() => openNewThread(e.id, null)}>
                        {e.kind === 'local' ? (
                          <Laptop size={14} className="text-text-muted" />
                        ) : (
                          <Server size={14} className="text-text-muted" />
                        )}
                        <span className="flex-1 min-w-0">
                          <span className="block truncate">{e.kind === 'local' ? 'This Mac' : e.name}</span>
                          <span className="block truncate font-mono text-2xs text-text-muted">
                            {rt.status === 'open' ? (rt.hostname ?? 'connected') : rt.status === 'connecting' ? 'connecting…' : 'offline'}
                          </span>
                        </span>
                        {e.id === envId && <Check size={14} />}
                      </Dropdown.Item>
                    );
                  })}
                </Picker>
                <Picker icon={FolderGit2} label={cwd ? basename(cwd) : 'Choose folder'}>
                  {localRepos.slice(0, 8).map((r) => (
                    <Dropdown.Item
                      key={r.id}
                      className={menuItem}
                      onSelect={() => {
                        setFolder(r.path);
                        localStorage.setItem(`differ.lastFolder.${envId}`, r.path);
                      }}
                    >
                      <FolderGit2 size={14} className="text-text-muted" />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate">{r.name}</span>
                        <span className="block truncate font-mono text-2xs text-text-muted">{r.path}</span>
                      </span>
                      {r.path === cwd && <Check size={14} />}
                    </Dropdown.Item>
                  ))}
                  {localRepos.length > 0 && <Dropdown.Separator className="h-px bg-border my-1.5 mx-1" />}
                  <Dropdown.Item className={menuItem} onSelect={() => void chooseFolder()}>
                    <FolderOpen size={14} className="text-text-muted" />
                    Choose another folder…
                  </Dropdown.Item>
                </Picker>
              </>
            }
          />
        )}

        {cwd && (
          <p className={cn('text-xs text-text-muted font-mono truncate')} title={cwd}>
            {cwd}
          </p>
        )}
        {!cwd && (
          <Button icon={FolderOpen} onClick={() => void chooseFolder()} className="self-start">
            Choose a folder
          </Button>
        )}
      </div>

      {folderOpen && (
        <AddProjectDialog
          mode="folder"
          onClose={() => setFolderOpen(false)}
          onPicked={pickFolder}
        />
      )}
    </div>
  );
}
