import type { DashboardOverview } from '@/features/dashboard/types';

/**
 * Realistic sample data for the dashboard.
 *
 * Shaped exactly like the BFF response, so switching `VITE_API_MODE` to `live`
 * changes nothing in the UI. Keep the numbers internally consistent (the
 * category breakdown sums to the incident total, the SLA split sums to the
 * ticket count) — demo data that doesn't add up trains everyone to ignore it.
 */

/**
 * Dates are generated relative to "now" rather than hardcoded, so the mock
 * never drifts into looking stale — the trend always ends today and the change
 * calendar always has something on the current week.
 */
const DAY_MS = 86_400_000;
const atOffset = (dayOffset: number, hour = 9, minute = 0) => {
  const d = new Date(Date.now() + dayOffset * DAY_MS);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

const days = Array.from({ length: 7 }, (_, i) =>
  new Date(Date.now() - (6 - i) * DAY_MS).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  }),
);

const trend = [
  { date: days[0], created: 28, resolved: 19 },
  { date: days[1], created: 38, resolved: 24 },
  { date: days[2], created: 48, resolved: 30 },
  { date: days[3], created: 41, resolved: 29 },
  { date: days[4], created: 46, resolved: 31 },
  { date: days[5], created: 45, resolved: 28 },
  { date: days[6], created: 72, resolved: 26 },
];

const spark = (values: number[]) =>
  values.map((value, i) => ({ label: days[i] ?? `T-${values.length - i}`, value }));

/**
 * What the mock serves today: a dashboard with nothing in it.
 *
 * This is the real starting state of a fresh instance, and it is the state the
 * empty views are designed against — every card shows its own empty state
 * rather than an invented number. Swap the handler to `seededOverview` below
 * when you want a populated screen to demo or to style against.
 */
export const emptyOverview: DashboardOverview = {
  kpis: {
    totalIncidents: 0,
    openIncidents: 0,
    slaBreached: 0,
    slaCompliance: null,
    // No prior period, so no delta and no sparkline — a "0%" delta would read
    // as "unchanged" when the truth is "nothing to compare against".
  },
  trend: [],
  categories: [],
  sla: { compliance: null, onTime: 0, atRisk: 0, breached: 0 },
  recentIncidents: [],
  myAssignments: { incidents: [], approvals: [], requests: [] },
  catalogShortcuts: [],
  changeCalendar: [],
  knowledgeArticles: [],
};

/** Sidebar badges: nothing outstanding, so no badge renders at all. */
export const emptyNavCounts = {
  openIncidents: 0,
  openRequests: 0,
};

