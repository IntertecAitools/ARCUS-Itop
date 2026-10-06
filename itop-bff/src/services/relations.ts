import { badRequest } from "../errors.js";
import type { ItopClient } from "../itop/client.js";
import { normalizeObjects } from "../itop/normalize.js";
import type { CmdbSchema } from "../schema/load.js";

/**
 * Relation names shipped by the iTop datamodel for impact analysis.
 * "depends on" is accepted for backwards compatibility: rest.php rewrites it to
 * impacts/up and reverses the edges (restservices.class.inc.php:665).
 */
export const KNOWN_RELATIONS = ["impacts", "depends on"] as const;

export type Direction = "up" | "down";

export interface GraphNode {
  key: string;
  class: string;
  id: number;
  label: string;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface RelationGraph {
  root: { class: string; id: number };
  relation: string;
  direction: Direction;
  depth: number;
  redundancy: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
  message: string;
}

export interface RelationQuery {
  relation?: string;
  direction?: Direction;
  depth?: number;
  redundancy?: boolean;
}

const MAX_DEPTH = 20; // matches MAX_RECURSION_DEPTH in restservices.class.inc.php

export class RelationsService {
  constructor(
    private readonly client: ItopClient,
    private readonly schema: CmdbSchema,
  ) {}

  async graph(className: string, id: number, query: RelationQuery): Promise<RelationGraph> {
    const info = this.schema.require(className);

    const relation = (query.relation ?? "impacts").trim();
    if (!(KNOWN_RELATIONS as readonly string[]).includes(relation)) {
      throw badRequest(
        `Unknown relation "${relation}". The datamodel defines: ${KNOWN_RELATIONS.join(", ")}.`,
        { allowed: KNOWN_RELATIONS },
      );
    }

    const direction: Direction = query.direction === "up" ? "up" : "down";
    const depth = query.depth ?? MAX_DEPTH;
    if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH) {
      throw badRequest(`depth must be an integer between 1 and ${MAX_DEPTH}.`);
    }
    const redundancy = query.redundancy === true;

    const params: Record<string, unknown> = {
      class: info.name,
      key: id,
      relation,
      depth,
      redundancy,
    };
    // "depends on" has legacy direction handling in rest.php: passing an explicit
    // direction suppresses the rewrite to impacts/up, which changes the result.
    // Only send it when the caller is not relying on that legacy path.
    if (relation !== "depends on") {
      params["direction"] = direction;
    }

    const result = await this.client.call("core/get_related", params);

    const nodes: GraphNode[] = normalizeObjects(result.objects).map((flat) => {
      const friendly = flat.fields["friendlyname"];
      return {
        key: `${flat.class}::${flat.id}`,
        class: flat.class,
        id: flat.id,
        label:
          typeof friendly === "string" && friendly !== ""
            ? friendly
            : `${flat.class}::${flat.id}`,
      };
    });

    const edges: GraphEdge[] = [];
    for (const [from, targets] of Object.entries(result.relations ?? {})) {
      for (const target of targets ?? []) {
        if (target?.key) edges.push({ from, to: target.key });
      }
    }

    return {
      root: { class: info.name, id },
      relation,
      direction,
      depth,
      redundancy,
      nodes,
      edges,
      // "Nothing found" is a normal answer here, not an error.
      message: result.message ?? "",
    };
  }
}
