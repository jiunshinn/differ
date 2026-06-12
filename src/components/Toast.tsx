import React from 'react';
import { useAppStore } from '../state/AppStore';
import { cn } from '../utils/cn';

export default function Toast() {
  const toast = useAppStore((state) => state.toast);
  const isError = toast?.kind === 'error';
  // Keep the live region mounted at all times so assistive tech reliably
  // announces each toast; errors are assertive, everything else polite.
  return (
    <div
      className="fixed bottom-8 right-8 z-50"
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      {toast && (
        <div
          // Key on the toast id so a replacement message re-triggers the live
          // region announcement even when toasts arrive back-to-back.
          key={toast.id}
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
      )}
    </div>
  );
}
