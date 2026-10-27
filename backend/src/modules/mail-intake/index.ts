/**
 * mail-intake: public API.
 *
 * The ONLY file other modules and the app shell may import from.
 */
export { registerMailIntakeRoutes } from "./mail-intake.routes.js";
export { MailIntakeService } from "./mail-intake.service.js";
export { createMailSource, ImapSource, MailpitSource } from "./sources.js";
export type {
  InboundMail,
  IntakeOutcome,
  IntakeRun,
  IntakeStatus,
  MailSource,
} from "./mail-intake.types.js";
