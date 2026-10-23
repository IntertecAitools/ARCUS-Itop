import { buildApp } from "./app.js";
import { loadConfig } from "./config/env.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { app, services } = buildApp(config);

  // Surface schema problems once at boot rather than per request.
  if (services.schema.diagnostics.length > 0) {
    app.log.warn(
      { count: services.schema.diagnostics.length },
      "CMDB schema loaded with corrections; see GET /api/meta/diagnostics",
    );
  }
  app.log.info(
    {
      classes: services.schema.classNames.length,
      itop: config.itop.baseUrl,
      restVersion: config.itop.version,
    },
    "CMDB schema loaded",
  );

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "Shutting down");
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, "Error during shutdown");
      process.exit(1);
    }
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void shutdown(signal));
  }

  // With SESSION_STORE=mysql, a database that cannot be reached is a reason
  // not to start: every request would fail later instead.
  await services.sessions.ready();
  await services.mfa.ready();
  await services.signInAudit.ready();
  app.log.info({ store: config.auth.sessionStore.kind }, "Session store ready");
  const policy = config.auth.signIn;
  app.log.info(
    {
      mfaRequired: policy?.mfaRequired,
      passwordSignIn: policy?.passwordSignIn,
      breakGlassAccounts: policy?.breakGlassLogins.length ?? 0,
      sso: policy?.sso ? { issuer: policy.sso.issuer, mfa: policy.sso.mfa } : "off",
    },
    "Sign-in policy",
  );

  await app.listen({ host: config.server.host, port: config.server.port });
}

main().catch((error: unknown) => {
  // The logger may not exist yet (bad config, missing schema file), so this
  // deliberately uses console and a non-zero exit.
  console.error(`intertec-backend failed to start: ${(error as Error).message}`);
  if (process.env["LOG_LEVEL"] === "debug") console.error(error);
  process.exit(1);
});
