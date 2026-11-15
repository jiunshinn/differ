import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './index.css';
import { queryClient } from './query/client';
import { initTheme } from './utils/theme';
import { TooltipProvider } from './ui';

const AppShell = React.lazy(() => import('./shell/AppShell'));
const GitReviewApp = React.lazy(() => import('./App'));
const DesignSystemPage = React.lazy(() => import('./design/DesignSystemPage'));

initTheme();
console.log('[differ] renderer booted');

// Direct routes (dev and packaged builds alike):
//   #/design-system  design system gallery
//   #/git-review     the original Git/GitHub review app, until it's rebuilt on the new design
const hash = window.location.hash;
const route = hash.startsWith('#/design-system') ? 'design' : hash.startsWith('#/git-review') ? 'git' : 'app';

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Suspense fallback={null}>{route === 'design' ? <DesignSystemPage /> : route === 'git' ? <GitReviewApp /> : <AppShell />}</Suspense>
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
