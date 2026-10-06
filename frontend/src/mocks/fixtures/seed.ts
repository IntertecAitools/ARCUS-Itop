/**
 * Builds the initial mock database. Dates are relative to "now" so the dashboard
 * always shows a live-looking last 90 days. A seeded PRNG keeps data stable.
 */
import type { CaseLogEntry } from '@/features/tickets';

export type Status = 'new' | 'assigned' | 'resolved' | 'closed';

export interface ProblemRecord {
  id: string;
  ref: string;
  title: string;
  description: string;
  org_id: string;
  caller_id: string | null;
  team_id: string | null;
  agent_id: string | null;
  status: Status;
  service_id: string | null;
  servicesubcategory_id: string | null;
  product: string;
  impact: '1' | '2' | '3';
  urgency: '1' | '2' | '3' | '4';
  priority: '1' | '2' | '3' | '4';
  related_change_id: string | null;
  start_date: string;
  last_update: string;
  assignment_date: string | null;
  resolution_date: string | null;
  close_date: string | null;
  private_log: CaseLogEntry[];
  cis: Array<{ functionalci_id: string; impact_code: 'manual' | 'computed' | 'not_impacted' }>;
  contacts: Array<{ contact_id: string; role_code: 'manual' | 'computed' | 'do_not_notify' }>;
}

export interface TicketRecord {
  id: string;
  ref: string;
  title: string;
  status: string;
  priority: '1' | '2' | '3' | '4';
  start_date: string;
  org_id: string;
  parent_problem_id: string | null;
}

export interface KnownErrorRecord {
  id: string;
  name: string;
  org_id: string;
  problem_id: string | null;
  symptom: string;
  root_cause: string;
  workaround: string;
  solution: string;
  error_code: string;
  domain: 'Network' | 'Server' | 'Application' | 'Desktop';
  vendor: string;
  model: string;
  version: string;
  ci_list: Array<{ functionalci_id: string; reason: string }>;
  document_list: Array<{ document_id: string; document_name: string }>;
  created: string;
}

export interface AttachmentRecord {
  id: string;
  problem_id: string;
  filename: string;
  mimetype: string;
  data: string;
  size: number;
  creation_date: string;
}

export interface MockDb {
  problems: ProblemRecord[];
  incidents: TicketRecord[];
  requests: TicketRecord[];
  knownErrors: KnownErrorRecord[];
  attachments: AttachmentRecord[];
  seq: { problem: number; knownError: number; attachment: number };
}

/** iTop priority matrix, as computed server-side */
export const PRIORITY: Record<string, Record<string, '1' | '2' | '3' | '4'>> = {
  '1': { '1': '1', '2': '1', '3': '2', '4': '4' },
  '2': { '1': '1', '2': '2', '3': '3', '4': '4' },
  '3': { '1': '2', '2': '3', '3': '3', '4': '4' },
};

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Theme {
  title: string;
  description: string;
  service: string;
  subcategory: string;
  product: string;
  cis: string[];
  team: string;
}

