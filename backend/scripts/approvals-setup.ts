/**
 * Sets up the approval notifications in iTop (see backend/README.md,
 * "Approvals"): the approver email and bell entry on the extension's trigger,
 * and the "approved" / "rejected" rules for requesters. Idempotent.
 *
 *   npm run approvals:setup
 *
 * Runs as the service account in .env (ITOP_USER), with APP_BASE_URL and
 * NOTIFICATION_FROM (or MAIL_FROM) from the same file. Administrators can do
 * the same from a running BFF: POST /api/admin/approvals/notifications.
 */

import { loadConfig } from "../src/config/env.js";
import { runAsServiceAccount } from "../src/core/request-context.js";
import { ensureApprovalNotifications } from "../src/platform/approvals/approval-notifications.js";
import { buildServices } from "../src/services.js";

const config = loadConfig();
const services = buildServices(config);
try {
  const result = await runAsServiceAccount(() =>
    ensureApprovalNotifications(services.client, services.notifications, {
      appBaseUrl: config.appBaseUrl,
      sender: config.notificationSender,
    }),
  );
  console.log(`Approval notifications ready on ${config.itop.baseUrl}:`, result);
} finally {
  await services.sessions.close();
}
