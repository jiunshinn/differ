import React from 'react';
import { AppProvider, useApp } from './state/AppStore';
import RepositoryPicker from './views/RepositoryPicker';
import LocalChangesView from './views/LocalChangesView';
import PullRequestsView from './views/PullRequestsView';
import PullRequestDetailView from './views/PullRequestDetailView';
import IssuesView from './views/IssuesView';
import ContextBuilderView from './views/ContextBuilderView';
import HistoryView from './views/HistoryView';
import CodeBrowserView from './views/CodeBrowserView';
import TopBar from './components/TopBar';
import ProjectSidebar from './components/ProjectSidebar';
import Toast from './components/Toast';
import { useAutoFetch } from './utils/useAutoFetch';

function Shell() {
  const { state } = useApp();
  useAutoFetch();

  return (
    <div className="h-full w-full bg-bg overflow-hidden flex">
      <ProjectSidebar />
      <div className="flex-1 min-w-0 bg-bg-panel overflow-hidden grid grid-rows-[48px_minmax(0,1fr)]">
        <TopBar />
        <main className="min-h-0">
          {state.view === 'picker' && <RepositoryPicker />}
          {state.view === 'local' && <LocalChangesView />}
          {state.view === 'history' && <HistoryView />}
          {state.view === 'code' && <CodeBrowserView />}
          {state.view === 'pr-list' && <PullRequestsView />}
          {state.view === 'pr-detail' && <PullRequestDetailView />}
          {state.view === 'issues' && <IssuesView />}
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
