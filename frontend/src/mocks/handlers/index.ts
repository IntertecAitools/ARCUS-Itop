import { approvalHandlers } from './approvals';
import { authHandlers } from './auth';
import { dashboardHandlers } from './dashboard';
import { inboxHandlers } from './inbox';
import { mailIntakeHandlers } from './mail-intake';
import { incidentHandlers } from './incidents';
import { notificationHandlers } from './notifications';
import { portalHandlers } from './portal';
import { problemHandlers } from './problems';
import { recordHandlers } from './records';
import { requestFormHandlers } from './request-forms';

/** Every mock handler in the app. Append a module's handlers as it lands. */
export const handlers = [...approvalHandlers, ...authHandlers, ...dashboardHandlers, ...inboxHandlers, ...incidentHandlers, ...mailIntakeHandlers, ...notificationHandlers, ...portalHandlers, ...problemHandlers, ...recordHandlers, ...requestFormHandlers];
