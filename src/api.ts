import type { DifferApi } from '@shared/api';
import type { ChangedFile } from '@shared/types';

declare global {
  interface Window {
    differ: DifferApi;
  }
}

const bridge = (window as unknown as { differ?: DifferApi }).differ;
if (!bridge) {
  throw new Error('differ preload bridge missing: window.differ is undefined');
}

export const api: DifferApi = bridge;

export type { DifferApi };
export type { ChangedFile };
