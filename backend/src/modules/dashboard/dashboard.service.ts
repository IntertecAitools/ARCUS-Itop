import type { ObjectsService, ObjectDto } from "../../platform/objects/objects.service.js";
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
  myAssignments: { incidents: TicketDto[]; approvals: TicketDto[]; requests: TicketDto[] };
  catalogShortcuts: Array<{ id: string; label: string; description: string; icon: string }>;
  changeCalendar: Array<{ id: string; ref: string; title: string; scheduledAt: string; risk: string }>;
  knowledgeArticles: Array<{ id: string; title: string; views: number }>;
}

export interface NavCounts {
  openIncidents: number;
  openRequests: number;
}

export class DashboardService {
  constructor(private readonly objects: ObjectsService) {}

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

  private async fetch(
    className: string,
    where: string,
    fields: string,
    limit = 200,
  ): Promise<ObjectDto[]> {
    const result = await this.objects.list(className, {
      page: 1,
      limit,
      oql: `SELECT ${className} WHERE ${where}`,
      fields,
    });
    return result.items;
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
      this.fetch(
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
      // The BFF authenticates as one service account, so there is no "me" to
      // resolve yet. These stay empty until the auth module lands and the
      // caller's identity reaches this layer.
      myAssignments: { incidents: [], approvals: [], requests: [] },
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
