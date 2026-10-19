import type { Navigation } from "../../platform/navigation/navigation.service.js";
import type { ObjectsService, ObjectDto } from "../../platform/objects/objects.service.js";
import type { CurrentContact } from "../../shared/current-contact.js";
import {
  OPEN_STATES,
  oqlDate,
  isTrue,
  str,
  TICKET_FIELDS,
  toTicket,
  type TicketDto,
} from "../../shared/ticket-mapping.js";

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

// Ticket vocabulary (status/priority maps, OPEN_STATES, oqlDate, toTicket)
// lives in shared/ticket-mapping.ts so this module and incidents cannot drift.

function dayKey(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  // iTop returns "YYYY-MM-DD HH:MM:SS"; the date half is the bucket.
  const day = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
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
 * Open work assigned to the signed-in agent, per ticket type. Each queue is
 * iTop's own "assigned to me" menu (Incident:MyIncidents and friends), so it
 * matches what iTop's back office would list.
 */
export interface MyAssignments {
  incidents: AssignmentQueue;
  requests: AssignmentQueue;
  problems: AssignmentQueue;
}

/** The navigation views behind each queue. */
const ASSIGNMENT_VIEWS = {
  incidents: { class: "Incident", view: "Incident:MyIncidents" },
  requests: { class: "UserRequest", view: "UserRequest:MyRequests" },
  problems: { class: "Problem", view: "Problem:MyProblems" },
} as const;

/** Rows per queue. The tab count uses the real total, so nothing is hidden. */
const ASSIGNMENT_ROWS = 50;

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
  ) {}

  /**
   * The caller's open queues. Empty, not an error, when the account has no
   * linked Person (nothing can be assigned to it) or a view is missing from
   * this iTop's navigation (the module is not installed).
   */
  async myAssignments(): Promise<MyAssignments> {
    const contactId = await this.currentContact?.tryResolve();
    const queue = async (key: keyof typeof ASSIGNMENT_VIEWS): Promise<AssignmentQueue> => {
      const { class: className, view } = ASSIGNMENT_VIEWS[key];
      if (!contactId || !this.navigation) return EMPTY_QUEUE;
      let oql: string;
      try {
        const resolved = this.navigation.resolveView(view);
        if (resolved.class !== className) return EMPTY_QUEUE;
        oql = resolved.oql.split(":current_contact_id").join(contactId);
      } catch {
        return EMPTY_QUEUE;
      }
      const result = await this.objects.list(className, {
        page: 1,
        limit: ASSIGNMENT_ROWS,
        oql,
        fields: TICKET_FIELDS,
      });
      // Most urgent first, then newest -- the order an agent works a queue in.
      const items = result.items
        .map((item) => toTicket(item))
        .sort(
          (a, b) =>
            PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || Number(b.id) - Number(a.id),
        );
      return { items, total: result.total };
    };

    const [incidents, requests, problems] = await Promise.all([
      queue("incidents"),
      queue("requests"),
      queue("problems"),
    ]);
    return { incidents, requests, problems };
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
  ): Promise<ObjectDto[]> {
    const result = await this.objects.listAll(
      className,
      { oql: `SELECT ${className} WHERE ${where}`, fields },
      limit,
    );
    return result.items;
  }

  /**
   * The `count` newest rows.
   *
   * iTop cannot be told how to order, but it does order: by the class default,
   * which for tickets is `ref` ascending (dbobjectset.class.php:691). So the
   * first page holds the OLDEST rows. The newest are on the last page, which
   * the "Found: N" total locates; the page before it tops up a short last
   * page. Rows are then ordered by id, newest first.
   */
  private async latest(
    className: string,
    where: string,
    fields: string,
    count: number,
  ): Promise<ObjectDto[]> {
    const page = (n: number) =>
      this.objects.list(className, {
        page: n,
        limit: count,
        oql: `SELECT ${className} WHERE ${where}`,
        fields,
      });

    const first = await page(1);
    const lastPage = Math.max(1, Math.ceil(first.total / count));
    let rows = first.items;
    if (lastPage > 1) {
      const last = await page(lastPage);
      rows = last.items;
      if (rows.length < count) rows = [...(await page(lastPage - 1)).items, ...rows];
    }
    return [...rows].sort((a, b) => b.id - a.id).slice(0, count);
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
    const since = new Date(Date.now() - days * 86_400_000);
    since.setHours(0, 0, 0, 0);
    const sinceOql = `start_date >= '${oqlDate(since)}'`;

    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    // One round trip each, all in flight together — iTop is ~0.5s per call, so
    // doing these in sequence would make the dashboard feel broken.
    const [
      totalIncidents,
      openIncidents,
      slaBreached,
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
      // The trend, the category split and the SLA breakdown are three views of
      // the same rows, so they share a single fetch.
      this.fetch(
        "Incident",
        sinceOql,
        "id,ref,title,status,priority,start_date,resolution_date,service_name,servicesubcategory_name,sla_ttr_passed,sla_tto_passed",
        2000,
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
        `start_date >= '${oqlDate(weekStart)}' AND start_date < '${oqlDate(weekEnd)}'`,
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
      const d = new Date(Date.now() - i * 86_400_000);
      buckets.set(oqlDate(d).slice(0, 10), { created: 0, resolved: 0 });
    }
    for (const item of inRange) {
      const created = dayKey(item.fields["start_date"]);
      if (created && buckets.has(created)) buckets.get(created)!.created += 1;
      const resolved = dayKey(item.fields["resolution_date"]);
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
    let onTime = 0;
    let atRisk = 0;
    let breached = 0;
    for (const item of inRange) {
      if (isTrue(item.fields["sla_ttr_passed"])) breached += 1;
      else if (isTrue(item.fields["sla_tto_passed"])) atRisk += 1;
      else onTime += 1;
    }
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
