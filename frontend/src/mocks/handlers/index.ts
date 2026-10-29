import { approvalHandlers } from './approvals';
import { authHandlers } from './auth';
import { changeHandlers } from './changes';
import { dashboardHandlers } from './dashboard';
import { dataImportHandlers } from './data-import';
import { dispatchHandlers } from './dispatch';
import { ticketHandlingHandlers } from './ticket-handling';
import { inboxHandlers } from './inbox';
import { mailIntakeHandlers } from './mail-intake';
import { incidentHandlers } from './incidents';
import { knowledgeHandlers } from './knowledge';
import { notificationHandlers } from './notifications';
import { portalHandlers } from './portal';
import { problemHandlers } from './problems';
import { recordHandlers } from './records';
import { requestFormHandlers } from './request-forms';
import { businessHoursHandlers, slaHandlers } from './sla';

/** Every mock handler in the app. Append a module's handlers as it lands. */
export const handlers = [...approvalHandlers, ...authHandlers, ...changeHandlers, ...dashboardHandlers, ...dataImportHandlers, ...dispatchHandlers, ...inboxHandlers, ...incidentHandlers, ...knowledgeHandlers, ...mailIntakeHandlers, ...notificationHandlers, ...portalHandlers, ...problemHandlers, ...recordHandlers, ...requestFormHandlers, ...slaHandlers, ...businessHoursHandlers, ...ticketHandlingHandlers];
