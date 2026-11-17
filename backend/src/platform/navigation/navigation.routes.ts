import type { FastifyInstance } from "fastify";

import type { Services } from "../../services.js";
import { currentTenant } from "../../core/request-context.js";

export function registerNavigationRoutes(app: FastifyInstance, services: Services): void {
  const { navigation, licensing, schema } = services;

  /**
   * With LICENSING=enforce, menu entries for record classes the edition does
   * not include are left out (Problem, Change… on Essentials), and a group
   * left empty goes with them.
   */
  const editionGroups = async () => {
    const features = await licensing?.enforcedFeatures(currentTenant()?.id);
    if (!features || !licensing) return navigation.groups;
    return navigation.groups
      .map((g) => ({
        ...g,
        entries: g.entries.filter((e) => {
          const feature = e.class ? licensing.featureOfClass(schema.lineage(e.class)) : undefined;
          return !feature || features.has(feature);
        }),
      }))
      .filter((g) => g.entries.length > 0);
  };

  /**
   * iTop's navigation, as the frontend should render it.
   *
   * Note what is absent: the OQL behind each filtered view. The frontend asks
   * for a view by id (`/api/objects/Incident?view=Incident:OpenIncidents`) and
   * the BFF resolves it, so no screen ever holds an iTop query.
   */
  app.get("/api/meta/navigation", async () => ({
    groups: await editionGroups(),
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
