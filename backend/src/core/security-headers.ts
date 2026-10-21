import type { FastifyInstance } from "fastify";

/**
 * Headers on every BFF response. The API answers JSON and file downloads,
 * never a page, so it can be strict: nothing it returns may run script, load
 * anything or be framed, and nothing is cached (responses are per user). In
 * production nginx adds the page's own headers in front of this; these keep
 * the API safe when it is reached directly, and on an attachment opened in a
 * tab.
 */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook("onSend", (_request, reply, payload, done) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; sandbox");
    reply.header("Cross-Origin-Resource-Policy", "same-site");
    if (!reply.hasHeader("Cache-Control")) reply.header("Cache-Control", "no-store");
    done(null, payload);
  });
}
