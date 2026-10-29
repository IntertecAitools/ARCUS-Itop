import { badRequest, notFound } from "../../core/errors.js";
import { currentTenant } from "../../core/request-context.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects, type FlatObject } from "../../itop/normalize.js";
import { str } from "../../shared/ticket-mapping.js";
import type { ChangeStatus, ChangeType } from "./changes.types.js";

/** iTop's change classes, and which of our types each is. */
export const TYPE_OF_CLASS: Record<string, ChangeType> = {
  RoutineChange: "routine",
  NormalChange: "normal",
  EmergencyChange: "emergency",
};

export const TYPE_CLASS: Record<ChangeType, string> = {
  routine: "RoutineChange",
  normal: "NormalChange",
  emergency: "EmergencyChange",
};

export const STATUS: Record<string, ChangeStatus> = {
  new: "new",
  validated: "validated",
  rejected: "rejected",
  assigned: "assigned",
  plannedscheduled: "planned",
  approved: "approved",
  notapproved: "not_approved",
  implemented: "implemented",
  monitored: "monitored",
  closed: "closed",
};

/** iTop's codes for the states after a change went in. */
export const DONE_STATUSES = ["implemented", "monitored", "closed"];

/** The tenant a stored rule or record belongs to ("" without tenancy). */
export const tenantKey = (): string => currentTenant()?.id ?? "";

export interface ChangeHead {
  id: number;
  className: string;
  type: ChangeType;
  /** iTop's status code. */
  status: string;
  ref: string;
  title: string;
  fields: Record<string, unknown>;
}

export function toHead(row: FlatObject): ChangeHead {
  const type = TYPE_OF_CLASS[row.class];
  if (!type) throw badRequest(`${row.class} is not a routine, normal or emergency change.`);
  return {
    id: row.id,
    className: row.class,
    type,
    status: str(row.fields["status"]),
    ref: str(row.fields["ref"]),
    title: str(row.fields["title"]),
    fields: row.fields,
  };
}

/** One change, as whichever class it really is. */
export async function readChange(client: ItopClient, id: number, extraFields = ""): Promise<ChangeHead> {
  const result = await client.call("core/get", {
    class: "Change",
    key: id,
    output_fields: ["ref", "title", "status", extraFields].filter(Boolean).join(","),
  });
  const row = normalizeObjects(result.objects)[0];
  if (!row) throw notFound(`Change ${id} was not found.`);
  return toHead(row);
}
