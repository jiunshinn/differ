import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { invalidateRepoQueries } from '../query/hooks';
import { useAppStore } from '../state/store';

// Background fetch policy:
//   - Fire once shortly after a repo is opened.
//   - Re-fetch when the window regains focus, but at most once per `FOCUS_COOLDOWN_MS`.
//   - Periodically while the window is visible, every `INTERVAL_MS`.
// All fetches are silent: failures (auth, network) do not toast the user.
const INTERVAL_MS = 30_000;
const FOCUS_COOLDOWN_MS = 15_000;
const INITIAL_DELAY_MS = 400;

export function useAutoFetch(): void {
  // Subscribe ONLY to the repo id so the root (where this hook lives) does not
  // re-render on unrelated store changes (toasts, activity, selection, etc.).
  const repoId = useAppStore((s) => s.repo?.id ?? null);
  const queryClient = useQueryClient();
  const lastTriggeredAt = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    if (repoId === null) return;

    // Reset the cooldown/in-flight state on every repo switch so the new repo's
    // documented initial fetch always fires, even if the previous repo was
    // background-fetched within the cooldown window.
    lastTriggeredAt.current = 0;
    inFlight.current = false;

    // Silent background fetch scoped to THIS repo. Capturing repoId means a late
    // resolution after a repo switch is discarded instead of stamping freshness
    // / invalidating queries on the newly selected repo.
    const silentFetch = async (): Promise<void> => {
      try {
        await api.fetch(repoId);
        if (useAppStore.getState().repo?.id !== repoId) return;
        useAppStore.getState().setLastFetchedAt(Date.now());
        await invalidateRepoQueries(queryClient, repoId);
      } catch {
        // Background fetch failures should not interrupt the user.
      }
    };

    const trigger = (): void => {
      if (inFlight.current) return;
      const now = Date.now();
      if (now - lastTriggeredAt.current < FOCUS_COOLDOWN_MS) return;
      lastTriggeredAt.current = now;
      inFlight.current = true;
      void silentFetch().finally(() => {
        inFlight.current = false;
      });
    };

    const initial = setTimeout(trigger, INITIAL_DELAY_MS);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') trigger();
    }, INTERVAL_MS);

    const onFocus = (): void => trigger();
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') trigger();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearTimeout(initial);
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [repoId, queryClient]);
}
