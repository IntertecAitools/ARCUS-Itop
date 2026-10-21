import type { Navigation } from "../../platform/navigation/navigation.service.js";
import { newestRows, SCAN_PAGE_SIZE, type ObjectsService, type ObjectDto } from "../../platform/objects/objects.service.js";
import type { CmdbSchema } from "../../schema/load.js";
import type { CurrentContact } from "../../shared/current-contact.js";
import {
  OPEN_STATES,
  str,
  TICKET_FIELDS,
  toTicket,
  type TicketDto,
} from "../../shared/ticket-mapping.js";
import { addDays, itopDay, weekday } from "../../shared/itop-time.js";

// Re-exported so existing importers of this module keep working; the type is
// owned by shared/ticket-mapping.ts, which every ticket module shares.
export type { TicketDto };

/**
 * Aggregates the agent dashboard into ONE response.
 *
 * It lives here rather than in the frontend because the alternative is a dozen
 * round trips on every page load, and because this is where iTop's vocabulary
 * is translated into ours: the UI never sees `assigned`, `sla_ttr_passed` or a
 * numeric priority.
 */

export type DateRange = "24h" | "7d" | "30d" | "90d";

const RANGE_DAYS: Record<DateRange, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

// Ticket vocabulary (status/priority maps, OPEN_STATES, toTicket)
// lives in shared/ticket-mapping.ts so this module and incidents cannot drift.

/** The day (on iTop's clock, like the range limits) an ISO instant falls on. */
function dayKey(value: unknown, timeZone: string): string | null {
  const raw = str(value);
  if (!raw) return null;
  const instant = new Date(raw);
  return Number.isNaN(instant.getTime()) ? null : itopDay(instant, timeZone);
}

export interface DashboardOverview {
  kpis: {
    totalIncidents: number;
    openIncidents: number;
    slaBreached: number;
    slaCompliance: number | null;
  };
  trend: Array<{ date: string; created: number; resolved: number }>;
  categories: Array<{ key: string; label: string; value: number }>;
  sla: { compliance: number | null; onTime: number; atRisk: number; breached: number };
  recentIncidents: TicketDto[];
  myAssignments: MyAssignments;
  catalogShortcuts: Array<{ id: string; label: string; description: string; icon: string }>;
  changeCalendar: Array<{ id: string; ref: string; title: string; scheduledAt: string; risk: string }>;
  knowledgeArticles: Array<{ id: string; title: string; views: number }>;
}

/** One queue of the caller's own work: the rows shown, and how many there are. */
export interface AssignmentQueue {
  items: TicketDto[];
  total: number;
}

/**
 * A change in the caller's queue. Changes have their own lifecycle (approved,
 * planned and scheduled, implemented...), not the ticket one, so the status
 * travels as iTop's code plus iTop's own label for it rather than being
 * squeezed into TicketDto's vocabulary.
 */
export interface ChangeAssignment {
  id: string;
  /** The real class (NormalChange, EmergencyChange...); records open under it. */
  class: string;
  ref: string;
  title: string;
  status: string;
  statusLabel: string;
  /** ISO instant the change is planned to start, "" when not planned. */
  startDate: string;
}

export interface ChangeQueue {
  items: ChangeAssignment[];
  total: number;
}

/**
 * Open work assigned to the signed-in agent, per ticket type. Each queue is
 * iTop's own "assigned to me" menu (Incident:MyIncidents and friends), so it
 * matches what iTop's back office would list.
 */
export interface MyAssignments {
  incidents: AssignmentQueue;
  requests: AssignmentQueue;
  problems: AssignmentQueue;
  changes: ChangeQueue;
}

/** The navigation views behind each queue. */
const ASSIGNMENT_VIEWS = {
  incidents: { class: "Incident", view: "Incident:MyIncidents" },
  requests: { class: "UserRequest", view: "UserRequest:MyRequests" },
  problems: { class: "Problem", view: "Problem:MyProblems" },
  // iTop names this menu without the class prefix the others carry.
  changes: { class: "Change", view: "MyChanges" },
} as const;

const CHANGE_FIELDS = "id,ref,title,status,start_date,finalclass";

/** Rows per queue. The tab count uses the real total, so nothing is hidden. */
const ASSIGNMENT_ROWS = 50;

/** Most incidents the overview reads for its trend, category and SLA views. */
const IN_RANGE_CAP = 20_000;

