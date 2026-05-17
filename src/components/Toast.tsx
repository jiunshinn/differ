import React from 'react';
import { useApp } from '../state/AppStore';
import { cn } from '../utils/cn';

export default function Toast() {
  const { state } = useApp();
  if (!state.toast) return null;
  return (
    <div className="fixed bottom-8 right-8 z-50">
      <div
        className={cn(
          'px-3 py-2 rounded-lg shadow-raised text-sm border bg-bg-panel',
          state.toast.kind === 'error'
            ? 'border-danger text-danger'
            : state.toast.kind === 'success'
            ? 'border-success text-success'
            : 'border-border text-text-primary',
        )}
      >
        {state.toast.message}
      </div>
    </div>
  );
}
