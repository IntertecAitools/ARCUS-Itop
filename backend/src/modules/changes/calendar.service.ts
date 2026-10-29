import { randomUUID } from "node:crypto";

import { badRequest, notFound } from "../../core/errors.js";
import { currentCaller } from "../../core/request-context.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects, parseFoundCount } from "../../itop/normalize.js";
import type { DocStore } from "../../shared/doc-store.js";
import { itopTimeToIso, toItopTime } from "../../shared/itop-time.js";
import { str } from "../../shared/ticket-mapping.js";
import { blackoutsHit, distinct, markClashes } from "./calendar.js";
import { STATUS, tenantKey, toHead, TYPE_OF_CLASS } from "./change-model.js";
import type {
  Blackout,
  BlackoutInput,
  CalendarChange,
  CalendarQuery,
  ChangeCalendar,
  NamedRef,
  RiskLevel,
} from "./changes.types.js";

const BLACKOUT_KIND = "change-blackout";

/** Changes the calendar reads at most for one window. */
export const CALENDAR_CAP = 1000;
/** The widest window: a month view with the days around it, or a quarter. */
export const MAX_WINDOW_DAYS = 100;
/** ids per IN (...) clause. */
const CHUNK = 200;

const FIELDS = "ref,title,status,start_date,end_date,org_id,org_name,team_id,team_name,outage";

interface StoredBlackout {
  name: string;
  start: string;
  end: string;
  reason: string;
}

const chunks = <T>(list: T[]): T[][] =>
  Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, i) => list.slice(i * CHUNK, (i + 1) * CHUNK));

const ref = (id: unknown, name: unknown): NamedRef => ({ id: String(id ?? ""), name: str(name) });

/**
 * The change calendar: changes by planned start and end over a window, each
 * with its CIs, the services those CIs support, the other changes it clashes
 * with and the blackout windows (freezes an administrator defines, kept in
 * the BFF's own database) it runs into.
 */
export class ChangeCalendarService {
  constructor(
    private readonly client: ItopClient,
    private readonly store: DocStore,
    private readonly timeZone: string,
    private readonly riskLevels: (ids: number[]) => Promise<Map<number, RiskLevel>>,
  ) {}

  /* --------------------------------------------------------------------- *
   * Blackout windows
   * --------------------------------------------------------------------- */

