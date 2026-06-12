import React, { Suspense } from 'react';
import { AppProvider, useAppStore } from './state/AppStore';
import TopBar from './components/TopBar';
import ProjectSidebar from './components/ProjectSidebar';
import Toast from './components/Toast';
import { useAutoFetch } from './utils/useAutoFetch';

class ViewErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('View render error:', error);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="h-full grid place-items-center p-6">
          <div className="max-w-md text-center grid gap-3">
            <div className="text-sm font-semibold text-danger">Something went wrong</div>
            <div className="text-xs text-text-muted whitespace-pre-wrap break-words">
              {this.state.error.message}
            </div>
            <div className="flex items-center justify-center gap-2">
              <button className="btn" onClick={this.reset}>
                Try again
              </button>
              <button className="btn-primary" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const RepositoryPicker = React.lazy(() => import('./views/RepositoryPicker'));
const LocalChangesView = React.lazy(() => import('./views/LocalChangesView'));
const PullRequestsView = React.lazy(() => import('./views/PullRequestsView'));
const PullRequestDetailView = React.lazy(() => import('./views/PullRequestDetailView'));
const IssuesView = React.lazy(() => import('./views/IssuesView'));
const HistoryView = React.lazy(() => import('./views/HistoryView'));
const CodeBrowserView = React.lazy(() => import('./views/CodeBrowserView'));

function Shell() {
  const view = useAppStore((state) => state.view);
  useAutoFetch();

  return (
    <div className="h-full w-full bg-bg overflow-hidden flex">
      <ProjectSidebar />
      <div className="flex-1 min-w-0 bg-bg-panel overflow-hidden grid grid-rows-[48px_minmax(0,1fr)]">
        <TopBar />
        <main className="min-h-0">
          <ViewErrorBoundary key={view}>
            <Suspense fallback={<div className="h-full grid place-items-center text-sm text-text-muted">Loading view...</div>}>
              {view === 'picker' && <RepositoryPicker />}
              {view === 'local' && <LocalChangesView />}
              {view === 'history' && <HistoryView />}
              {view === 'code' && <CodeBrowserView />}
              {view === 'pr-list' && <PullRequestsView />}
              {view === 'pr-detail' && <PullRequestDetailView />}
              {view === 'issues' && <IssuesView />}
            </Suspense>
          </ViewErrorBoundary>
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
