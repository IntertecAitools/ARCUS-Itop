import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** Same fake BFF for Vitest */
export const server = setupServer(...handlers);
