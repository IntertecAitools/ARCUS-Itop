/**
 * auto-close: public API.
 *
 * The ONLY file other modules and the app shell may import from.
 */
export { registerAutoCloseRoutes } from "./auto-close.routes.js";
export {
  AutoCloseService,
  completeSettings,
  DEFAULT_AUTO_CLOSE,
  type AutoCloseScope,
} from "./auto-close.service.js";
export type {
  AutoCloseClass,
  AutoCloseDto,
  AutoCloseOutcome,
  AutoCloseRun,
  AutoCloseSettings,
} from "./auto-close.types.js";
