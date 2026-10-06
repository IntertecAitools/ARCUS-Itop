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
      // Credentials are never echoed with a wildcard origin -- the combination is
      // rejected by browsers, and this BFF authenticates to iTop itself anyway.
      if (allowOrigin !== "*") reply.header("Vary", "Origin");
    }

    if (request.method === "OPTIONS") {
      reply
        .header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
        .header("Access-Control-Allow-Headers", "Content-Type,Authorization")
        .header("Access-Control-Max-Age", "600")
        .code(204)
        .send();
      return;
    }

    done();
  });
}
