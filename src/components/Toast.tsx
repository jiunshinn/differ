import React from 'react';
import { useAppStore } from '../state/AppStore';
import { cn } from '../utils/cn';

export default function Toast() {
  const toast = useAppStore((state) => state.toast);
  if (!toast) return null;
  return (
    <div className="fixed bottom-8 right-8 z-50">
      <div
        className={cn(
          'px-3 py-2 rounded-lg shadow-raised text-sm border bg-bg-panel',
          toast.kind === 'error'
            ? 'border-danger text-danger'
            : toast.kind === 'success'
            ? 'border-success text-success'
            : 'border-border text-text-primary',
        )}
      >
        {toast.message}
      </div>
    </div>
  );
}
