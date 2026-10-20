import { authHandlers } from './auth';
import { dashboardHandlers } from './dashboard';
import { inboxHandlers } from './inbox';
import { incidentHandlers } from './incidents';
import { notificationHandlers } from './notifications';
import { portalHandlers } from './portal';

/** Every mock handler in the app. Append a module's handlers as it lands. */
export const handlers = [...authHandlers, ...dashboardHandlers, ...inboxHandlers, ...incidentHandlers, ...notificationHandlers, ...portalHandlers];
