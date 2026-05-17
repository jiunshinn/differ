import { useSyncExternalStore } from 'react';

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

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  listeners.forEach((l) => l());
}

let currentMode: ThemeMode = readStoredMode();
let currentIsDark: boolean = resolveDark(currentMode);

const getMode = () => currentMode;
const getIsDark = () => currentIsDark;

export function initTheme() {
  applyDarkClass(currentIsDark);
  if (typeof window === 'undefined') return;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', () => {
    if (currentMode !== 'system') return;
    const nextDark = mq.matches;
    if (nextDark === currentIsDark) return;
    currentIsDark = nextDark;
    applyDarkClass(currentIsDark);
    notify();
  });
}

function setMode(next: ThemeMode) {
  currentMode = next;
  currentIsDark = resolveDark(next);
  applyDarkClass(currentIsDark);
  if (typeof localStorage !== 'undefined') {
    if (next === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  }
  notify();
}

export function useTheme() {
  const mode = useSyncExternalStore(subscribe, getMode, getMode);
  const isDark = useSyncExternalStore(subscribe, getIsDark, getIsDark);
  return { mode, isDark, setMode };
}