/** Populated sample data — kept for demos and for styling the loaded states. */
export const seededOverview: DashboardOverview = {
  kpis: {
    totalIncidents: 248,
    openIncidents: 42,
    slaBreached: 18,
    slaCompliance: 0.91,
    deltas: {
      totalIncidents: { value: '12%', direction: 'up', intent: 'negative' },
      openIncidents: { value: '8%', direction: 'up', intent: 'negative' },
      // Fewer breaches is good news, even though the arrow points down.
      slaBreached: { value: '3%', direction: 'down', intent: 'positive' },
      slaCompliance: { value: '5%', direction: 'up', intent: 'positive' },
    },
    sparklines: {
      totalIncidents: spark([28, 38, 48, 41, 46, 45, 72]),
      openIncidents: spark([31, 29, 36, 33, 38, 36, 42]),
      slaBreached: spark([12, 15, 14, 19, 17, 21, 18]),
      slaCompliance: spark([84, 86, 85, 88, 87, 90, 91]),
    },
  },

  trend,

  // Sums to 248, matching totalIncidents.
  categories: [
    { key: 'network', label: 'Network', value: 68 },
    { key: 'application', label: 'Application', value: 52 },
    { key: 'access', label: 'Access', value: 34 },
    { key: 'hardware', label: 'Hardware', value: 28 },
    { key: 'software', label: 'Software', value: 22 },
    // The tail is folded into one slice rather than given its own hue —
    // the palette caps at eight categorical slots.
    { key: 'others', label: 'Others', value: 44 },
  ],

  // 186 + 32 + 18 = 236 tickets under SLA; 186/(186+18+32) ≈ 0.91.
  sla: { compliance: 0.91, onTime: 186, atRisk: 32, breached: 18 },

  recentIncidents: [
    {
      id: 'inc-1042',
      ref: 'INC-1042',
      summary: 'VPN connection unavailable',
      status: 'open',
      priority: 'critical',
      assignee: { id: 'u-1', name: 'Vasanth' },
      createdAt: atOffset(0, 10, 42),
    },
    {
      id: 'inc-1041',
      ref: 'INC-1041',
      summary: 'Email service intermittent',
      status: 'in_progress',
      priority: 'high',
      assignee: { id: 'u-2', name: 'Ravi' },
      createdAt: atOffset(0, 9, 15),
    },
    {
      id: 'inc-1040',
      ref: 'INC-1040',
      summary: 'Laptop not booting',
      status: 'resolved',
      priority: 'medium',
      assignee: { id: 'u-3', name: 'Arun' },
      createdAt: atOffset(-1, 16, 21),
    },
    {
      id: 'inc-1039',
      ref: 'INC-1039',
      summary: 'Application timeout error',
      status: 'in_progress',
      priority: 'high',
      assignee: { id: 'u-4', name: 'Priya' },
      createdAt: atOffset(-1, 14, 10),
    },
    {
      id: 'inc-1038',
      ref: 'INC-1038',
      summary: 'Printer not working',
      status: 'closed',
      priority: 'low',
      assignee: { id: 'u-5', name: 'Kiran' },
      createdAt: atOffset(-1, 11, 30),
    },
  ],

  myAssignments: {
    incidents: [
      {
        id: 'inc-1042',
        ref: 'INC-1042',
        summary: 'VPN connection unavailable',
        status: 'open',
        priority: 'critical',
        createdAt: atOffset(0, 10, 42),
      },
      {
        id: 'inc-1037',
        ref: 'INC-1037',
        summary: 'Access request for new user',
        status: 'in_progress',
        priority: 'medium',
        createdAt: atOffset(-1, 9, 2),
      },
      {
        id: 'inc-1034',
        ref: 'INC-1034',
        summary: 'Network slow in 3rd floor',
        status: 'open',
        priority: 'high',
        createdAt: atOffset(-2, 15, 48),
      },
      {
        id: 'inc-1029',
        ref: 'INC-1029',
        summary: 'Software installation request',
        status: 'in_progress',
        priority: 'low',
        createdAt: atOffset(-2, 11, 12),
      },
      {
        id: 'inc-1021',
        ref: 'INC-1021',
        summary: 'Unable to access shared drive',
        status: 'open',
        priority: 'medium',
        createdAt: atOffset(-3, 17, 5),
      },
    ],
    approvals: [
      {
        id: 'chg-2014',
        ref: 'CHG-2014',
        summary: 'Firewall rule update',
        status: 'pending',
        priority: 'high',
        createdAt: atOffset(0, 8, 0),
      },
      {
        id: 'chg-2016',
        ref: 'CHG-2016',
        summary: 'Database upgrade window',
        status: 'pending',
        priority: 'critical',
        createdAt: atOffset(-1, 13, 30),
      },
    ],
    requests: [
      {
        id: 'req-3301',
        ref: 'REQ-3301',
        summary: 'New hardware for onboarding',
        status: 'new',
        priority: 'medium',
        createdAt: atOffset(0, 7, 45),
      },
      {
        id: 'req-3298',
        ref: 'REQ-3298',
        summary: 'Mailbox quota increase',
        status: 'open',
        priority: 'low',
        createdAt: atOffset(-1, 10, 20),
      },
    ],
  },

  catalogShortcuts: [
    {
      id: 'sc-access',
      label: 'Access Request',
      description: 'Request system access',
      icon: 'access',
    },
    {
      id: 'sc-hardware',
      label: 'New Hardware',
      description: 'Laptop, desktop, etc.',
      icon: 'hardware',
    },
    {
      id: 'sc-software',
      label: 'Software Installation',
      description: 'Install approved software',
      icon: 'software',
    },
    {
      id: 'sc-email',
      label: 'Email Configuration',
      description: 'Setup email account',
      icon: 'email',
    },
  ],

  changeCalendar: [
    {
      id: 'chg-2014',
      ref: 'CHG-2014',
      title: 'Firewall rule update',
      scheduledAt: atOffset(0, 10, 0),
      risk: 'low',
    },
    {
      id: 'chg-2015',
      ref: 'CHG-2015',
      title: 'Server patch deployment',
      scheduledAt: atOffset(0, 14, 0),
      risk: 'medium',
    },
    {
      id: 'chg-2016',
      ref: 'CHG-2016',
      title: 'Database upgrade',
      scheduledAt: atOffset(1, 18, 0),
      risk: 'high',
    },
  ],

  knowledgeArticles: [
    { id: 'kb-1', title: 'How to reset Windows password', views: 1200 },
    { id: 'kb-2', title: 'VPN connection troubleshooting', views: 856 },
    { id: 'kb-3', title: 'Email configuration guide', views: 642 },
    { id: 'kb-4', title: 'Laptop boot issue resolution', views: 521 },
  ],
};

/** Populated sidebar badge counts, paired with `seededOverview`. */
export const seededNavCounts = {
  openIncidents: 18,
  openRequests: 7,
};
