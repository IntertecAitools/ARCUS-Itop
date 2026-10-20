import { badRequest, notFound } from "../../core/errors.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects, parseFoundCount, type FlatObject } from "../../itop/normalize.js";
import type { CmdbSchema } from "../../schema/load.js";
import type { ClassInfo } from "../../schema/types.js";
import { str } from "../../shared/ticket-mapping.js";
import { criterionKind, type Criterion } from "../objects/criteria.js";
import { conditionsToFilter, filterToConditions } from "./conditions.js";

/**
 * Email notification rules, in our vocabulary.
 *
 * iTop sends notification emails itself: it is the only place that sees every
 * change, including the ones its background jobs make (SLA escalations,
 * auto-resolve). What it lacks is a screen anyone should have to open. This
 * service is that screen's backend: it reads and writes iTop's Trigger,
 * ActionEmail and lnkTriggerAction objects and presents each link between a
 * trigger and an email as one rule -- "when X happens to a Y, email Z".
 *
 * Nothing iTop-shaped leaves this file: no OQL, no trigger class names, no
 * `$this->…$` placeholders. Recipients are roles ("the caller") or people;
 * texts use `{{ref}}`-style fields; links point at our app, not iTop.
 */

/** What starts a rule. The last three exist in iTop but cannot be created here. */
export const EDITABLE_EVENTS = [
  "created",
  "updated",
  "deleted",
  "state_entered",
  "state_left",
  "sla_threshold",
] as const;
export type EditableEvent = (typeof EDITABLE_EVENTS)[number];
export type EventKind = EditableEvent | "mentioned" | "portal_update" | "other";

const TRIGGER_CLASS: Record<EditableEvent, string> = {
  created: "TriggerOnObjectCreate",
  updated: "TriggerOnObjectUpdate",
  deleted: "TriggerOnObjectDelete",
  state_entered: "TriggerOnStateEnter",
  state_left: "TriggerOnStateLeave",
  sla_threshold: "TriggerOnThresholdReached",
};

function eventKindOf(triggerClass: string): EventKind {
  for (const [kind, cls] of Object.entries(TRIGGER_CLASS)) if (cls === triggerClass) return kind as EditableEvent;
  if (triggerClass === "TriggerOnObjectMention") return "mentioned";
  if (triggerClass === "TriggerOnPortalUpdate") return "portal_update";
  return "other";
}

export const SLA_TIMERS = ["tto", "ttr"] as const;
export const SLA_PERCENTS = ["75", "100"] as const;

export type Role = "caller" | "agent" | "team" | "mentioned";
export const ROLES: Role[] = ["caller", "agent", "team", "mentioned"];

export type Recipient =
  | { kind: Role }
  | { kind: "people"; people: Array<{ id: number; name: string }> }
  /** Part of a list set up outside this screen; kept as it is. */
  | { kind: "custom"; index: number };

export type RecipientInput =
  | { kind: Role }
  | { kind: "people"; ids: number[] }
  | { kind: "custom"; index: number };

export type EmailStatus = "on" | "test" | "off";
const STATUS_TO_ITOP: Record<EmailStatus, string> = { on: "enabled", test: "test", off: "disabled" };
const STATUS_FROM_ITOP: Record<string, EmailStatus> = { enabled: "on", test: "test", disabled: "off" };

export interface RuleEvent {
  kind: EventKind;
  recordType: string;
  state?: string;
  fields?: string[];
  sla?: { timer: string; percent: string };
  /** True when the rule has any "only when…" condition. */
  hasCondition: boolean;
  /** The conditions this screen can show and edit. */
  conditions: Criterion[];
  /** Part of the condition was set up in iTop in a form not shown here; it is kept. */
  keptCondition: boolean;
  /** Names for record ids in key conditions, keyed "field:id". */
  valueLabels: Record<string, string>;
  /**
   * False for events only iTop's own screens raise (an @mention in iTop's
   * editor, an update from iTop's portal): nothing done in this platform
   * fires them.
   */
  firesFromPlatform: boolean;
  /** Display names for the codes above, so screens never show "team_id". */
  labels: { recordType: string; state?: string; fields?: string[] };
}

export interface RuleDto {
  /** The trigger–email link: one rule. */
  id: number;
  name: string;
  event: RuleEvent;
  email: {
    to: Recipient[];
    cc: Recipient[];
    subject: string;
    body: string;
    status: EmailStatus;
    testRecipient: string;
    /** Other rules sending this same email: editing it changes them too. */
    sharedWith: number;
  };
  /** Also shown in the app's bell (an iTop newsroom action on the same trigger). */
  inApp: { on: boolean; message: string };
}

export interface RuleInput {
  name: string;
  event: {
    kind: EditableEvent;
    recordType: string;
    state?: string;
    fields?: string[];
    sla?: { timer: string; percent: string };
    /** "Only when…" conditions, ANDed. */
    conditions?: Criterion[];
    /** Keep the part of the condition set up in iTop (default true). */
    keepCondition?: boolean;
  };
  email: {
    to: RecipientInput[];
    cc: RecipientInput[];
    subject: string;
    body: string;
    status: EmailStatus;
    testRecipient?: string;
  };
  /** Also notify in the app's bell, to the same recipients as the email's To. */
  inApp?: { on: boolean; message: string };
}

