import React from 'react';
import { useApp } from '../state/AppStore';
import { cn } from '../utils/cn';

export default function Toast() {
  const { state } = useApp();
  if (!state.toast) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div
        className={cn(
          'px-3 py-2 rounded shadow-lg text-sm border',
          state.toast.kind === 'error'
            ? 'bg-danger/15 border-danger text-red-200'
            : state.toast.kind === 'success'
            ? 'bg-success/15 border-success text-emerald-200'
            : 'bg-bg-subtle border-border text-text-primary',
        )}
      >
        {state.toast.message}
      </div>
    </div>
  );
}
