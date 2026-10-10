import type { FastifyInstance } from "fastify";

import type { Services } from "../../services.js";

export function registerNavigationRoutes(app: FastifyInstance, services: Services): void {
  const { navigation } = services;

  /**
   * iTop's navigation, as the frontend should render it.
   *
   * Note what is absent: the OQL behind each filtered view. The frontend asks
   * for a view by id (`/api/objects/Incident?view=Incident:OpenIncidents`) and
   * the BFF resolves it, so no screen ever holds an iTop query.
   */
  app.get("/api/meta/navigation", async () => ({
    groups: navigation.groups,
    classLabels: navigation.classLabels,
    /**
     * Menu nodes iTop has that we do not render, each with a reason. Published
     * rather than hidden: "replicate iTop" is a claim, and this is the honest
     * accounting of where the replication stops.
     */
    excluded: navigation.excluded,
    counts: {
      groups: navigation.groups.length,
      entries: navigation.entryCount,
      views: navigation.viewIds.length,
      excluded: navigation.excluded.length,
    },
  }));
}
