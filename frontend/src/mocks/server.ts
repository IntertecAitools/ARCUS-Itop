import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** Node-side MSW server, used by Vitest. See `src/test/setup.ts`. */
export const server = setupServer(...handlers);