/* ------------------------------------------------------------------------ *
 * Recipients <-> iTop's recipient queries
 * ------------------------------------------------------------------------ */

const ROLE_CONDITION: Record<Role, string> = {
  caller: "id = :this->caller_id",
  agent: "id = :this->agent_id",
  team:
    "id IN (SELECT Person AS p JOIN lnkPersonToTeam AS l ON l.person_id = p.id " +
    "WHERE l.team_id = :this->team_id)",
  mentioned: "id = :mentioned->id",
};

const PREFIX = "SELECT Person WHERE ";

/** Splits on OR at bracket depth 0, so a sub-query's own ORs stay inside it. */
function splitTopLevelOr(where: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < where.length; i++) {
    const c = where[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
    } else if (depth === 0 && /^\sOR\s/i.test(where.slice(i, i + 4))) {
      parts.push(where.slice(start, i).trim());
      start = i + 4;
      i += 3;
    }
  }
  parts.push(where.slice(start).trim());
  return parts.filter(Boolean);
}

const unwrap = (s: string) => (s.startsWith("(") && s.endsWith(")") ? s.slice(1, -1).trim() : s);
const normalise = (s: string) => s.replace(/\s+/g, " ").trim();

/** Parsed recipient query: recognised roles and people, and whatever else it held. */
export interface ParsedRecipients {
  roles: Role[];
  personIds: number[];
  custom: string[];
}

export function parseRecipients(oql: string): ParsedRecipients {
  const parsed: ParsedRecipients = { roles: [], personIds: [], custom: [] };
  const text = normalise(oql);
  if (!text) return parsed;
  if (!text.toUpperCase().startsWith(PREFIX.toUpperCase())) {
    parsed.custom.push(text);
    return parsed;
  }
  for (const raw of splitTopLevelOr(text.slice(PREFIX.length))) {
    const part = normalise(unwrap(raw));
    const role = ROLES.find((r) => normalise(ROLE_CONDITION[r]).toLowerCase() === part.toLowerCase());
    if (role) {
      parsed.roles.push(role);
      continue;
    }
    const single = /^id = (\d+)$/i.exec(part);
    const many = /^id IN \(([\d,\s]+)\)$/i.exec(part);
    if (single) parsed.personIds.push(Number(single[1]));
    else if (many) parsed.personIds.push(...many[1]!.split(",").map((n) => Number(n.trim())).filter(Boolean));
    else parsed.custom.push(part);
  }
  return parsed;
}

/** Builds iTop's recipient query; `kept` supplies custom parts by index. */
export function buildRecipients(input: RecipientInput[], kept: string[]): string {
  const conditions: string[] = [];
  const ids = new Set<number>();
  for (const r of input) {
    if (r.kind === "people") r.ids.forEach((id) => ids.add(id));
    else if (r.kind === "custom") {
      const part = kept[r.index];
      if (part === undefined) throw badRequest("A recipient set up earlier no longer exists; reload and try again.");
      // A whole query of another shape cannot be combined with anything else.
      if (part.toUpperCase().startsWith("SELECT ")) {
        if (input.length > 1) {
          throw badRequest(
            "These recipients were set up as a custom list that cannot be combined with others. Remove it to choose recipients here.",
          );
        }
        return part;
      }
      conditions.push(`(${part})`);
    } else if (!conditions.includes(ROLE_CONDITION[r.kind])) conditions.push(ROLE_CONDITION[r.kind]);
  }
  if (ids.size) conditions.push(`id IN (${[...ids].join(", ")})`);
  return conditions.length ? PREFIX + conditions.join(" OR ") : "";
}

/* ------------------------------------------------------------------------ *
 * Texts: {{field}} <-> $this->…$
 * ------------------------------------------------------------------------ */

interface Token {
  token: string;
  label: string;
  /** The attribute the class must have for this field to make sense; "" for any class. */
  needs: string;
  placeholder: string;
}

const TOKENS: Token[] = [
  { token: "display_name", label: "Display name", needs: "", placeholder: "$this->friendlyname$" },
  { token: "ref", label: "Reference", needs: "ref", placeholder: "$this->ref$" },
  { token: "title", label: "Title", needs: "title", placeholder: "$this->title$" },
  { token: "name", label: "Name", needs: "name", placeholder: "$this->name$" },
  { token: "status", label: "Status", needs: "status", placeholder: "$this->status$" },
  { token: "priority", label: "Priority", needs: "priority", placeholder: "$this->priority$" },
  { token: "caller", label: "Caller", needs: "caller_id", placeholder: "$this->caller_id_friendlyname$" },
  { token: "agent", label: "Assigned agent", needs: "agent_id", placeholder: "$this->agent_id_friendlyname$" },
  { token: "team", label: "Team", needs: "team_id", placeholder: "$this->team_id_friendlyname$" },
  { token: "organization", label: "Organization", needs: "org_id", placeholder: "$this->org_id_friendlyname$" },
  {
    token: "latest_update",
    label: "Latest public update",
    needs: "public_log",
    placeholder: "$this->head_html(public_log)$",
  },
  { token: "changed_by", label: "Who made the change", needs: "", placeholder: "$current_contact->friendlyname$" },
  {
    token: "mentioned_first_name",
    label: "First name of the person mentioned (mention rules)",
    needs: "",
    placeholder: "$mentioned->first_name$",
  },
];

