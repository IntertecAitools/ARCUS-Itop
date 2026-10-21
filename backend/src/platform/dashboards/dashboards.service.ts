import { readFileSync } from "node:fs";

import { notFound } from "../../core/errors.js";
import type { CmdbSchema } from "../../schema/load.js";
import type { ObjectsService } from "../objects/objects.service.js";
import { itopDay } from "../../shared/itop-time.js";

/**
 * iTop's "Overview" dashboards, rendered natively.
 *
 * Each DashboardMenuNode is a set of dashlets -- a count, a chart, a grouped
 * table, an object list, a header. iTop defines them in its datamodel; the
 * extractor pulls the structure AND each dashlet's OQL into cmdb-dashboards.json.
 *
 * The OQL never leaves the BFF. The published structure (GET /meta/dashboards)
 * carries only ids, kinds and titles; the frontend asks for one dashlet's data
 * by id and the query is run here. This is the same boundary the navigation
 * views keep: the frontend holds no iTop queries.
 */

type DashletKind = "pie" | "bars" | "table" | "list" | "badge" | "header" | "header-dynamic" | "text";

interface RawDashlet {
  id: string;
  kind: DashletKind;
  title: string;
  class?: string;
  oql?: string;
  groupBy?: string;
  groupFn?: string;
  values?: string[];
  text?: string;
  subtitle?: string;
}

interface RawDashboard {
  id: string;
  title: string;
  columns: number;
  dashlets: RawDashlet[];
}

interface DashboardFile {
  dashboards: Record<string, RawDashboard>;
  skipped: { dashboard: string; reason: string }[];
}

/** A dashlet as the frontend sees it: no OQL. */
export interface PublicDashlet {
  id: string;
  kind: DashletKind;
  title: string;
  subtitle?: string;
  text?: string;
  /** The class it reports on, for a "view all" link and labelling. */
  class?: string;
}

export interface PublicDashboard {
  id: string;
  title: string;
  columns: number;
  dashlets: PublicDashlet[];
}

/** The computed payload for one dashlet. Shape depends on kind. */
export type DashletData =
  | { kind: "badge"; count: number; class: string }
  | { kind: "text" | "header"; title: string; text?: string }
  | { kind: "pie" | "bars" | "table" | "header-dynamic"; class: string; total: number; groups: { key: string; label: string; count: number }[] }
  | { kind: "list"; class: string; total: number; items: { id: number; label: string; fields: Record<string, unknown> }[] };

/** How many rows to pull when grouping in memory. Dashlets filter hard
 * (open-only, last 14 days), so this ceiling is generous, not a guess. */
const GROUP_SCAN_LIMIT = 5000;

export class Dashboards {
  private constructor(
    private readonly data: DashboardFile,
    private readonly objects: ObjectsService,
    private readonly schema: CmdbSchema,
  ) {}

