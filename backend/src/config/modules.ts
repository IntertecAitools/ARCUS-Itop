import type { FastifyInstance } from "fastify";

import type { Services } from "../services.js";
import { registerBusinessHoursRoutes } from "../modules/business-hours/index.js";
import { registerChangeRoutes } from "../modules/changes/index.js";
import { registerDashboardRoutes } from "../modules/dashboard/index.js";
import { registerDataImportRoutes } from "../modules/data-import/index.js";
import { registerDirectoryRoutes } from "../modules/directory/index.js";
import { registerDispatchRoutes } from "../modules/dispatch/index.js";
import { registerIncidentRoutes } from "../modules/incidents/index.js";
import { registerMailIntakeRoutes } from "../modules/mail-intake/index.js";
import { registerProblemRoutes } from "../modules/problems/index.js";
import { registerRequestFormRoutes } from "../modules/request-forms/index.js";
import { registerSlaRoutes } from "../modules/sla/index.js";

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  THE MODULE REGISTRY  (backend twin of frontend/src/config/modules.ts)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The single source of truth for which business modules this API exposes.
 * `app.ts` builds the server from this list — it has no hardcoded route
 * imports of its own.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 * A module appears here ONLY once it is built. Nothing is listed ahead of
 * time: no endpoints that 501, no routes that return a stub. If it answers,
 * it works. This is the same rule the frontend registry follows, so the two
 * stay in step — a module is "done" when it exists on BOTH sides.
 *
 * ── Adding a module ────────────────────────────────────────────────────────
 *   1. Build it under `src/modules/<module>/`:
 *        <module>.routes.ts    HTTP layer — validation, status codes
 *        <module>.service.ts   business logic — the only place that decides
 *        <module>.schemas.ts   zod schemas for request/response
 *        <module>.types.ts     DTOs the frontend will mirror
 *        index.ts              public API — the ONLY file others may import
 *   2. Add one entry below.
 *
 *        {
 *          id: "incidents",
 *          basePath: "/api/incidents",
 *          description: "Unplanned interruptions to a service.",
 *          register: registerIncidentRoutes,
 *        }
 *
 * Nothing else changes. The route is live, and `GET /api/meta/modules` reports
 * it so the frontend can discover what the backend actually supports.
 */
export interface BackendModule {
  /** Stable id. Matches the frontend module id so the two can be diffed. */
  id: string;
  /** Route prefix this module owns. Documentation + collision checking. */
  basePath: string;
  /** One line, surfaced by GET /api/meta/modules. */
  description: string;
  /** Attaches the module's routes to the server. */
  register: (app: FastifyInstance, services: Services) => void;
}

export const modules: BackendModule[] = [
  {
    id: "business-hours",
    basePath: "/api/admin/business-hours",
    description: "Coverage windows (open hours), holidays, and which window each contract's service runs in, so TTO/TTR count working time.",
    register: registerBusinessHoursRoutes,
  },
  {
    id: "changes",
    basePath: "/api/changes",
    description: "Plans each change type needs before Plan / Implement, CAB decisions, changes awaiting the CAB (rules under /api/admin/change-rules).",
    register: registerChangeRoutes,
  },
  {
    id: "dashboard",
    basePath: "/api/dashboard",
    description: "Aggregated KPIs, trends and queues for the agent home screen.",
    register: registerDashboardRoutes,
  },
  {
    id: "data-import",
    basePath: "/api/admin/data-import",
    description: "Load people, organisations, teams and CIs from CSV/Excel (mapped, previewed, written through REST), and recurring feeds as iTop Data Synchro sources.",
    register: registerDataImportRoutes,
  },
  {
    id: "directory",
    basePath: "/api/directory",
    description: "Organisations, people and teams — onboarded before any ticket exists.",
    register: registerDirectoryRoutes,
  },
  {
    id: "dispatch",
    basePath: "/api/dispatch",
    description: "Tickets sent to a team before anyone takes them: the team's queue, Take it, and the assignment rules that route new tickets (under /api/admin/assignment-rules).",
    register: registerDispatchRoutes,
  },
  {
    id: "incidents",
    basePath: "/api/incidents",
    description: "Unplanned interruptions to a service.",
    register: registerIncidentRoutes,
  },
  {
    id: "mail-intake",
    basePath: "/api/admin/mail-intake",
    description: "Email to ticket: the support mailbox becomes incidents, replies land on theirs.",
    register: registerMailIntakeRoutes,
  },
  {
    id: "problems",
    basePath: "/api/problems",
    description: "Root-cause analysis, known errors raised from problems, recurring-incident trends.",
    register: registerProblemRoutes,
  },
  {
    id: "request-forms",
    basePath: "/api/request-forms",
    description: "The extra questions each catalogue item asks when a request is raised (edited under /api/admin/request-forms).",
    register: registerRequestFormRoutes,
  },
  {
    id: "sla",
    basePath: "/api/sla",
    description: "Open incidents and requests by SLA state: within target, at risk, breached.",
    register: registerSlaRoutes,
  },
];

/**
 * Two modules claiming the same prefix is a silent, order-dependent bug —
 * whichever registers last wins. Fail loudly at boot instead.
 */
export function assertNoDuplicatePaths(list: readonly BackendModule[] = modules): void {
  const seen = new Map<string, string>();
  for (const module of list) {
    const owner = seen.get(module.basePath);
    if (owner) {
      throw new Error(
        `Module "${module.id}" claims ${module.basePath}, already owned by "${owner}".`,
      );
    }
    seen.set(module.basePath, module.id);
  }
}
