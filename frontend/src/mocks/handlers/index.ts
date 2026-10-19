import { authHandlers } from './auth';
import { dashboardHandlers } from './dashboard';
import { incidentHandlers } from './incidents';

/** Every mock handler in the app. Append a module's handlers as it lands. */
export const handlers = [...authHandlers, ...dashboardHandlers, ...incidentHandlers];