  static fromFile(path: string, objects: ObjectsService, schema: CmdbSchema): Dashboards {
    let parsed: DashboardFile;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as DashboardFile;
    } catch (error) {
      throw new Error(
        `Could not read the dashboards file at ${path}. Run cmdb-schema/extract-dashboards.py. (${(error as Error).message})`,
      );
    }
    return new Dashboards(parsed, objects, schema);
  }

  static fromData(data: DashboardFile, objects: ObjectsService, schema: CmdbSchema): Dashboards {
    return new Dashboards(data, objects, schema);
  }

  get ids(): string[] {
    return Object.keys(this.data.dashboards).sort();
  }

  has(id: string): boolean {
    return Object.hasOwn(this.data.dashboards, id);
  }

  /** The structure, stripped of OQL. */
  public(id: string): PublicDashboard {
    // Own keys only: "constructor" must not find Object.prototype's.
    const dash = Object.hasOwn(this.data.dashboards, id) ? this.data.dashboards[id] : undefined;
    if (!dash) throw notFound(`No dashboard called "${id}".`);
    return {
      id: dash.id,
      title: dash.title,
      columns: dash.columns,
      dashlets: dash.dashlets.map((d) => ({
        id: d.id,
        kind: d.kind,
        title: d.title,
        ...(d.subtitle ? { subtitle: d.subtitle } : {}),
        ...(d.text ? { text: d.text } : {}),
        ...(d.class ? { class: d.class } : {}),
      })),
    };
  }

  private dashlet(dashboardId: string, dashletId: string): RawDashlet {
    const dash = Object.hasOwn(this.data.dashboards, dashboardId) ? this.data.dashboards[dashboardId] : undefined;
    if (!dash) throw notFound(`No dashboard called "${dashboardId}".`);
    const dashlet = dash.dashlets.find((d) => d.id === dashletId);
    if (!dashlet) throw notFound(`Dashboard "${dashboardId}" has no dashlet "${dashletId}".`);
    return dashlet;
  }

  /** The human label for an enum value, via the schema the frontend also uses. */
  private valueLabel(className: string | undefined, attcode: string | undefined, value: string): string {
    if (!className || !attcode) return value;
    const info = this.schema.get(className);
    const field = info?.fields[attcode];
    // ExternalKey values are ids; the group key stands in until the UI resolves
    // it. Enum values have dictionary labels on the field.
    const labels = (field as { values?: string[] } | undefined) ? info?.labels?.values?.[attcode] : undefined;
    return labels?.[value] ?? value;
  }

  /** Computes one dashlet's data. The OQL is read here and never returned. */
  async compute(dashboardId: string, dashletId: string): Promise<DashletData> {
    const d = this.dashlet(dashboardId, dashletId);

    if (d.kind === "text" || d.kind === "header") {
      return { kind: d.kind, title: d.title, ...(d.text ? { text: d.text } : {}) };
    }

    const className = d.class ?? "Ticket";
    const oql = d.oql ?? `SELECT ${className}`;

    if (d.kind === "badge") {
      const result = await this.objects.list(className, { page: 1, limit: 1, oql, fields: "id" });
      return { kind: "badge", count: result.total, class: className };
    }

    if (d.kind === "list") {
      const info = this.schema.get(className);
      const cols = (info?.presentation?.list ?? ["friendlyname"]).filter((c) => info?.fields[c]).slice(0, 4);
      const result = await this.objects.list(className, {
        page: 1,
        limit: 10,
        oql,
        fields: ["id", ...cols].join(","),
      });
      return {
        kind: "list",
        class: className,
        total: result.total,
        items: result.items.map((r) => ({ id: r.id, label: r.label, fields: r.fields })),
      };
    }

    // pie / bars / table / header-dynamic: group rows by an attribute and count.
    const groupBy = d.groupBy ?? "finalclass";
    // Paged: a single list() call is clamped to 500 rows, which made every
    // dashlet over 500 matches report partial counts as if they were whole.
    const result = await this.objects.listAll(
      className,
      { oql, fields: ["id", groupBy].join(",") },
      GROUP_SCAN_LIMIT,
    );

    const counts = new Map<string, number>();
    for (const row of result.items) {
      const raw = row.fields[groupBy];
      const key = this.bucket(raw, d.groupFn);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    let groups = [...counts.entries()].map(([key, count]) => ({
      key,
      label: this.bucketLabel(key, className, groupBy, d.groupFn),
      count,
    }));

    // header-dynamic names the exact buckets it wants (NetworkDevice, Server…);
    // show them in that order, including zeroes, and nothing else.
    if (d.kind === "header-dynamic" && d.values?.length) {
      groups = d.values.map((v) => ({
        key: v,
        label: this.valueLabel(className, groupBy, v),
        count: counts.get(v) ?? 0,
      }));
    } else {
      groups.sort((a, b) => b.count - a.count);
    }

    return { kind: d.kind, class: className, total: result.items.length, groups };
  }

  /** Reduces a raw value to its group key, applying a date function if any. */
  private bucket(raw: unknown, fn?: string): string {
    const value = raw === null || raw === undefined ? "" : String(raw);
    if (!value) return "—";
    if (!fn) return value;
    // iTop date functions used by these dashboards. DateTime values arrive as
    // ISO instants; the day they count towards is iTop's, as in its console.
    const instant = value.includes("T") ? new Date(value) : null;
    const date =
      instant && !Number.isNaN(instant.getTime())
        ? itopDay(instant, this.objects.timeZone)
        : value.slice(0, 10); // YYYY-MM-DD
    if (fn === "day_of_month") return date.slice(8, 10) || value;
    if (fn === "month") return date.slice(0, 7) || value; // YYYY-MM
    if (fn === "year") return date.slice(0, 4) || value;
    return value;
  }

  private bucketLabel(key: string, className: string, groupBy: string, fn?: string): string {
    if (fn) return key; // a date part reads as-is
    if (key === "—") return "Not set";
    return this.valueLabel(className, groupBy, key);
  }
}
