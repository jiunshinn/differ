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

const App = React.lazy(() => import('./App'));
const DesignSystemPage = React.lazy(() => import('./design/DesignSystemPage'));

initTheme();
console.log('[differ] renderer booted');

// The design system gallery lives at #/design-system (dev and packaged builds alike).
const isDesignSystem = window.location.hash.startsWith('#/design-system');

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Suspense fallback={null}>{isDesignSystem ? <DesignSystemPage /> : <App />}</Suspense>
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
