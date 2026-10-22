import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { GroupKeyType } from '../lib/labels';

/**
 * iTop's Overview dashboards, through the BFF.
 *
 * The structure (dashlets, titles, layout) comes from one call; each dashlet's
 * data is fetched on its own so one slow query never blocks the whole board.
 * The OQL behind each dashlet stays in the BFF — the frontend addresses a
 * dashlet by id, exactly like a navigation view.
 */

export type DashletKind =
  | 'pie'
  | 'bars'
  | 'table'
  | 'list'
  | 'badge'
  | 'header'
  | 'header-dynamic'
  | 'text';

export interface PublicDashlet {
  id: string;
  kind: DashletKind;
  title: string;
  subtitle?: string;
  text?: string;
  class?: string;
}

export interface Dashboard {
  id: string;
  title: string;
  columns: number;
  dashlets: PublicDashlet[];
}

/** `label` is the class's own singular label from iTop ("Business Process"). */
export type DashletData =
  | { kind: 'badge'; count: number; class: string; label?: string }
  | { kind: 'text' | 'header'; title: string; text?: string }
  | {
      kind: 'pie' | 'bars' | 'table' | 'header-dynamic';
      class: string;
      label?: string;
      total: number;
      /** What the group keys are: plain values, or YYYY-MM-DD days etc. */
      keyType?: GroupKeyType;
      groups: { key: string; label: string; count: number }[];
      /** The groups count only the first rows read; `total` is every match. */
      truncated?: boolean;
    }
  | {
      kind: 'list';
      class: string;
      label?: string;
      total: number;
      items: { id: number; label: string; fields: Record<string, unknown> }[];
    };

/** The viewer's zone, so a per-day chart counts the days they live in. */
const viewerZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

export function useDashboard(id: string) {
  return useQuery({
    queryKey: ['dashboard', id],
    queryFn: () => apiClient.get<Dashboard>(`/meta/dashboards/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
    staleTime: 5 * 60 * 1000,
  });
}

export function useDashletData(dashboardId: string, dashletId: string, enabled = true) {
  return useQuery({
    queryKey: ['dashlet', dashboardId, dashletId],
    queryFn: () => {
      const tz = viewerZone();
      return apiClient.get<DashletData>(
        `/dashboards/${encodeURIComponent(dashboardId)}/dashlets/${encodeURIComponent(dashletId)}${
          tz ? `?tz=${encodeURIComponent(tz)}` : ''
        }`,
      );
    },
    enabled: enabled && Boolean(dashboardId && dashletId),
    // Dashboards show live counts; a short stale window keeps them fresh without
    // re-querying iTop on every revisit.
    staleTime: 60 * 1000,
  });
}