  async blackouts(): Promise<Blackout[]> {
    const docs = await this.store.list<StoredBlackout>(tenantKey(), BLACKOUT_KIND);
    return docs
      .map((d) => ({ id: d.key, ...d.body, updatedAt: d.updatedAt, updatedBy: d.updatedBy }))
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  private clean(input: BlackoutInput): StoredBlackout {
    const start = new Date(input.start);
    const end = new Date(input.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw badRequest("start and end must be ISO date-times.");
    }
    if (end <= start) throw badRequest("A blackout window must end after it starts.");
    return { name: input.name.trim(), start: start.toISOString(), end: end.toISOString(), reason: input.reason.trim() };
  }

  async createBlackout(input: BlackoutInput): Promise<Blackout> {
    const id = randomUUID();
    await this.store.put(tenantKey(), BLACKOUT_KIND, id, this.clean(input), currentCaller()?.login ?? "");
    return (await this.blackouts()).find((b) => b.id === id)!;
  }

  async updateBlackout(id: string, input: BlackoutInput): Promise<Blackout> {
    if (!(await this.store.get(tenantKey(), BLACKOUT_KIND, id))) throw notFound("That blackout window was not found.");
    await this.store.put(tenantKey(), BLACKOUT_KIND, id, this.clean(input), currentCaller()?.login ?? "");
    return (await this.blackouts()).find((b) => b.id === id)!;
  }

  async deleteBlackout(id: string): Promise<void> {
    if (!(await this.store.get(tenantKey(), BLACKOUT_KIND, id))) throw notFound("That blackout window was not found.");
    await this.store.delete(tenantKey(), BLACKOUT_KIND, id);
  }

  /* --------------------------------------------------------------------- *
   * The calendar
   * --------------------------------------------------------------------- */

  private itop(iso: string): string {
    return toItopTime(new Date(iso), this.timeZone);
  }

  private iso(value: unknown): string {
    const text = str(value);
    return text ? itopTimeToIso(text, this.timeZone) : "";
  }

  async calendar(query: CalendarQuery): Promise<ChangeCalendar> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      throw badRequest("from and to must be ISO date-times, from before to.");
    }
    if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * 86_400_000) {
      throw badRequest(`The calendar shows at most ${MAX_WINDOW_DAYS} days at a time.`);
    }
    const f = this.itop(from.toISOString());
    const t = this.itop(to.toISOString());
    // Planned in the window: starts before it ends, and ends after it starts
    // (or, without an end, starts inside it).
    const oql =
      `SELECT Change WHERE start_date < '${t}' AND ` +
      `(end_date >= '${f}' OR (ISNULL(end_date) AND start_date >= '${f}'))`;
    const [result, allBlackouts] = await Promise.all([
      this.client.call("core/get", { class: "Change", key: oql, output_fields: FIELDS, limit: CALENDAR_CAP, page: 1 }),
      this.blackouts(),
    ]);
    const rows = normalizeObjects(result.objects).filter((r) => r.class in TYPE_OF_CLASS);
    const found = parseFoundCount(result.message) ?? rows.length;

    const ids = rows.map((r) => r.id);
    const [cisByChange, levels] = await Promise.all([this.cisOf(ids), this.riskLevels(ids)]);
    const servicesByCi = await this.servicesOf([...new Set([...cisByChange.values()].flat().map((c) => c.id))]);

    const blackouts = allBlackouts.filter((b) => b.start < to.toISOString() && b.end > from.toISOString());
    const items: CalendarChange[] = rows.map((row) => {
      const head = toHead(row);
      const fields = row.fields;
      const cis = cisByChange.get(row.id) ?? [];
      const team = ref(fields["team_id"], fields["team_name"]);
      const item: CalendarChange = {
        id: String(row.id),
        ref: head.ref,
        title: head.title,
        type: head.type,
        status: STATUS[head.status] ?? "new",
        start: this.iso(fields["start_date"]),
        end: this.iso(fields["end_date"]),
        organization: ref(fields["org_id"], fields["org_name"]),
        team: team.id && team.id !== "0" ? team : null,
        cis,
        services: distinct(cis.flatMap((c) => servicesByCi.get(c.id) ?? [])),
        outage: str(fields["outage"]) === "yes",
        risk: levels.get(row.id) ?? null,
        clashes: [],
        blackouts: [],
      };
      item.blackouts = blackoutsHit(item, blackouts);
      return item;
    });
    // Clashes are found across every change in the window, before filtering:
    // a filter hides the other change, not the clash.
    markClashes(items);

    const options = {
      teams: distinct(items.flatMap((i) => (i.team ? [i.team] : []))),
      cis: distinct(items.flatMap((i) => i.cis)),
      services: distinct(items.flatMap((i) => i.services)),
      organizations: distinct(items.map((i) => i.organization)),
    };
    const shown = items
      .filter((i) => !query.teamId || i.team?.id === query.teamId)
      .filter((i) => !query.ciId || i.cis.some((c) => c.id === query.ciId))
      .filter((i) => !query.serviceId || i.services.some((s) => s.id === query.serviceId))
      .filter((i) => !query.orgId || i.organization.id === query.orgId)
      .sort((a, b) => a.start.localeCompare(b.start) || Number(a.id) - Number(b.id));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      items: shown,
      blackouts,
      options,
      truncated: found > rows.length,
    };
  }

  private async cisOf(changeIds: number[]): Promise<Map<number, NamedRef[]>> {
    const out = new Map<number, NamedRef[]>();
    for (const ids of chunks(changeIds)) {
      const result = await this.client.call("core/get", {
        class: "lnkFunctionalCIToTicket",
        key: `SELECT lnkFunctionalCIToTicket WHERE ticket_id IN (${ids.join(",")})`,
        output_fields: "ticket_id,functionalci_id,functionalci_name",
      });
      for (const link of normalizeObjects(result.objects)) {
        const changeId = Number(link.fields["ticket_id"]);
        const list = out.get(changeId) ?? [];
        list.push(ref(link.fields["functionalci_id"], link.fields["functionalci_name"]));
        out.set(changeId, list);
      }
    }
    for (const [id, list] of out) out.set(id, distinct(list));
    return out;
  }

  private async servicesOf(ciIds: string[]): Promise<Map<string, NamedRef[]>> {
    const out = new Map<string, NamedRef[]>();
    for (const ids of chunks(ciIds.filter((id) => /^\d+$/.test(id)))) {
      const result = await this.client.call("core/get", {
        class: "lnkFunctionalCIToService",
        key: `SELECT lnkFunctionalCIToService WHERE functionalci_id IN (${ids.join(",")})`,
        output_fields: "functionalci_id,service_id,service_name",
      });
      for (const link of normalizeObjects(result.objects)) {
        const ciId = String(link.fields["functionalci_id"]);
        const list = out.get(ciId) ?? [];
        list.push(ref(link.fields["service_id"], link.fields["service_name"]));
        out.set(ciId, list);
      }
    }
    return out;
  }
}
