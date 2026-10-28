import { approvalHandlers } from './approvals';
import { authHandlers } from './auth';
import { changeHandlers } from './changes';
import { dashboardHandlers } from './dashboard';
import { inboxHandlers } from './inbox';
import { mailIntakeHandlers } from './mail-intake';
import { incidentHandlers } from './incidents';
import { notificationHandlers } from './notifications';
import { portalHandlers } from './portal';
import { problemHandlers } from './problems';
import { recordHandlers } from './records';
import { requestFormHandlers } from './request-forms';
import { businessHoursHandlers, slaHandlers } from './sla';

/** Every mock handler in the app. Append a module's handlers as it lands. */
export const handlers = [...approvalHandlers, ...authHandlers, ...changeHandlers, ...dashboardHandlers, ...inboxHandlers, ...incidentHandlers, ...mailIntakeHandlers, ...notificationHandlers, ...portalHandlers, ...problemHandlers, ...recordHandlers, ...requestFormHandlers, ...slaHandlers, ...businessHoursHandlers];
