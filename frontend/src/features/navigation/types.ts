/**
 * iTop's navigation, as published by the BFF.
 *
 * The sidebar is a projection of this rather than a hand-written list, so
 * installing a module in iTop makes it appear here with no frontend change.
 * Note what is deliberately absent: the OQL behind a filtered view. The BFF
 * resolves a view by id, so no screen ever holds an iTop query.
 */

export type EntryKind = 'list' | 'create' | 'search';

export interface NavEntry {
  /** iTop's menu id, e.g. `Incident:OpenIncidents`. Also the view id. */
  id: string;
  kind: EntryKind;
  class: string;
  label: string;
  /** The entry narrows the class server-side. How, we never see. */
  filtered: boolean;
  /** False for abstract classes, which cannot hold rows directly. */
  creatable: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  /** Administering iTop rather than using it; shown apart. */
  isAdmin: boolean;
  entries: NavEntry[];
}

export interface NavDiagnostic {
  id: string;
  type: string;
  reason: string;
}

export interface Navigation {
  groups: NavGroup[];
  classLabels: Record<string, string>;
  /** Menu nodes iTop has that we do not render, each with a reason. */
  excluded: NavDiagnostic[];
  counts: { groups: number; entries: number; views: number; excluded: number };
}
