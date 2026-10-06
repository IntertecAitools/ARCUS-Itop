import type { FastifyInstance } from "fastify";

/**
 * Minimal CORS, hand-rolled to keep the dependency surface small.
 *
 * Note that iTop's own rest.php already sends `Access-Control-Allow-Origin: *`,
 * but browsers never see that header: they talk to this BFF, not to iTop.
 */
export function registerCors(app: FastifyInstance, allowed: string[] | "*"): void {
  const isAllowed = (origin: string | undefined): string | null => {
    if (allowed === "*") return "*";
    if (!origin) return null;
    const normalized = origin.replace(/\/+$/, "");
    return allowed.includes(normalized) ? normalized : null;
  };

  app.addHook("onRequest", (request, reply, done) => {
    const origin = request.headers.origin;
    const allowOrigin = isAllowed(origin);

    if (allowOrigin) {
      reply.header("Access-Control-Allow-Origin", allowOrigin);
      if (allowOrigin !== "*") {
        reply.header("Vary", "Origin");
        // The frontend fetches with `credentials: "include"`, so the browser
        // discards any response that does not say this -- even one that is
        // otherwise a valid 200. Only ever sent for an explicitly allow-listed
        // origin: pairing credentials with a wildcard is rejected by browsers
        // and would let any site read authenticated responses.
        reply.header("Access-Control-Allow-Credentials", "true");
      }
    }

    if (request.method === "OPTIONS") {
      reply
        .header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
        .header("Access-Control-Allow-Headers", "Content-Type,Authorization")
        .header("Access-Control-Max-Age", "600")
        .code(204)
        .send();
      return;
    }

    done();
  });
}