const THEMES: Theme[] = [
  {
    title: 'Recurring mailbox sync failures for mobile users',
    description: '<p>Several users report that Outlook mobile stops syncing every few days. Restarting the app restores sync temporarily.</p>',
    service: '1',
    subcategory: '11',
    product: 'Exchange Online',
    cis: ['1', '9'],
    team: '104',
  },
  {
    title: 'VPN tunnels drop under load after 17:00',
    description: '<p>Remote staff lose VPN connectivity at peak hours. <strong>14 incidents</strong> in two weeks point to the same gateway.</p>',
    service: '2',
    subcategory: '21',
    product: 'GlobalProtect',
    cis: ['12', '10'],
    team: '103',
  },
  {
    title: 'ERP month-end close times out',
    description: '<p>The finance close batch exceeds the 30 minute window. DB connection pool exhaustion is suspected.</p>',
    service: '3',
    subcategory: '31',
    product: 'ERP Finance',
    cis: ['3', '4', '5'],
    team: '104',
  },
  {
    title: 'Customer portal intermittent 502 on payment step',
    description: '<p>Checkout fails with HTTP 502 for roughly 2% of payments. Load balancer logs show upstream resets.</p>',
    service: '4',
    subcategory: '42',
    product: 'Payments API',
    cis: ['7', '8', '13'],
    team: '104',
  },
  {
    title: 'Wi-Fi authentication loops on floor 3',
    description: '<p>Laptops on floor 3 repeatedly prompt for credentials. Other floors are unaffected.</p>',
    service: '2',
    subcategory: '22',
    product: 'Aruba ClearPass',
    cis: ['11'],
    team: '103',
  },
  {
    title: 'Calendar invites duplicated across time zones',
    description: '<p>Meeting invites sent from APAC appear twice for EMEA attendees.</p>',
    service: '1',
    subcategory: '12',
    product: 'Exchange Online',
    cis: ['2', '9'],
    team: '104',
  },
  {
    title: 'SSO login loop after password reset',
    description: '<p>Users who reset their password cannot sign in to the portal for up to one hour.</p>',
    service: '4',
    subcategory: '41',
    product: 'Azure AD B2C',
    cis: ['7', '14'],
    team: '104',
  },
  {
    title: 'Inventory sync lag between ERP and warehouse',
    description: '<p>Stock levels in the warehouse app lag ERP by up to 40 minutes. Kafka consumer lag spikes match the reports.</p>',
    service: '3',
    subcategory: '32',
    product: 'ERP Inventory',
    cis: ['15', '3'],
    team: '104',
  },
  {
    title: 'Print jobs stuck in queue at HQ',
    description: '<p>Jobs sent to prn-hq-3f stay queued until the spooler is restarted.</p>',
    service: '5',
    subcategory: '52',
    product: 'Windows Print Server',
    cis: ['16'],
    team: '102',
  },
  {
    title: 'Laptop docking stations lose external displays',
    description: '<p>After the latest driver update, external monitors disconnect on wake from sleep.</p>',
    service: '5',
    subcategory: '51',
    product: 'Dell WD19',
    cis: ['17'],
    team: '102',
  },
  {
    title: 'WAN latency spikes to branch offices',
    description: '<p>Branch offices see 400 ms+ latency several times per day, impacting ERP sessions.</p>',
    service: '2',
    subcategory: '23',
    product: 'SD-WAN',
    cis: ['10', '11'],
    team: '103',
  },
  {
    title: 'Teams meetings drop audio for external guests',
    description: '<p>External guests lose audio after about 20 minutes in meetings hosted by Demo Corp.</p>',
    service: '1',
    subcategory: '13',
    product: 'Microsoft Teams',
    cis: ['9'],
    team: '104',
  },
];

const CALLERS: Record<string, string[]> = { '1': ['2', '7'], '2': ['8', '9'], '3': ['10', '11'], '4': ['12', '13'] };
const TEAM_AGENTS: Record<string, string[]> = { '101': ['1', '3'], '102': ['2', '7'], '103': ['4', '5'], '104': ['6', '3', '1'] };
const PERSON_LOGIN: Record<string, { login: string; name: string }> = {
  '1': { login: 'admin', name: 'Alex Morgan' },
  '3': { login: 'dokafor', name: 'Daniel Okafor' },
  '4': { login: 'mlin', name: 'Mei Lin' },
  '5': { login: 'lferreira', name: 'Lucas Ferreira' },
  '6': { login: 'snilsson', name: 'Sara Nilsson' },
  '2': { login: 'agent', name: 'Priya Sharma' },
  '7': { login: 'ohaddad', name: 'Omar Haddad' },
};

const iso = (ms: number) => new Date(ms).toISOString();