const PRIORITY_RANK: Record<TicketDto["priority"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const EMPTY_QUEUE: AssignmentQueue = { items: [], total: 0 };

export interface NavCounts {
  openIncidents: number;
  openRequests: number;
}

export class DashboardService {
  constructor(
    private readonly objects: ObjectsService,
    private readonly navigation?: Navigation,
    private readonly currentContact?: CurrentContact,
    private readonly schema?: CmdbSchema,
  ) {}

  /**
   * The caller's open queues. Empty, not an error, when the account has no
   * linked Person (nothing can be assigned to it) or a view is missing from
   * this iTop's navigation (the module is not installed).
   */
  async myAssignments(): Promise<MyAssignments> {
    const contactId = await this.currentContact?.tryResolve();
    /** The view's rows, or null when this caller has no such queue. */
    const rows = async (key: keyof typeof ASSIGNMENT_VIEWS, fields: string) => {
      const { class: className, view } = ASSIGNMENT_VIEWS[key];
      if (!contactId || !this.navigation) return null;
      let oql: string;
      try {
        const resolved = this.navigation.resolveView(view);
        if (resolved.class !== className) return null;
        oql = resolved.oql.split(":current_contact_id").join(contactId);
      } catch {
        return null;
      }
      try {
        return await this.objects.list(className, { page: 1, limit: ASSIGNMENT_ROWS, oql, fields });
      } catch {
        // E.g. an agent whose profile cannot read Problem: that queue is
        // empty for them, and the rest of the dashboard still loads.
        return null;
      }
    };

    const queue = async (key: "incidents" | "requests" | "problems"): Promise<AssignmentQueue> => {
      const result = await rows(key, TICKET_FIELDS);
      if (!result) return EMPTY_QUEUE;
      // Most urgent first, then newest -- the order an agent works a queue in.
      const items = result.items
        .map((item) => toTicket(item))
        .sort(
          (a, b) =>
            PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || Number(b.id) - Number(a.id),
        );
      return { items, total: result.total };
    };

    const changes = async (): Promise<ChangeQueue> => {
      const result = await rows("changes", CHANGE_FIELDS);
      if (!result) return { items: [], total: 0 };
      const items = result.items
        .map((item) => this.toChange(item))
        // Soonest planned first; unplanned after, newest first.
        .sort(
          (a, b) =>
            (a.startDate ? 0 : 1) - (b.startDate ? 0 : 1) ||
            a.startDate.localeCompare(b.startDate) ||
            Number(b.id) - Number(a.id),
        );
      return { items, total: result.total };
    };

    const [incidents, requests, problems, changeQueue] = await Promise.all([
      queue("incidents"),
      queue("requests"),
      queue("problems"),
      changes(),
    ]);
    return { incidents, requests, problems, changes: changeQueue };
  }

  /** A Change row, its status labelled as iTop labels it for that class. */
  private toChange(item: ObjectDto): ChangeAssignment {
    const className = str(item.fields["finalclass"]) || item.class;
    const status = str(item.fields["status"]);
    const labels = (this.schema?.get(className) ?? this.schema?.get("Change"))?.labels.values["status"];
    return {
      id: String(item.id),
      class: className,
      ref: str(item.fields["ref"]) || `#${item.id}`,
      title: str(item.fields["title"]),
      status,
      statusLabel: labels?.[status] ?? status,
      startDate: str(item.fields["start_date"]),
    };
  }

  /** Cheap count: ask for one row and read the "Found: N" total. */
  private async count(className: string, where: string): Promise<number> {
    const result = await this.objects.list(className, {
      page: 1,
      limit: 1,
      oql: `SELECT ${className} WHERE ${where}`,
      fields: "id",
    });
    return result.total;
  }

  /** Up to `limit` matching rows, paging past list()'s 500-row page size. */
  private async fetch(
    className: string,
    where: string,
    fields: string,
    limit = 200,
    pageSize?: number,
  ): Promise<ObjectDto[]> {
    const result = await this.objects.listAll(
      className,
      { oql: `SELECT ${className} WHERE ${where}`, fields },
      limit,
      pageSize,
    );
    return result.items;
  }

  /**
   * The `count` newest rows. iTop cannot be told how to order, and its class
   * defaults differ (Incident is `ref` descending, newest first): newestRows()
   * reads page 1 and, past one page, the end of the set, and keeps the
   * highest ids. Reading only the last page showed the OLDEST incidents as
   * "recent" as soon as there were more than `count`.
   */
  private async latest(
    className: string,
    where: string,
    fields: string,
    count: number,
  ): Promise<ObjectDto[]> {
    const { rows } = await newestRows(count, async (page, limit) => {
      const result = await this.objects.list(className, {
        page,
        limit,
        oql: `SELECT ${className} WHERE ${where}`,
        fields,
      });
      return { rows: result.items, total: result.total };
    });
    return rows;
  }

  async navCounts(): Promise<NavCounts> {
    const [openIncidents, openRequests] = await Promise.all([
      this.count("Incident", `status IN (${OPEN_STATES})`),
      this.count("UserRequest", `status IN (${OPEN_STATES})`),
    ]);
    return { openIncidents, openRequests };
  }

  async overview(range: DateRange): Promise<DashboardOverview> {
    const days = RANGE_DAYS[range] ?? 7;
    // Days are iTop's days: its stored times and its OQL literals are on its
    // clock, whatever zone the BFF host runs in.
    const timeZone = this.objects.timeZone;
    const today = itopDay(new Date(), timeZone);
    // The window is the `days` days the trend shows, today included; the
    // KPI and the SLA split count the same days (they counted one more).
    const sinceOql = `start_date >= '${addDays(today, -(days - 1))} 00:00:00'`;

    const weekStart = addDays(today, -weekday(today));
    const weekEnd = addDays(weekStart, 7);

    // One round trip each, all in flight together — iTop is ~0.5s per call, so
    // doing these in sequence would make the dashboard feel broken.
    const [
      totalIncidents,
      openIncidents,
      slaBreached,
      breachedInRange,
      atRiskInRange,
      inRange,
      recent,
      subcategories,
      changes,
      faqs,
      myAssignments,
    ] = await Promise.all([
      this.count("Incident", sinceOql),
      this.count("Incident", `status IN (${OPEN_STATES})`),
      this.count("Incident", `sla_ttr_passed = 1`),
      // The SLA split is counted by iTop: the passed flags are computed per
      // row from the stopwatches, ~3 ms each, which made reading them for a
      // 90-day window of 6,000 incidents take 20 s.
      this.count("Incident", `${sinceOql} AND sla_ttr_passed = 1`),
      this.count("Incident", `${sinceOql} AND sla_tto_passed = 1 AND sla_ttr_passed = 0`),
      // The trend and the category split read the window's rows: every
      // incident in it, not the first 2,000 (a capped scan dropped the newest
      // days), with only the fields they use, in big pages.
      this.fetch(
        "Incident",
        sinceOql,
        "id,start_date,resolution_date,service_name,servicesubcategory_name",
        IN_RANGE_CAP,
        SCAN_PAGE_SIZE,
      ),
      this.latest(
        "Incident",
        "id > 0",
        "id,ref,title,status,priority,start_date,agent_id,agent_name",
        5,
      ),
      this.fetch("ServiceSubcategory", "id > 0", "id,name,service_name", 4),
      this.fetch(
        "Change",
        `start_date >= '${weekStart} 00:00:00' AND start_date < '${weekEnd} 00:00:00'`,
        "id,ref,title,start_date,status",
        50,
      ),
      this.fetch("FAQ", "id > 0", "id,title,summary", 4),
      this.myAssignments(),
    ]);

    // ── Trend ──────────────────────────────────────────────────────────────
    // Pre-seed every day in the window so a quiet day reads as a real zero
    // rather than vanishing and distorting the line.
    const buckets = new Map<string, { created: number; resolved: number }>();
    for (let i = days - 1; i >= 0; i--) {
      buckets.set(addDays(today, -i), { created: 0, resolved: 0 });
    }
    for (const item of inRange) {
      const created = dayKey(item.fields["start_date"], timeZone);
      if (created && buckets.has(created)) buckets.get(created)!.created += 1;
      const resolved = dayKey(item.fields["resolution_date"], timeZone);
      if (resolved && buckets.has(resolved)) buckets.get(resolved)!.resolved += 1;
    }
    const trend = [...buckets.entries()].map(([date, counts]) => ({ date, ...counts }));

    // ── Category split ─────────────────────────────────────────────────────
    const byCategory = new Map<string, number>();
    for (const item of inRange) {
      const label =
        str(item.fields["servicesubcategory_name"]) || str(item.fields["service_name"]) || "Unassigned";
      byCategory.set(label, (byCategory.get(label) ?? 0) + 1);
    }
    // The chart palette caps at eight slots, so the tail folds into "Others"
    // rather than inventing a ninth hue.
    const ranked = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
    const head = ranked.slice(0, 5);
    const tail = ranked.slice(5);
    const categories = head.map(([label, value]) => ({
      key: label.toLowerCase().replace(/\s+/g, "-"),
      label,
      value,
    }));
    if (tail.length) {
      categories.push({
        key: "others",
        label: "Others",
        value: tail.reduce((sum, [, v]) => sum + v, 0),
      });
    }

    // ── SLA breakdown ──────────────────────────────────────────────────────
    const breached = breachedInRange;
    const atRisk = atRiskInRange;
    const onTime = Math.max(0, totalIncidents - breached - atRisk);
    const underSla = onTime + atRisk + breached;
    // null, not 0 — "nothing measured" is not "0% compliant".
    const compliance = underSla === 0 ? null : onTime / underSla;

    return {
      kpis: { totalIncidents, openIncidents, slaBreached, slaCompliance: compliance },
      trend,
      categories,
      sla: { compliance, onTime, atRisk, breached },
      recentIncidents: recent.map((item) => toTicket(item)),
      myAssignments,
      catalogShortcuts: subcategories.map((item) => ({
        id: String(item.id),
        label: str(item.fields["name"]),
        description: str(item.fields["service_name"]),
        icon: "access",
      })),
      changeCalendar: changes.map((item) => ({
        id: String(item.id),
        ref: str(item.fields["ref"]) || `#${item.id}`,
        title: str(item.fields["title"]),
        scheduledAt: str(item.fields["start_date"]),
        risk: "medium",
      })),
      knowledgeArticles: faqs.map((item) => ({
        id: String(item.id),
        title: str(item.fields["title"]),
        // iTop does not track article views; reporting 0 beats inventing a number.
        views: 0,
      })),
    };
  }
}
