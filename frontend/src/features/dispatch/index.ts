// dispatch: public API. Other features may import ONLY from this file.
export { TeamQueuePage } from './pages/TeamQueuePage';
export { AssignmentRulesPage } from './pages/AssignmentRulesPage';
// "Take it" on a ticket's own screen (incidents, requests).
export { TakeItButton } from './components/TakeItButton';
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
} from './types';
