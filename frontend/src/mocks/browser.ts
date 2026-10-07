import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

/** Browser-side MSW worker. Started from `main.tsx` before React mounts. */
export const worker = setupWorker(...handlers);