const LINK_TEXT = "Open it in the helpdesk";

export function availableTokens(info: ClassInfo | undefined, canLink: boolean) {
  const tokens = TOKENS.filter((t) => !info || !t.needs || info.fields[t.needs]).map(({ token, label }) => ({
    token,
    label,
  }));
  return canLink ? [...tokens, { token: "link", label: "Link to the record" }] : tokens;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&");
}

function linkHtml(appBaseUrl: string, recordType: string): string {
  return `<a href="${escapeHtml(appBaseUrl)}/records/${recordType}/$this->id$">${LINK_TEXT}</a>`;
}

function tokensToPlaceholders(text: string, recordType: string, appBaseUrl: string | undefined, html: boolean): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, name: string) => {
    if (name === "link") {
      if (!appBaseUrl) {
        throw badRequest("Links need APP_BASE_URL (the platform's public address) set on the server.");
      }
      return html ? linkHtml(appBaseUrl, recordType) : `${appBaseUrl}/records/${recordType}/$this->id$`;
    }
    const token = TOKENS.find((t) => t.token === name);
    if (!token) throw badRequest(`Unknown field {{${name}}}.`);
    return token.placeholder;
  });
}

/** Our plain text (blank line = paragraph) to the HTML body iTop sends. */
export function bodyToItop(text: string, recordType: string, appBaseUrl: string | undefined): string {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .map((p) => tokensToPlaceholders(p, recordType, appBaseUrl, true))
    .join("\n");
}

export function subjectToItop(text: string, recordType: string, appBaseUrl: string | undefined): string {
  return tokensToPlaceholders(text.replace(/[\r\n]+/g, " ").trim(), recordType, appBaseUrl, false);
}

function placeholdersToTokens(text: string): string {
  let out = text
    // iTop's own link into its back office (or its portal) becomes ours.
    .replace(/\$this->hyperlink\([^)]*\)\$/g, "{{link}}")
    .replace(/https?:\/\/[^\s"'<>]*\/records\/[A-Za-z0-9_]+\/\$this->id\$/g, "{{link}}");
  for (const t of TOKENS) out = out.split(t.placeholder).join(`{{${t.token}}}`);
  return out;
}

/** iTop's HTML body back to our plain text, for editing. */
/** Our record link as iTop stores it: its HTML cleaner URL-encodes the `$`. */
const STORED_LINK = /<a\b[^>]*href="[^"]*\/records\/[A-Za-z0-9_]+\/(?:%24|\$)this-(?:&gt;|>)id(?:%24|\$)"[^>]*>.*?<\/a>/gis;

/** iTop's HTML body back to our plain text, for editing. */
export function bodyFromItop(html: string): string {
  const withLinks = html.replace(STORED_LINK, "{{link}}");
  const text = decodeEntities(
    withLinks
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h\d)>/gi, "\n\n")
      .replace(/<[^>]+>/g, ""),
  );
  return placeholdersToTokens(text)
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function subjectFromItop(subject: string): string {
  return placeholdersToTokens(decodeEntities(subject));
}

/* ------------------------------------------------------------------------ */

interface Snapshot {
  links: Array<{ id: number; triggerId: number; actionId: number }>;
  triggers: Map<number, FlatObject>;
  emails: Map<number, FlatObject>;
  /** iTop's in-app (newsroom) actions. */
  inApp: Map<number, FlatObject>;
}

export interface SentEmail {
  id: number;
  date: string;
  to: string;
  subject: string;
  /** iTop's own note on the send, e.g. "Notification sent" or an error. */
  result: string;
  rule: string;
  record: { type: string; id: number } | null;
}

export class NotificationsService {
  constructor(
    private readonly client: ItopClient,
    private readonly schema: CmdbSchema,
    private readonly appBaseUrl: string | undefined,
    private readonly sender: { address: string; label: string } | undefined,
  ) {}

  private async get(cls: string, oql: string, fields: string): Promise<FlatObject[]> {
    const result = await this.client.call("core/get", { class: cls, key: oql, output_fields: fields });
    return normalizeObjects(result.objects);
  }

