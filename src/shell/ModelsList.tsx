import { useEffect, useState } from 'react';
import { CircleAlert, Cpu } from 'lucide-react';
import type { ProviderModels, ProviderInfo } from '@shared/protocol';
import { useAgentStore } from '../agent/store';
import { Input, ProviderIcon, Spinner, Switch } from '../ui';
import { cn } from '../utils/cn';

/**
 * The models one provider offers, with a switch per model. Loads on mount —
 * no extra tap — and shows its own spinner while the agent is asked.
 */
function ProviderModelsBlock({ envId, providerId, name }: { envId: string; providerId: string; name: string }) {
  const hidden = useAgentStore((s) => s.envs[envId]?.hiddenModels[providerId]) ?? [];
  const saveHidden = useAgentStore((s) => s.saveHiddenModels);
  const [models, setModels] = useState<ProviderModels | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    useAgentStore
      .getState()
      .providerModels(envId, providerId)
      .then((res) => {
        if (!alive) return;
        setModels(res);
        setError(res.error ?? null);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [envId, providerId]);

  const selector = models?.selector ?? null;
  const total = selector?.choices.length ?? 0;
  const q = query.trim().toLowerCase();
  const shown = selector ? selector.choices.filter((c) => !q || `${c.name} ${c.value} ${c.description ?? ''}`.toLowerCase().includes(q)) : [];
  // Big catalogues (OpenCode can expose hundreds) get a filter and their own scroll area.
  const crowded = total > 20;
  const toggle = (value: string, enabled: boolean) => {
    const next = enabled ? hidden.filter((v) => v !== value) : [...hidden, value];
    // The store updates once the server has written models.json.
    void saveHidden(envId, providerId, next).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  const all = selector?.choices.map((c) => c.value) ?? [];
  const push = (values: string[]) => void saveHidden(envId, providerId, values).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  /** Show or hide every model, or just the ones matching the filter. */
  const bulk = (targets: string[], show: boolean) => {
    const next = new Set(hidden);
    for (const v of targets) {
      if (show) next.delete(v);
      else next.add(v);
    }
    push([...next]);
  };
  /** Keep one model and hide the rest — the fast way out of a 500-model list. */
  const only = (value: string) => push(all.filter((v) => v !== value));
  /** Keep what the filter found and hide everything else. */
  const onlyShown = () => push(all.filter((v) => !shown.some((c) => c.value === v)));

  const targets = q ? shown.map((c) => c.value) : all;
  const alreadyHidden = targets.filter((v) => hidden.includes(v)).length;
  const canShow = alreadyHidden > 0;
  const canHide = alreadyHidden < targets.length;

  const bulkBtn =
    'h-6 px-1.5 rounded-md text-xs font-medium text-text-muted transition-colors duration-fast hover:bg-bg-hover hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none';

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-2 min-w-0">
        <ProviderIcon id={providerId} name={name} size={15} className="shrink-0 text-text-secondary" />
        <span className="text-sm font-medium truncate">{name}</span>
        <span className="text-xs text-text-muted whitespace-nowrap">
          {loading ? 'asking for its models…' : !selector ? 'no model list' : `${total - hidden.length} of ${total} shown`}
        </span>
        {loading && <Spinner size={12} label={`Loading ${name} models`} />}
        {crowded && !loading && (
          <span className="ml-auto w-[180px] shrink-0">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter models…"
              aria-label={`Filter ${name} models`}
              className="!h-7 text-sm"
            />
          </span>
        )}
      </div>

      {loading ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-7 rounded-md bg-bg-hover/40 animate-pulse motion-reduce:animate-none" />
          ))}
        </div>
      ) : !selector ? (
        <p className="mt-2 flex items-start gap-2 text-xs text-text-muted">
          <Cpu size={13} className="mt-0.5 shrink-0" />
          <span>{name} doesn’t advertise a model list, so it always uses its own default.</span>
        </p>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-1">
            <span className="text-xs text-text-muted">{q ? `${shown.length} matching` : ''}</span>
            <div className="ml-auto flex items-center gap-1">
              <button type="button" className={bulkBtn} disabled={!canShow} onClick={() => bulk(targets, true)}>
                Show {q ? 'matching' : 'all'}
              </button>
              <button type="button" className={bulkBtn} disabled={!canHide} onClick={() => bulk(targets, false)}>
                Hide {q ? 'matching' : 'all'}
              </button>
              {q && shown.length > 0 && (
                <button type="button" className={bulkBtn} disabled={hidden.length === total - shown.length} onClick={() => onlyShown()}>
                  Only matching
                </button>
              )}
            </div>
          </div>
          <div className={cn('mt-1 flex flex-col', crowded && 'max-h-[320px] overflow-y-auto pr-1 -mr-1')}>
            {shown.map((choice) => {
              const enabled = !hidden.includes(choice.value);
              return (
                <div key={choice.value} className="group flex items-center gap-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className={cn('text-sm truncate', enabled ? 'text-text-primary' : 'text-text-muted')}>{choice.name}</div>
                    {choice.description && <div className="text-xs text-text-muted truncate">{choice.description}</div>}
                  </div>
                  <span className="font-mono text-2xs text-text-faint shrink-0 truncate max-w-[40%]">{choice.value}</span>
                  <button
                    type="button"
                    onClick={() => only(choice.value)}
                    title={`Show only ${choice.name}`}
                    aria-label={`Show only ${choice.name} for ${name}`}
                    className="shrink-0 h-6 px-1.5 rounded-md text-2xs font-medium text-text-muted opacity-0 transition-opacity duration-fast hover:bg-bg-hover hover:text-text-primary focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    Only
                  </button>
                  <Switch checked={enabled} onChange={(next) => toggle(choice.value, next)} label={`${enabled ? 'Hide' : 'Show'} ${choice.name} for ${name}`} />
                </div>
              );
            })}
            {shown.length === 0 && <p className="py-2 text-xs text-text-muted">No model matches “{query.trim()}”.</p>}
          </div>
          {hidden.length >= total && <p className="pt-1.5 text-xs text-warn">Every model is hidden. {name} falls back to its own default.</p>}
        </>
      )}

      {error && (
        <p className="mt-2 flex items-start gap-2 text-xs text-danger">
          <CircleAlert size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

/** Model visibility for every installed provider, inline (no expand, no second tab). */
export function ModelsList({ envId, providers }: { envId: string; providers: ProviderInfo[] }) {
  return (
    <>
      {providers
        .filter((p) => p.available)
        .map((p) => (
          <ProviderModelsBlock key={p.id} envId={envId} providerId={p.id} name={p.name} />
        ))}
    </>
  );
}
