import { badRequest } from "../../core/errors.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects, type FlatObject } from "../../itop/normalize.js";
import { oqlString } from "../../shared/ticket-mapping.js";
import type { NotificationsService, RuleInput } from "../admin/notifications.service.js";

/**
 * Who is told what about approvals, set up once per iTop (idempotent: run it
 * again after changing APP_BASE_URL or the sender).
 *
 *   approvers   when their answer is awaited (and reminded, when a level has
 *               a timeout): the extension's own TriggerOnApprovalRequest, with
 *               an email action of ours whose link opens the approval in the
 *               platform instead of iTop's page, and a bell entry;
 *   requesters  when their request is approved or rejected: two ordinary
 *               notification rules (state entered), listed and editable on
 *               the Notifications screen like any other.
 *
 * iTop sends all of them, so they fire whoever or whatever moved the request
 * on (an answer here, a timeout in iTop's cron).
 */

export const APPROVER_EMAIL = "Platform: approval requested";
export const APPROVER_BELL = "Platform: approval requested (in the app)";
export const REQUESTER_RULES = {
  approved: "Request approved: tell the requester",
  rejected: "Request rejected: tell the requester",
} as const;

const COMMENT = "Approval notifications set up by the platform";

export interface ApprovalNotificationsResult {
  triggerId: number;
  approverEmailId: number;
  approverBellId: number;
  /** Rule ids, or the names of rules that already existed and were left as they are. */
  requesterRules: Record<keyof typeof REQUESTER_RULES, number | "kept">;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function ensureApprovalNotifications(
  client: ItopClient,
  notifications: NotificationsService,
  options: { appBaseUrl: string | undefined; sender: { address: string; label: string } | undefined },
): Promise<ApprovalNotificationsResult> {
  const { appBaseUrl, sender } = options;
  if (!appBaseUrl) throw badRequest("Set APP_BASE_URL: the approval emails link to the platform.");
  if (!sender) throw badRequest("Set NOTIFICATION_FROM (or MAIL_FROM): the address approval emails come from.");
  const link = `${appBaseUrl}/approvals/$approval_scheme->id$`;

  const one = async (cls: string, oql: string, fields = "id"): Promise<FlatObject | undefined> =>
    normalizeObjects((await client.call("core/get", { class: cls, key: oql, output_fields: fields, limit: 1 })).objects)[0];
  const upsert = async (cls: string, existing: FlatObject | undefined, fields: Record<string, unknown>) => {
    const result = existing
      ? await client.call("core/update", { class: cls, key: existing.id, fields, output_fields: "id", comment: COMMENT })
      : await client.call("core/create", { class: cls, fields, output_fields: "id", comment: COMMENT });
    return normalizeObjects(result.objects)[0]!.id;
  };

  // The extension's trigger (its installer creates one; make one if not).
  const trigger = await one("TriggerOnApprovalRequest", "SELECT TriggerOnApprovalRequest WHERE target_class = 'UserRequest'");
  const triggerId = await upsert("TriggerOnApprovalRequest", trigger, {
    description: "Approval requested",
    target_class: "UserRequest",
  });

  const approverEmailId = await upsert(
    "ActionEmailApprovalRequest",
    await one("ActionEmailApprovalRequest", `SELECT ActionEmailApprovalRequest WHERE name = '${oqlString(APPROVER_EMAIL)}'`),
    {
      name: APPROVER_EMAIL,
      description: "Asks an approver for their answer, with a link to the platform.",
      status: "enabled",
      language: "EN US",
      from: sender.address,
      from_label: sender.label,
      subject: "Your approval is requested: $this->ref$",
      subject_reminder: "Reminder: your approval is requested: $this->ref$",
      body: [
        "<p>Hello $approver->html(first_name)$,</p>",
        "<p>Your approval is requested for $this->html(ref)$, raised by $this->html(caller_id_friendlyname)$.</p>",
        "<p><b>Title</b>: $this->html(title)$<br><b>Service</b>: $this->html(service_name)$ / $this->html(servicesubcategory_name)$</p>",
        `<p><a href="${escapeHtml(link)}">Approve or reject it in the helpdesk</a></p>`,
      ].join("\n"),
    },
  );

  const approverBellId = await upsert(
    "ActionNewsroom",
    await one("ActionNewsroom", `SELECT ActionNewsroom WHERE name = '${oqlString(APPROVER_BELL)}'`),
    {
      name: APPROVER_BELL,
      status: "enabled",
      language: "EN US",
      priority: "2",
      // The approver this request was sent to (the trigger runs once per approver).
      recipients: "SELECT Person WHERE id = :approver->id",
      title: "Your approval is requested: $this->ref$",
      message: "$this->title$",
      url: link,
    },
  );

  for (const [order, actionId] of [
    [1, approverEmailId],
    [2, approverBellId],
  ] as const) {
    const linked = await one("lnkTriggerAction", `SELECT lnkTriggerAction WHERE trigger_id = ${triggerId} AND action_id = ${actionId}`);
    if (!linked) {
      await client.call("core/create", {
        class: "lnkTriggerAction",
        fields: { trigger_id: triggerId, action_id: actionId, order },
        output_fields: "id",
        comment: COMMENT,
      });
    }
  }

  // Requesters: ordinary rules. An existing one (by name) is left alone, so
  // an administrator's edits survive a re-run.
  const rules = await notifications.list();
  const requesterRules = {} as ApprovalNotificationsResult["requesterRules"];
  for (const state of ["approved", "rejected"] as const) {
    const name = REQUESTER_RULES[state];
    if (rules.some((r) => r.name === name)) {
      requesterRules[state] = "kept";
      continue;
    }
    const input: RuleInput = {
      name,
      event: { kind: "state_entered", recordType: "UserRequest", state },
      email: {
        to: [{ kind: "caller" }],
        cc: [],
        subject: `Your request {{ref}} was ${state}`,
        body:
          state === "approved"
            ? "Hello {{caller}},\n\nYour request {{ref}} ({{title}}) was approved. The service desk takes it from here.\n\n{{link}}"
            : "Hello {{caller}},\n\nYour request {{ref}} ({{title}}) was rejected. The approver's reason is shown on the request.\n\n{{link}}",
        status: "on",
      },
      inApp: { on: true, message: `{{ref}} was ${state}: {{title}}` },
    };
    requesterRules[state] = (await notifications.create(input)).id;
  }

  return { triggerId, approverEmailId, approverBellId, requesterRules };
}
