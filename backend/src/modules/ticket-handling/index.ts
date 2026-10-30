/**
 * ticket-handling: public API.
 *
 * The ONLY file other modules and the app shell may import from.
 */
export { registerTicketHandlingRoutes } from "./ticket-handling.routes.js";
export { TicketHandlingService, parseCancelled, parseDuplicateRef, parentField } from "./ticket-handling.service.js";
export { DraftsService } from "./drafts.service.js";
export {
  MemoryTicketHandlingStore,
  MySqlTicketHandlingStore,
  type TicketHandlingStore,
} from "./ticket-handling.store.js";
export { MemoryDraftStore, MySqlDraftStore, type DraftStore } from "./drafts.store.js";
export { computePriority, inputsFor } from "./priority.js";
export { titleSimilarity } from "./similarity.js";
export type * from "./ticket-handling.types.js";
