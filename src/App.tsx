import React from 'react';
import { AppProvider, useApp } from './state/AppStore';
import RepositoryPicker from './views/RepositoryPicker';
import LocalChangesView from './views/LocalChangesView';
import PullRequestsView from './views/PullRequestsView';
import PullRequestDetailView from './views/PullRequestDetailView';
import ContextBuilderView from './views/ContextBuilderView';
import TopBar from './components/TopBar';
import Toast from './components/Toast';

function Shell() {
  const { state } = useApp();

  return (
    <div className="h-full w-full bg-bg overflow-hidden">
      <div className="h-full w-full bg-bg-panel overflow-hidden grid grid-rows-[48px_minmax(0,1fr)]">
        <TopBar />
        <main className="min-h-0">
          {state.view === 'picker' && <RepositoryPicker />}
          {state.view === 'local' && <LocalChangesView />}
          {state.view === 'pr-list' && <PullRequestsView />}
          {state.view === 'pr-detail' && <PullRequestDetailView />}
          {state.view === 'context' && <ContextBuilderView />}
        </main>
      </div>
      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
