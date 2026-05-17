import { useEffect, useRef } from 'react';
import { useApp } from '../state/AppStore';

// Background fetch policy:
//   - Fire once shortly after a repo is opened.
//   - Re-fetch when the window regains focus, but at most once per `FOCUS_COOLDOWN_MS`.
//   - Periodically while the window is visible, every `INTERVAL_MS`.
// All fetches are silent: failures (auth, network) do not toast the user.
const INTERVAL_MS = 30_000;
const FOCUS_COOLDOWN_MS = 15_000;
const INITIAL_DELAY_MS = 400;

export function useAutoFetch(): void {
  const { state, silentFetch } = useApp();
  const repoId = state.repo?.id ?? null;
  const lastTriggeredAt = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    if (repoId === null) return;

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
  }, [repoId, silentFetch]);
}
