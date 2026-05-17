import { useEffect, useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'differ.theme';

function readStoredMode(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system';
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveDark(mode: ThemeMode): boolean {
  return mode === 'dark' || (mode === 'system' && systemPrefersDark());
}

function applyDarkClass(isDark: boolean) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
}

export function initTheme() {
  applyDarkClass(resolveDark(readStoredMode()));
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());
  const [isDark, setIsDark] = useState<boolean>(() => resolveDark(readStoredMode()));

  useEffect(() => {
    applyDarkClass(isDark);
  }, [isDark]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (mode === 'system') setIsDark(mq.matches);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    setIsDark(resolveDark(next));
    if (typeof localStorage !== 'undefined') {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    }
  };

  return { mode, isDark, setMode };
}