  private async snapshot(): Promise<Snapshot> {
    const [links, triggers, emails, inApp] = await Promise.all([
      this.get("lnkTriggerAction", "SELECT lnkTriggerAction", "id,trigger_id,action_id"),
      // `*+` reads each trigger's own subclass attributes (state, fields…).
      this.get("Trigger", "SELECT Trigger", "*+"),
      this.get(
        "ActionEmail",
        "SELECT ActionEmail",
        "id,name,status,test_recipient,to,cc,bcc,subject,body",
      ),
      this.get("ActionNewsroom", "SELECT ActionNewsroom", "id,name,status,title,message,recipients"),
    ]);
    return {
      links: links.map((l) => ({
        id: l.id,
        triggerId: Number(l.fields["trigger_id"]),
        actionId: Number(l.fields["action_id"]),
      })),
      triggers: new Map(triggers.map((t) => [t.id, t])),
      emails: new Map(emails.map((e) => [e.id, e])),
      inApp: new Map(inApp.map((a) => [a.id, a])),
    };
  }

  /** The in-app action on a trigger, and its link, if there is one. */
  private inAppOf(snap: Snapshot, triggerId: number) {
    const link = snap.links.find((l) => l.triggerId === triggerId && snap.inApp.has(l.actionId));
    return link ? { link, action: snap.inApp.get(link.actionId)! } : undefined;
  }

