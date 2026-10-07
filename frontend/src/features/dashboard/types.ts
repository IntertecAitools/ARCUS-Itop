// dashboard: feature types.
import type { TicketPriority, TicketStatus } from '@/types/ticket';

/** The window the whole dashboard is scoped to. */
export type DateRange = '24h' | '7d' | '30d' | '90d';

export interface KpiDelta {
  /** Magnitude only — the arrow carries direction. */
  value: string;
  direction: 'up' | 'down' | 'flat';
  /**
   * Whether the movement is GOOD or BAD for this metric. Decided by the API,
   * not inferred from the arrow: breaches falling is good news pointing down.
   */
  intent: 'positive' | 'negative' | 'neutral';
}

export interface SparkPoint {
  label: string;
  value: number;
}

export type KpiKey = 'totalIncidents' | 'openIncidents' | 'slaBreached' | 'slaCompliance';

export interface KpiSummary {
  totalIncidents: number;
  openIncidents: number;
  slaBreached: number;
  /**
   * 0–1 ratio, formatted for display at the edge. `null` when nothing is
   * covered by an SLA — rendering 0% there would claim total failure when the
   * truth is that there is nothing to measure.
   */
  slaCompliance: number | null;
  /**
   * Optional: with no prior period to compare against there is no delta, and a
   * tile showing "0%" would imply "unchanged" rather than "unknown".
   */
  deltas?: Partial<Record<KpiKey, KpiDelta>>;
  /** Optional per-KPI micro-trend. Omitted when there is no history. */
  sparklines?: Partial<Record<KpiKey, SparkPoint[]>>;
}

export interface TrendPoint {
  /**
   * ISO day, `YYYY-MM-DD`. Deliberately machine-readable rather than a
   * pre-formatted label: the axis renders in the viewer's locale, and a
   * pre-formatted string could not be re-formatted or sorted.
   */
  date: string;
  created: number;
  resolved: number;
}

export interface CategoryBreakdown {
  key: string;
  label: string;
  value: number;
}

export interface SlaBreakdown {
  /** 0–1 ratio; `null` when nothing is under an SLA. */
  compliance: number | null;
  onTime: number;
  atRisk: number;
  breached: number;
}

export interface DashboardTicket {
  id: string;
  ref: string;
  summary: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignee?: { id: string; name: string };
  createdAt: string;
}

export interface CatalogShortcut {
  id: string;
  label: string;
  description: string;
  /** Icon name resolved by the UI — the API never ships a component. */
  icon: 'access' | 'hardware' | 'software' | 'email';
}

export interface ChangeEvent {
  id: string;
  ref: string;
  title: string;
  /** ISO datetime. */
  scheduledAt: string;
  risk: 'low' | 'medium' | 'high';
}

export interface KnowledgeArticle {
  id: string;
  title: string;
  views: number;
}

export interface DashboardOverview {
  kpis: KpiSummary;
  trend: TrendPoint[];
  categories: CategoryBreakdown[];
  sla: SlaBreakdown;
  recentIncidents: DashboardTicket[];
  myAssignments: {
    incidents: DashboardTicket[];
    approvals: DashboardTicket[];
    requests: DashboardTicket[];
  };
  catalogShortcuts: CatalogShortcut[];
  changeCalendar: ChangeEvent[];
  knowledgeArticles: KnowledgeArticle[];
}