export function buildSeed(now = Date.now()): MockDb {
  const rand = mulberry32(20261006);
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)]!;

  const problems: ProblemRecord[] = [];
  const COUNT = 42;
  for (let i = 0; i < COUNT; i += 1) {
    const theme = THEMES[i % THEMES.length]!;
    const id = String(i + 1);
    // Spread over 90 days, denser in recent weeks
    const ageDays = Math.floor(Math.pow(rand(), 1.4) * 88) + (i < 3 ? 0 : 0.3);
    const start = now - ageDays * DAY - Math.floor(rand() * 8) * HOUR;
    const org = pick(['1', '1', '2', '3', '4']);
    const impact = pick(['1', '2', '2', '3', '3'] as const);
    const urgency = pick(['1', '2', '3', '3', '4'] as const);

    // Older problems are further along the lifecycle
    const r = rand();
    let status: Status;
    if (ageDays < 3) status = r < 0.6 ? 'new' : 'assigned';
    else if (ageDays < 20) status = r < 0.2 ? 'new' : r < 0.6 ? 'assigned' : r < 0.9 ? 'resolved' : 'closed';
    else status = r < 0.05 ? 'new' : r < 0.25 ? 'assigned' : r < 0.55 ? 'resolved' : 'closed';

    const team = status === 'new' ? null : theme.team;
    const agent = team ? pick(TEAM_AGENTS[team]!) : null;
    const assignment = status === 'new' ? null : start + (2 + rand() * 30) * HOUR;
    const resolution =
      status === 'resolved' || status === 'closed'
        ? Math.min(now - HOUR, assignment! + (1 + rand() * Math.max(1, ageDays - 1)) * DAY)
        : null;
    const close = status === 'closed' ? Math.min(now - 30 * 60 * 1000, resolution! + (1 + rand() * 3) * DAY) : null;
    const lastUpdate = close ?? resolution ?? assignment ?? start;

    const log: CaseLogEntry[] = [];
    if (assignment && agent) {
      const who = PERSON_LOGIN[agent]!;
      log.push({
        date: iso(assignment + HOUR),
        user_login: who.login,
        user_name: who.name,
        message_html: '<p>Started root cause analysis. Collecting logs from the affected CIs.</p>',
      });
    }
    if (resolution && agent) {
      const who = PERSON_LOGIN[agent]!;
      log.push({
        date: iso(resolution),
        user_login: who.login,
        user_name: who.name,
        message_html: '<p>Root cause identified and documented as a known error. Permanent fix scheduled.</p>',
      });
    }

    problems.push({
      id,
      ref: `P-${String(122 + i + 1).padStart(6, '0')}`,
      title: i < THEMES.length ? theme.title : `${theme.title} (${pick(['EMEA', 'APAC', 'Americas', 'HQ'])})`,
      description: theme.description,
      org_id: org,
      caller_id: rand() < 0.8 ? pick(CALLERS[org]!) : null,
      team_id: team,
      agent_id: agent,
      status,
      service_id: status === 'resolved' || status === 'closed' || rand() < 0.75 ? theme.service : null,
      servicesubcategory_id: null,
      product: theme.product,
      impact,
      urgency,
      priority: PRIORITY[impact]![urgency]!,
      related_change_id: null,
      start_date: iso(start),
      last_update: iso(lastUpdate),
      assignment_date: assignment ? iso(assignment) : null,
      resolution_date: resolution ? iso(resolution) : null,
      close_date: close ? iso(close) : null,
      private_log: log,
      cis: theme.cis.map((ci) => ({ functionalci_id: ci, impact_code: 'manual' as const })),
      contacts: rand() < 0.4 ? [{ contact_id: pick(['3', '6', '7']), role_code: 'manual' as const }] : [],
    });
    const p = problems[problems.length - 1]!;
    if (p.service_id) p.servicesubcategory_id = rand() < 0.7 ? theme.subcategory : null;
  }

  // Show the newest first in id order too
  problems.sort((a, b) => a.start_date.localeCompare(b.start_date));
  problems.forEach((p, i) => {
    p.id = String(i + 1);
    p.ref = `P-${String(123 + i).padStart(6, '0')}`;
  });

  // Hand-tuned links for the most recent problems
  const vpn = problems.find((p) => p.title.startsWith('VPN tunnels') && p.status !== 'closed');
  if (vpn) vpn.related_change_id = '1';
  const erp = problems.find((p) => p.title.startsWith('ERP month-end') && p.status !== 'closed');
  if (erp) erp.related_change_id = '3';

  const incidentTitles = [
    'Cannot send email from iPhone',
    'VPN disconnected during call',
    'Month-end close job failed',
    'Payment failed with error 502',
    'Wi-Fi keeps asking for password',
    'Duplicate meeting invite received',
    'Unable to log in after reset',
    'Stock count mismatch in warehouse app',
    'Print job stuck',
    'Monitor not detected on dock',
    'ERP very slow at branch office',
    'Guest audio lost in Teams call',
    'Outlook mobile not syncing',
    'VPN slow from home',
    'Checkout page error for customer',
    'Laptop screen flickers',
    'Shared mailbox missing items',
    'Branch cannot reach ERP',
  ];
  const incidents: TicketRecord[] = incidentTitles.map((title, i) => {
    const age = Math.floor(rand() * 40);
    return {
      id: String(i + 1),
      ref: `I-${String(201 + i).padStart(6, '0')}`,
      title,
      status: pick(['new', 'assigned', 'assigned', 'pending', 'resolved', 'closed']),
      priority: pick(['1', '2', '3', '3', '4'] as const),
      start_date: iso(now - age * DAY - Math.floor(rand() * 10) * HOUR),
      org_id: pick(['1', '2', '3', '4']),
      parent_problem_id: null,
    };
  });
  // Link the first incidents to problems sharing the theme
  incidents.slice(0, 12).forEach((inc, i) => {
    const theme = THEMES[i]!;
    const problem = [...problems].reverse().find((p) => p.title.startsWith(theme.title));
    if (problem) inc.parent_problem_id = problem.id;
  });

  const requestTitles = [
    'New VPN token for contractor',
    'Add user to finance distribution list',
    'Request second monitor',
    'Access to ERP inventory reports',
    'Install Teams on meeting room PC',
    'Increase mailbox quota',
    'New printer driver for floor 3',
    'Portal account for partner',
  ];
  const requests: TicketRecord[] = requestTitles.map((title, i) => ({
    id: String(i + 1),
    ref: `R-${String(301 + i).padStart(6, '0')}`,
    title,
    status: pick(['new', 'assigned', 'waiting_for_approval', 'approved', 'resolved', 'closed']),
    priority: pick(['2', '3', '4'] as const),
    start_date: iso(now - Math.floor(rand() * 30) * DAY),
    org_id: pick(['1', '2', '3', '4']),
    parent_problem_id: null,
  }));
  const vpnProblem = vpn ?? problems[problems.length - 1]!;
  requests[0]!.parent_problem_id = vpnProblem.id;

  const resolvedWith = (prefix: string) =>
    problems.find((p) => p.title.startsWith(prefix) && (p.status === 'resolved' || p.status === 'closed')) ?? null;

  const keSeeds: Array<Omit<KnownErrorRecord, 'id' | 'created' | 'problem_id'> & { from: string }> = [
    {
      from: 'VPN tunnels',
      name: 'VPN gateway session table exhaustion',
      org_id: '1',
      symptom: 'VPN tunnels drop for many users at the same time, usually after 17:00.',
      root_cause: 'The gateway session table is sized for 2,000 sessions; peak usage exceeds it.',
      workaround: 'Reconnect after 2 minutes, or connect to the secondary portal vpn2.democorp.example.',
      solution: 'Upgrade firmware to 10.2.9 and raise the session limit (change C-000101).',
      error_code: 'GP-SESS-1042',
      domain: 'Network',
      vendor: 'Palo Alto Networks',
      model: 'PA-3220',
      version: '10.1.6',
      ci_list: [{ functionalci_id: '12', reason: 'Gateway hitting session limit' }],
      document_list: [{ document_id: '1', document_name: 'VPN gateway runbook.pdf' }],
    },
    {
      from: 'ERP month-end',
      name: 'ERP DB connection pool exhausted during batch',
      org_id: '1',
      symptom: 'Finance close batch runs longer than 30 minutes and times out.',
      root_cause: 'The application server pool is limited to 50 connections; batch jobs open one per worker.',
      workaround: 'Run the close batch with 8 workers instead of 16.',
      solution: 'Increase the pool to 120 connections (change C-000103).',
      error_code: 'ORA-12519',
      domain: 'Application',
      vendor: 'Oracle',
      model: 'Database 19c',
      version: '19.21',
      ci_list: [
        { functionalci_id: '4', reason: 'Database host' },
        { functionalci_id: '3', reason: 'Batch runs here' },
      ],
      document_list: [],
    },
    {
      from: 'Customer portal',
      name: 'Payment API upstream keep-alive mismatch',
      org_id: '1',
      symptom: 'HTTP 502 on the payment step for a small share of requests.',
      root_cause: 'Load balancer idle timeout (60 s) is longer than the API keep-alive (30 s).',
      workaround: 'Customers retry the payment; the second attempt succeeds.',
      solution: 'Set the API keep-alive to 75 s.',
      error_code: 'HTTP 502',
      domain: 'Application',
      vendor: 'NGINX',
      model: 'Plus',
      version: 'R31',
      ci_list: [{ functionalci_id: '13', reason: 'Upstream node' }],
      document_list: [],
    },
    {
      from: 'Print jobs',
      name: 'Print spooler hangs on PCL6 driver',
      org_id: '1',
      symptom: 'Jobs queue but never print until the spooler restarts.',
      root_cause: 'A known bug in PCL6 driver 6.3 deadlocks the spooler with duplex jobs.',
      workaround: 'Restart the Print Spooler service on the print server.',
      solution: 'Install driver 6.4.1.',
      error_code: '0x0000007a',
      domain: 'Desktop',
      vendor: 'HP',
      model: 'LaserJet M609',
      version: 'PCL6 6.3',
      ci_list: [{ functionalci_id: '16', reason: 'Affected printer' }],
      document_list: [],
    },
    {
      from: 'Wi-Fi',
      name: 'RADIUS certificate expired on floor 3 controller',
      org_id: '1',
      symptom: 'Laptops keep prompting for Wi-Fi credentials.',
      root_cause: 'The floor 3 controller still presents the expired RADIUS certificate.',
      workaround: 'Connect to the "Guest" SSID.',
      solution: 'Deploy the renewed certificate to all controllers.',
      error_code: 'EAP-TLS 0x80420112',
      domain: 'Network',
      vendor: 'Aruba',
      model: '7210',
      version: '8.10',
      ci_list: [{ functionalci_id: '11', reason: 'Controller uplink' }],
      document_list: [],
    },
    {
      from: 'Laptop docking',
      name: 'Dock firmware loses DisplayPort after S3 resume',
      org_id: '1',
      symptom: 'External monitors stay black after waking the laptop.',
      root_cause: 'Dock firmware 01.00.20 does not re-train DisplayPort after S3 resume.',
      workaround: 'Unplug and re-plug the dock USB-C cable.',
      solution: 'Update dock firmware to 01.00.32.',
      error_code: '',
      domain: 'Desktop',
      vendor: 'Dell',
      model: 'WD19',
      version: '01.00.20',
      ci_list: [{ functionalci_id: '17', reason: 'Reported laptop' }],
      document_list: [],
    },
    {
      from: 'Teams meetings',
      name: 'Media relay port range blocked for guests',
      org_id: '1',
      symptom: 'External guests lose audio about 20 minutes into a meeting.',
      root_cause: 'Firewall closes UDP 3478-3481 sessions after 20 minutes idle.',
      workaround: 'Guests rejoin the meeting.',
      solution: 'Extend the UDP session timeout on fw-edge-01.',
      error_code: '',
      domain: 'Server',
      vendor: 'Microsoft',
      model: 'Teams',
      version: '',
      ci_list: [{ functionalci_id: '10', reason: 'Edge firewall' }],
      document_list: [],
    },
  ];

  const knownErrors: KnownErrorRecord[] = keSeeds.map(({ from, ...ke }, i) => {
    const problem = resolvedWith(from);
    return {
      ...ke,
      id: String(i + 1),
      problem_id: problem?.id ?? null,
      // the last two were created this week, for the KPI trend
      created: iso(i >= keSeeds.length - 2 ? now - (i - 3) * DAY : now - (20 + i * 9) * DAY),
    };
  });

  return {
    problems,
    incidents,
    requests,
    knownErrors,
    attachments: [],
    seq: { problem: problems.length, knownError: knownErrors.length, attachment: 0 },
  };
}
