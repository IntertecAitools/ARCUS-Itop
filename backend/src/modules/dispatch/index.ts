/**
 * dispatch: public API.
 *
 * The ONLY file other modules and the app shell may import from.
 */
export { registerDispatchRoutes } from "./dispatch.routes.js";
export { DispatchService, dispatchMissing } from "./dispatch.service.js";
export {
  matchRule,
  MemoryAssignmentRuleStore,
  MySqlAssignmentRuleStore,
  type AssignmentRuleStore,
} from "./assignment-rules.js";
export type {
  AssignmentRule,
  AssignmentRules,
  AssignmentRulesDto,
  RoutingFacts,
  RuleTestResult,
  TakenTicket,
  TeamQueue,
  TeamQueueItem,
  TicketType,
} from "./dispatch.types.js";
