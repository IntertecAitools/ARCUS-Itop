import { readFileSync } from "node:fs";

import { notFound } from "../../core/errors.js";
import type { CmdbSchema } from "../../schema/load.js";

/**
 * iTop's own navigation tree, republished for the frontend.
 *
 * The frontend's sidebar is a projection of this, so installing a module in
 * iTop makes it appear on screen without a frontend edit. That is the whole
 * point: the alternative is a hand-written module list that has to be updated
 * in a second place every time iTop changes.
 *
 * One rule this service enforces: the OQL that defines a view NEVER leaves the
 * BFF. The frontend asks for a view by id and the OQL is resolved here. If the
 * query crossed the boundary, every screen would be reasoning about iTop's
 * datamodel and the boundary would exist in name only.
 */

export type EntryKind = "list" | "create" | "search";

interface RawEntry {
  id: string;
  kind: EntryKind;
  class: string;
  label: string;
  rank: number;
  oql?: string;
}

interface RawGroup {
  id: string;
  label: string;
  rank: number;
  isAdmin: boolean;
  entries: RawEntry[];
}

interface RawNavigation {
  groups: RawGroup[];
  classLabels: Record<string, string>;
  excluded: { id: string; type: string; reason: string }[];
}

/** An entry as the frontend sees it: no OQL. */
export interface PublicEntry {
  id: string;
  kind: EntryKind;
  class: string;
  label: string;
  /** True when this entry narrows the class with a server-side filter. */
  filtered: boolean;
  /** False when the class is abstract, so rows cannot be created directly. */
  creatable: boolean;
}

export interface PublicGroup {
  id: string;
  label: string;
  isAdmin: boolean;
  entries: PublicEntry[];
}

export interface NavigationDiagnostic {
  id: string;
  type: string;
  reason: string;
}

export class Navigation {
  private readonly views = new Map<string, { class: string; oql: string }>();

  private constructor(
    readonly groups: PublicGroup[],
    readonly classLabels: Record<string, string>,
    readonly excluded: NavigationDiagnostic[],
    views: Map<string, { class: string; oql: string }>,
  ) {
    this.views = views;
  }

  static fromFile(path: string, schema: CmdbSchema): Navigation {
    let raw: RawNavigation;
    try {
      raw = JSON.parse(readFileSync(path, "utf8")) as RawNavigation;
    } catch (error) {
      throw new Error(
        `Could not read the navigation file at ${path}. Run cmdb-schema/extract-navigation.py. (${(error as Error).message})`,
      );
    }
    return Navigation.fromData(raw, schema);
  }

  static fromData(raw: RawNavigation, schema: CmdbSchema): Navigation {
    const views = new Map<string, { class: string; oql: string }>();
    const excluded: NavigationDiagnostic[] = [...(raw.excluded ?? [])];
    const groups: PublicGroup[] = [];

    for (const group of raw.groups ?? []) {
      const entries: PublicEntry[] = [];

      for (const entry of group.entries ?? []) {
        // The navigation file is produced from the compiled datamodel, and the
        // schema file from the same source -- but they are two files, and a
        // stale one would advertise a screen the BFF cannot serve. Checking
        // turns that into a visible diagnostic instead of a 404 on click.
        const info = schema.get(entry.class);
        if (!info) {
          excluded.push({
            id: entry.id,
            type: entry.kind,
            reason: `unknown-class: ${entry.class} is not in the schema; re-run both extractors`,
          });
          continue;
        }

        if (entry.kind === "list" && entry.oql) {
          views.set(entry.id, { class: entry.class, oql: entry.oql });
        }

        entries.push({
          id: entry.id,
          kind: entry.kind,
          class: entry.class,
          label: entry.label,
          filtered: entry.kind === "list" && Boolean(entry.oql),
          // iTop offers "New CI" against the abstract FunctionalCI, where the
          // real UI asks which subclass first. A generic form cannot create an
          // abstract row, so say so rather than offering a form that fails.
          creatable: !info.abstract,
        });
      }

      if (entries.length === 0) continue;
      groups.push({
        id: group.id,
        label: group.label,
        isAdmin: Boolean(group.isAdmin),
        entries,
      });
    }

    return new Navigation(groups, raw.classLabels ?? {}, excluded, views);
  }

  /** The OQL behind a view id. Throws rather than silently listing everything. */
  resolveView(id: string): { class: string; oql: string } {
    const view = this.views.get(id);
    if (!view) {
      throw notFound(
        `No navigation view called "${id}". GET /api/meta/navigation lists the available ones.`,
      );
    }
    return view;
  }

  get viewIds(): string[] {
    return [...this.views.keys()].sort();
  }

  get entryCount(): number {
    return this.groups.reduce((total, group) => total + group.entries.length, 0);
  }
}