  async list(): Promise<RuleDto[]> {
    const snap = await this.snapshot();
    const personIds = new Set<number>();
    for (const e of snap.emails.values()) {
      for (const f of ["to", "cc"]) parseRecipients(str(e.fields[f])).personIds.forEach((id) => personIds.add(id));
    }
    const names = await this.personNames([...personIds]);
    const valueLabels = await this.conditionValueLabels([...snap.triggers.values()]);
    return snap.links
      .filter((l) => snap.emails.has(l.actionId) && snap.triggers.has(l.triggerId))
      .map((l) => this.toDto(l, snap, names, valueLabels.get(l.triggerId) ?? {}))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getRule(id: number): Promise<RuleDto> {
    const rule = (await this.list()).find((r) => r.id === id);
    if (!rule) throw notFound(`No notification rule ${id}.`);
    return rule;
  }

  /** The parsed filter of a trigger, against its own class. */
  private parseFilter(trigger: FlatObject) {
    const info = this.schema.get(str(trigger.fields["target_class"]));
    const filter = str(trigger.fields["filter"]);
    if (!filter) return { conditions: [], kept: [] };
    return info ? filterToConditions(info, filter) : { conditions: [], kept: [filter] };
  }

  /** Names of the records key conditions point at, per trigger. */
  private async conditionValueLabels(triggers: FlatObject[]): Promise<Map<number, Record<string, string>>> {
    const wanted = new Map<string, Set<string>>(); // target class -> ids
    const uses: Array<{ triggerId: number; field: string; target: string; ids: string[] }> = [];
    for (const trigger of triggers) {
      const info = this.schema.get(str(trigger.fields["target_class"]));
      if (!info) continue;
      for (const c of this.parseFilter(trigger).conditions) {
        const target = info.fields[c.field]?.target;
        if (!target || !c.values?.length) continue;
        const ids = c.values.map(String);
        uses.push({ triggerId: trigger.id, field: c.field, target, ids });
        const set = wanted.get(target) ?? new Set<string>();
        ids.forEach((id) => set.add(id));
        wanted.set(target, set);
      }
    }
    const names = new Map<string, string>(); // "Class:id" -> name
    await Promise.all(
      [...wanted].map(async ([cls, ids]) => {
        const rows = await this.get(cls, `SELECT ${cls} WHERE id IN (${[...ids].join(",")})`, "id,friendlyname");
        rows.forEach((r) => names.set(`${cls}:${r.id}`, str(r.fields["friendlyname"])));
      }),
    );
    const out = new Map<number, Record<string, string>>();
    for (const u of uses) {
      const labels = out.get(u.triggerId) ?? {};
      for (const id of u.ids) labels[`${u.field}:${id}`] = names.get(`${u.target}:${id}`) ?? `#${id}`;
      out.set(u.triggerId, labels);
    }
    return out;
  }

  private toDto(
    link: Snapshot["links"][number],
    snap: Snapshot,
    names: Map<number, string>,
    valueLabels: Record<string, string>,
  ): RuleDto {
    const trigger = snap.triggers.get(link.triggerId)!;
    const email = snap.emails.get(link.actionId)!;
    const t = trigger.fields;
    const kind = eventKindOf(trigger.class);
    const recipients = (oql: string): Recipient[] => {
      const p = parseRecipients(oql);
      return [
        ...p.roles.map((kind) => ({ kind })),
        ...(p.personIds.length
          ? [{ kind: "people" as const, people: p.personIds.map((id) => ({ id, name: names.get(id) ?? `#${id}` })) }]
          : []),
        ...p.custom.map((_, index) => ({ kind: "custom" as const, index })),
      ];
    };
    const attcodes = str(t["target_attcodes"]);
    const fieldCodes = attcodes ? attcodes.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const recordType = str(t["target_class"]);
    const info = this.schema.get(recordType);
    const state = str(t["state"]);
    return {
      id: link.id,
      name: str(email.fields["name"]),
      event: {
        kind,
        recordType: str(t["target_class"]),
        ...(str(t["state"]) ? { state: str(t["state"]) } : {}),
        ...(fieldCodes.length ? { fields: fieldCodes } : {}),
        ...(kind === "sla_threshold"
          ? { sla: { timer: str(t["stop_watch_code"]), percent: str(t["threshold_index"]) } }
          : {}),
        hasCondition: Boolean(str(t["filter"])),
        conditions: this.parseFilter(trigger).conditions,
        keptCondition: this.parseFilter(trigger).kept.length > 0,
        valueLabels,
        firesFromPlatform: kind !== "mentioned" && kind !== "portal_update",
        labels: {
          recordType: info?.labels.class || recordType,
          ...(state ? { state: info?.labels.values[info.lifecycle?.attribute ?? ""]?.[state] ?? state } : {}),
          ...(fieldCodes.length ? { fields: fieldCodes.map((f) => info?.labels.fields[f] ?? f) } : {}),
        },
      },
      email: {
        to: recipients(str(email.fields["to"])),
        cc: recipients(str(email.fields["cc"])),
        subject: subjectFromItop(str(email.fields["subject"])),
        body: bodyFromItop(str(email.fields["body"])),
        status: STATUS_FROM_ITOP[str(email.fields["status"])] ?? "off",
        testRecipient: str(email.fields["test_recipient"]),
        sharedWith: snap.links.filter((l) => l.actionId === link.actionId).length - 1,
      },
      inApp: (() => {
        const found = this.inAppOf(snap, link.triggerId);
        return found
          ? {
              on: str(found.action.fields["status"]) === "enabled",
              message: subjectFromItop(str(found.action.fields["message"])),
            }
          : { on: false, message: "" };
      })(),
    };
  }

  /**
   * Makes the trigger's in-app action match the rule: created or updated
   * (same recipients as the email's To, the subject as its title) when on;
   * removed when off and nothing else uses it.
   */
  private async syncInApp(snap: Snapshot | null, triggerId: number, input: RuleInput, keptTo: string[]): Promise<void> {
    const found = snap ? this.inAppOf(snap, triggerId) : undefined;
    const comment = "Notification rule edited in the platform";
    if (!input.inApp?.on) {
      if (!found) return;
      const usedElsewhere = snap!.links.some((l) => l.actionId === found.link.actionId && l.triggerId !== triggerId);
      await this.client.call(
        "core/delete",
        usedElsewhere
          ? { class: "lnkTriggerAction", key: found.link.id, comment }
          : { class: "ActionNewsroom", key: found.link.actionId, comment },
      );
      return;
    }
    const { recordType } = input.event;
    const fields = {
      name: `${input.name.trim()} (in the app)`.slice(0, 255),
      status: "enabled",
      title: subjectToItop(input.email.subject, recordType, this.appBaseUrl),
      message: subjectToItop(input.inApp.message || input.email.subject, recordType, this.appBaseUrl),
      recipients: buildRecipients(input.email.to, keptTo),
      // iTop's own link; the platform opens the record itself, from the event.
      url: "$this->url()$",
    };
    if (found) {
      await this.client.call("core/update", {
        class: "ActionNewsroom",
        key: found.link.actionId,
        fields,
        output_fields: "id",
        comment,
      });
      return;
    }
    const created = await this.client.call("core/create", {
      class: "ActionNewsroom",
      fields: { ...fields, language: "EN US", priority: "3" },
      output_fields: "id",
      comment,
    });
    await this.client.call("core/create", {
      class: "lnkTriggerAction",
      fields: { trigger_id: triggerId, action_id: normalizeObjects(created.objects)[0]!.id, order: 2 },
      output_fields: "id",
      comment,
    });
  }

  private async personNames(ids: number[]): Promise<Map<number, string>> {
    if (!ids.length) return new Map();
    const rows = await this.get("Person", `SELECT Person WHERE id IN (${ids.join(",")})`, "id,friendlyname");
    return new Map(rows.map((r) => [r.id, str(r.fields["friendlyname"])]));
  }

  /** What the rule editor may offer, for one kind of record. */
  options(recordType?: string) {
    const recordTypes = this.schema
      .list()
      .map((c) => ({
        name: c.name,
        // A few iTop classes carry an untranslated format string as their label.
        label: c.labels.class && !c.labels.class.includes("%") ? c.labels.class : c.name,
        ticket: c.inherits.includes("Ticket") || c.name === "Ticket",
      }))
      .sort((a, b) => Number(b.ticket) - Number(a.ticket) || a.label.localeCompare(b.label));
    if (!recordType) return { recordTypes };

    const info = this.requireClass(recordType);
    const lifecycle = info.lifecycle;
    return {
      recordTypes,
      states: lifecycle
        ? Object.keys(lifecycle.states).map((code) => ({
            code,
            label: info.labels.values[lifecycle.attribute]?.[code] ?? code,
          }))
        : [],
      fields: info.writable
        .filter((code) => info.fields[code]?.ui === "scalar" || info.fields[code]?.ui === "picker")
        .map((code) => ({ code, label: info.labels.fields[code] ?? code })),
      slaTimers: SLA_TIMERS.filter((code) => info.fields[code]?.type === "StopWatch").map((code) => ({
        code,
        label: info.labels.fields[code] ?? code,
      })),
      slaPercents: [...SLA_PERCENTS],
      roles: ROLES.filter((r) => r !== "mentioned").filter((r) => info.fields[`${r}_id`]),
      tokens: availableTokens(info, Boolean(this.appBaseUrl)),
    };
  }

  private requireClass(name: string): ClassInfo {
    const info = this.schema.get(name);
    if (!info) throw badRequest(`Unknown kind of record "${name}".`);
    return info;
  }

  private validate(input: RuleInput): ClassInfo {
    const { event, email } = input;
    if (!input.name.trim()) throw badRequest("Give the rule a name.");
    const info = this.requireClass(event.recordType);
    if (event.kind === "state_entered" || event.kind === "state_left") {
      if (!event.state || !info.lifecycle?.states[event.state]) {
        throw badRequest(`Choose a status that ${info.labels.class || info.name} has.`);
      }
    }
    if (event.kind === "updated") {
      for (const f of event.fields ?? []) {
        if (!info.fields[f]) throw badRequest(`${info.name} has no field "${f}".`);
      }
    }
    if (event.kind === "sla_threshold") {
      const sla = event.sla;
      if (!sla || !SLA_TIMERS.includes(sla.timer as never) || info.fields[sla.timer]?.type !== "StopWatch") {
        throw badRequest(`${info.labels.class || info.name} has no such SLA timer.`);
      }
      if (!SLA_PERCENTS.includes(sla.percent as never)) throw badRequest("Choose 75% or 100%.");
    }
    for (const r of [...email.to, ...email.cc]) {
      if (r.kind === "mentioned") throw badRequest("“The person mentioned” only applies to mention rules.");
      if (r.kind === "caller" || r.kind === "agent" || r.kind === "team") {
        if (!info.fields[`${r.kind}_id`]) {
          throw badRequest(`${info.labels.class || info.name} has no ${r.kind}, so it cannot be emailed.`);
        }
      }
    }
    for (const c of event.conditions ?? []) {
      const field = info.fields[c.field];
      if (!field) throw badRequest(`${info.labels.class || info.name} has no field "${c.field}".`);
      if (criterionKind(field) === "date") {
        throw badRequest("Dates cannot be used as notification conditions.");
      }
    }
    if (!email.to.length) throw badRequest("Choose who receives the email.");
    if (!email.subject.trim()) throw badRequest("Write a subject.");
    if (email.status === "test" && !email.testRecipient?.includes("@")) {
      throw badRequest("Test mode sends only to the test address: enter one.");
    }
    return info;
  }

  private triggerFields(input: RuleInput, info: ClassInfo, kept: string[] = []): Record<string, unknown> {
    const { event } = input;
    const what = info.labels.class || info.name;
    const stateLabel = event.state ? info.labels.values[info.lifecycle?.attribute ?? ""]?.[event.state] ?? event.state : "";
    const description = {
      created: `${what} created`,
      updated: `${what} updated${event.fields?.length ? `: ${event.fields.join(", ")}` : ""}`,
      deleted: `${what} deleted`,
      state_entered: `${what} enters ${stateLabel}`,
      state_left: `${what} leaves ${stateLabel}`,
      sla_threshold: `${what} ${event.sla?.timer.toUpperCase()} reaches ${event.sla?.percent}%`,
    }[event.kind];
    return {
      description: `${description} (${input.name.trim()})`.slice(0, 255),
      target_class: event.recordType,
      filter: conditionsToFilter(info, event.conditions ?? [], event.keepCondition === false ? [] : kept),
      ...(event.kind === "state_entered" || event.kind === "state_left" ? { state: event.state } : {}),
      ...(event.kind === "updated" ? { target_attcodes: (event.fields ?? []).join(",") } : {}),
      ...(event.kind === "sla_threshold"
        ? { stop_watch_code: event.sla!.timer, threshold_index: event.sla!.percent }
        : {}),
    };
  }

  private emailFields(input: RuleInput, kept: { to: string[]; cc: string[] }): Record<string, unknown> {
    const { email, event } = input;
    return {
      name: input.name.trim(),
      status: STATUS_TO_ITOP[email.status],
      test_recipient: email.testRecipient?.trim() ?? "",
      // Always the helpdesk mailbox. iTop's samples send "from" whoever made
      // the change, which mail servers that only let the helpdesk mailbox
      // send (Microsoft 365, for one) refuse.
      from: this.requireSender().address,
      from_label: this.requireSender().label,
      to: buildRecipients(email.to, kept.to),
      cc: buildRecipients(email.cc, kept.cc),
      subject: subjectToItop(email.subject, event.recordType, this.appBaseUrl),
      body: bodyToItop(email.body, event.recordType, this.appBaseUrl),
    };
  }

  private requireSender(): { address: string; label: string } {
    if (!this.sender) {
      throw badRequest("Set NOTIFICATION_FROM (or MAIL_FROM) on the server: the address notification emails come from.");
    }
    return this.sender;
  }

  async create(input: RuleInput): Promise<RuleDto> {
    const info = this.validate(input);
    // Built before anything is written, so a bad condition saves nothing.
    const triggerData = this.triggerFields(input, info);
    if (input.email.to.some((r) => r.kind === "custom") || input.email.cc.some((r) => r.kind === "custom")) {
      throw badRequest("A new rule cannot reuse recipients from another rule.");
    }
    const email = await this.client.call("core/create", {
      class: "ActionEmail",
      fields: { ...this.emailFields(input, { to: [], cc: [] }), language: "EN US" },
      output_fields: "id",
      comment: "Notification rule created in the platform",
    });
    const emailId = normalizeObjects(email.objects)[0]!.id;
    const trigger = await this.client.call("core/create", {
      class: TRIGGER_CLASS[input.event.kind],
      fields: triggerData,
      output_fields: "id",
      comment: "Notification rule created in the platform",
    });
    const triggerId = normalizeObjects(trigger.objects)[0]!.id;
    const link = await this.client.call("core/create", {
      class: "lnkTriggerAction",
      fields: { trigger_id: triggerId, action_id: emailId, order: 1 },
      output_fields: "id",
      comment: "Notification rule created in the platform",
    });
    await this.syncInApp(null, triggerId, input, []);
    return this.getRule(normalizeObjects(link.objects)[0]!.id);
  }

  async update(id: number, input: RuleInput): Promise<RuleDto> {
    const snap = await this.snapshot();
    const link = snap.links.find((l) => l.id === id);
    if (!link || !snap.emails.has(link.actionId)) throw notFound(`No notification rule ${id}.`);
    const trigger = snap.triggers.get(link.triggerId)!;
    const email = snap.emails.get(link.actionId)!;
    const kind = eventKindOf(trigger.class);
    const editableEvent = (EDITABLE_EVENTS as readonly string[]).includes(kind);

    // Rules only iTop's screens fire keep their event: only the email changes.
    const effective: RuleInput = editableEvent
      ? input
      : { ...input, event: { ...input.event, recordType: str(trigger.fields["target_class"]) } };
    const info = editableEvent ? this.validate(effective) : this.validateEmailOnly(effective, kind);

    const kept = {
      to: parseRecipients(str(email.fields["to"])).custom,
      cc: parseRecipients(str(email.fields["cc"])).custom,
    };
    // The part of the condition set up in iTop belongs to the old record type;
    // it cannot follow the rule to another one.
    const keptFilter = this.parseFilter(trigger).kept;
    if (
      keptFilter.length &&
      effective.event.keepCondition !== false &&
      effective.event.recordType !== str(trigger.fields["target_class"])
    ) {
      throw badRequest("Remove the condition set up in iTop before changing the kind of record.");
    }
    // Built before anything is written, so a bad condition saves nothing.
    const triggerData = editableEvent ? this.triggerFields(effective, info, keptFilter) : null;

    await this.client.call("core/update", {
      class: "ActionEmail",
      key: link.actionId,
      fields: this.emailFields(effective, kept),
      output_fields: "id",
      comment: "Notification rule edited in the platform",
    });

    let ruleTriggerId = link.triggerId;
    if (editableEvent) {
      if (TRIGGER_CLASS[effective.event.kind] === trigger.class) {
        await this.client.call("core/update", {
          class: trigger.class,
          key: link.triggerId,
          fields: triggerData,
          output_fields: "id",
          comment: "Notification rule edited in the platform",
        });
      } else {
        // A trigger cannot change class: make the new one, move this rule
        // (and its in-app part, when no other rule shares the old trigger)
        // to it, and drop the old one if nothing else uses it.
        const created = await this.client.call("core/create", {
          class: TRIGGER_CLASS[effective.event.kind],
          fields: triggerData,
          output_fields: "id",
          comment: "Notification rule edited in the platform",
        });
        ruleTriggerId = normalizeObjects(created.objects)[0]!.id;
        const move = async (linkId: number) =>
          this.client.call("core/update", {
            class: "lnkTriggerAction",
            key: linkId,
            fields: { trigger_id: ruleTriggerId },
            output_fields: "id",
            comment: "Notification rule edited in the platform",
          });
        await move(id);
        const otherEmails = snap.links.filter(
          (l) => l.triggerId === link.triggerId && l.id !== id && snap.emails.has(l.actionId),
        );
        const inApp = this.inAppOf(snap, link.triggerId);
        if (!otherEmails.length && inApp) await move(inApp.link.id);
        const remaining = snap.links.filter(
          (l) => l.triggerId === link.triggerId && l.id !== id && (otherEmails.length || l.id !== inApp?.link.id),
        );
        if (!remaining.length) {
          await this.client.call("core/delete", {
            class: trigger.class,
            key: link.triggerId,
            comment: "Notification rule edited in the platform",
          });
        }
      }
    }
    // Links moved above: work from what iTop holds now.
    await this.syncInApp(await this.snapshot(), ruleTriggerId, effective, kept.to);
    return this.getRule(id);
  }

  private validateEmailOnly(input: RuleInput, kind: EventKind): ClassInfo {
    const { email } = input;
    if (!input.name.trim()) throw badRequest("Give the rule a name.");
    if (!email.to.length) throw badRequest("Choose who receives the email.");
    if (!email.subject.trim()) throw badRequest("Write a subject.");
    for (const r of [...email.to, ...email.cc]) {
      if (r.kind === "mentioned" && kind !== "mentioned") {
        throw badRequest("“The person mentioned” only applies to mention rules.");
      }
    }
    if (email.status === "test" && !email.testRecipient?.includes("@")) {
      throw badRequest("Test mode sends only to the test address: enter one.");
    }
    // Abstract or unpublished target classes still need a ClassInfo shape for
    // the texts; fall back to the published parent when there is one.
    return this.schema.get(input.event.recordType) ?? this.requireClass("Ticket");
  }

  async setStatus(id: number, status: EmailStatus): Promise<RuleDto> {
    const rule = await this.getRule(id);
    if (status === "test" && !rule.email.testRecipient) {
      throw badRequest("Set a test address on the rule before switching it to test mode.");
    }
    const snap = await this.snapshot();
    const link = snap.links.find((l) => l.id === id)!;
    await this.client.call("core/update", {
      class: "ActionEmail",
      key: link.actionId,
      fields: { status: STATUS_TO_ITOP[status] },
      output_fields: "id",
      comment: `Notification ${status === "on" ? "switched on" : status === "off" ? "switched off" : "set to test mode"} in the platform`,
    });
    return this.getRule(id);
  }

  /** Removes the rule, and its trigger and email when no other rule uses them. */
  async remove(id: number): Promise<void> {
    const snap = await this.snapshot();
    const link = snap.links.find((l) => l.id === id);
    if (!link) throw notFound(`No notification rule ${id}.`);
    const comment = "Notification rule deleted in the platform";
    await this.client.call("core/delete", { class: "lnkTriggerAction", key: id, comment });
    // The in-app part belongs to the trigger's email rules: it goes with
    // the last of them.
    const inApp = this.inAppOf(snap, link.triggerId);
    const otherEmails = snap.links.filter(
      (l) => l.triggerId === link.triggerId && l.id !== id && snap.emails.has(l.actionId),
    );
    if (inApp && !otherEmails.length) {
      const usedElsewhere = snap.links.some((l) => l.actionId === inApp.link.actionId && l.triggerId !== link.triggerId);
      await this.client.call(
        "core/delete",
        usedElsewhere
          ? { class: "lnkTriggerAction", key: inApp.link.id, comment }
          : { class: "ActionNewsroom", key: inApp.link.actionId, comment },
      );
    }
    const others = snap.links.filter((l) => l.id !== id && (otherEmails.length || l.id !== inApp?.link.id));
    const trigger = snap.triggers.get(link.triggerId);
    if (trigger && !others.some((l) => l.triggerId === link.triggerId)) {
      await this.client.call("core/delete", { class: trigger.class, key: link.triggerId, comment });
    }
    if (snap.emails.has(link.actionId) && !others.some((l) => l.actionId === link.actionId)) {
      await this.client.call("core/delete", { class: "ActionEmail", key: link.actionId, comment });
    }
  }

  /** The most recent notification emails iTop sent (or failed to), newest first. */
  async sent(limit = 50): Promise<SentEmail[]> {
    const fields = "id,date,to,subject,message,action_id_friendlyname,object_class,object_id";
    const page = async (n: number) =>
      this.client.call("core/get", {
        class: "EventNotificationEmail",
        key: "SELECT EventNotificationEmail",
        output_fields: fields,
        limit,
        page: n,
      });
    // iTop lists oldest first and cannot be told otherwise: read the last
    // page (found from the total), topped up from the one before.
    const first = await page(1);
    const total = parseFoundCount(first.message) ?? 0;
    const last = Math.max(1, Math.ceil(total / limit));
    let rows = normalizeObjects(first.objects);
    if (last > 1) {
      rows = normalizeObjects((await page(last)).objects);
      if (rows.length < limit) rows = [...normalizeObjects((await page(last - 1)).objects), ...rows];
    }
    return rows
      .sort((a, b) => b.id - a.id)
      .slice(0, limit)
      .map((r) => {
        const f = r.fields;
        const objectId = Number(f["object_id"]);
        return {
          id: r.id,
          date: str(f["date"]),
          to: str(f["to"]),
          subject: str(f["subject"]),
          result: str(f["message"]),
          rule: str(f["action_id_friendlyname"]),
          record: objectId > 0 ? { type: str(f["object_class"]), id: objectId } : null,
        };
      });
  }
}
