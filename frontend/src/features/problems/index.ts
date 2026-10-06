// Public API of the problems feature. Import only from '@/features/problems'.
export type * from './types';
export {
  FIELD_RULES,
  PRIORITY_MATRIX,
  PROBLEM_STATUSES,
  STIMULUS_FIELDS,
  TRANSITIONS,
  allowedTransitions,
  fieldMode,
  parseProblemFilters,
  previewPriority,
  problemCreateSchema,
  problemEditSchema,
  serializeProblemFilters,
  toProblemListQuery,
  transitionSchema,
} from './schemas';
export { useProblem, useProblemStats, useProblems } from './api/problems';
export { ProblemPriorityBadge, ProblemStatusPill, PriorityPreview } from './components/ProblemBadges';
export { CreateMenuButton } from './components/CreateMenuButton';
// KPI widgets, reused by features/dashboard
export {
  MyProblemsCard,
  PriorityDonutCard,
  ProblemKpis,
  ProblemsTrendCard,
  RecentProblemsCard,
  TopServicesCard,
} from './components/DashboardWidgets';
export { ProblemsDashboardPage } from './pages/ProblemsDashboardPage';
export { ProblemListPage } from './pages/ProblemListPage';
export { ProblemNewPage } from './pages/ProblemNewPage';
export { ProblemDetailPage } from './pages/ProblemDetailPage';
