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

// The dark class / colorScheme are already applied before first paint by the
// inline bootstrap script in index.html (reading the same STORAGE_KEY), so
// initTheme only re-syncs the runtime store and registers the system-theme
// listener. Guard against double registration so a second call (e.g. HMR or a
// future refactor) does not stack matchMedia listeners.
let initialized = false;
let systemThemeListener: ((e: MediaQueryListEvent) => void) | null = null;
let systemThemeMq: MediaQueryList | null = null;

export function initTheme(): () => void {
  applyDarkClass(currentIsDark);
  if (typeof window === 'undefined') return () => {};
  if (initialized) return teardownTheme;
  initialized = true;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = (e: MediaQueryListEvent) => {
    if (currentMode !== 'system') return;
    const nextDark = e.matches;
    if (nextDark === currentIsDark) return;
    currentIsDark = nextDark;
    applyDarkClass(currentIsDark);
    notify();
  };
  mq.addEventListener('change', onChange);
  systemThemeMq = mq;
  systemThemeListener = onChange;
  return teardownTheme;
}

function teardownTheme() {
  if (systemThemeMq && systemThemeListener) {
    systemThemeMq.removeEventListener('change', systemThemeListener);
  }
  systemThemeMq = null;
  systemThemeListener = null;
  initialized = false;
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
