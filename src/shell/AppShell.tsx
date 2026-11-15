import { useEffect, useState } from 'react';
import { PanelLeftOpen } from 'lucide-react';
import { threadKey, useAgentStore } from '../agent/store';
import { cn } from '../utils/cn';
import { IconButton } from '../ui';
import { NewThread } from './NewThread';
import { SettingsDialog } from './SettingsScreen';
import { Sidebar } from './Sidebar';
import { ThreadScreen } from './ThreadScreen';

const COLLAPSED_KEY = 'differ.sidebarCollapsed';

export default function AppShell() {
  const connect = useAgentStore((s) => s.connect);
  const refreshEnvironments = useAgentStore((s) => s.refreshEnvironments);
  const threads = useAgentStore((s) => s.threads);
  const selectedKey = useAgentStore((s) => s.selectedKey);
  const select = useAgentStore((s) => s.select);
  const openNewThread = useAgentStore((s) => s.openNewThread);
  const openSettings = useAgentStore((s) => s.openSettings);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1');

  // Load the machine list, then let the store open a connection to each one.
  useEffect(() => {
    void refreshEnvironments().then(() => connect());
  }, [refreshEnvironments, connect]);
  useEffect(() => localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'), [collapsed]);

  const selected = threads.find((t) => threadKey(t.envId, t.id) === selectedKey) ?? null;
  const loaded = useAgentStore((s) => (selectedKey ? !!s.data[selectedKey]?.loaded : false));
  const selectedEnvStatus = useAgentStore((s) => (selected ? s.envs[selected.envId]?.status : undefined));

  // The remembered thread may come back before its machine has answered; subscribe then.
  useEffect(() => {
    if (selected && !loaded && selectedEnvStatus === 'open') select(selected.envId, selected.id);
  }, [selected, loaded, selectedEnvStatus, select]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.key === 'b') {
        e.preventDefault();
        setCollapsed((c) => !c);
      } else if (e.key === 'n' && !e.shiftKey) {
        e.preventDefault();
        openNewThread();
      } else if (e.key === ',') {
        e.preventDefault();
        openSettings(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openNewThread, openSettings]);

  return (
    <div
      className={cn('h-full w-full grid bg-bg text-text-primary overflow-hidden transition-[grid-template-columns] duration-base ease-out')}
      style={{ gridTemplateColumns: `${collapsed ? 76 : 280}px minmax(0, 1fr)` }}
    >
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <main className="relative min-w-0 min-h-0">
        {selected ? (
          <ThreadScreen key={threadKey(selected.envId, selected.id)} thread={selected} sidebarCollapsed={collapsed} />
        ) : (
          <NewThread />
        )}
        {collapsed && (
          <div className="absolute left-1.5 top-3 z-30">
            <IconButton icon={PanelLeftOpen} label="Expand sidebar" shortcut="⌘B" onClick={() => setCollapsed(false)} />
          </div>
        )}
      </main>
      <SettingsDialog />
    </div>
  );
}
