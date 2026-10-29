/**
 * problems: public API.
 *
 * The ONLY file other modules and the app shell may import from.
 */
export { registerProblemRoutes } from "./problems.routes.js";
export { ProblemsService } from "./problems.service.js";
export { RcaService } from "./rca.service.js";
export { RcaEvidenceService } from "./rca-evidence.js";
export { AnthropicRcaModel, type RcaModel } from "./rca-ai.js";
export type {
  AnalysisSaveInput,
  CandidateCause,
  RcaDraft,
  RcaEvidence,
  CreateKnownErrorInput,
  KnownErrorCreated,
  KnownErrorSummary,
  ProblemAnalysis,
  ProblemTrends,
  RootCauseAnalysis,
  TrendBucket,
  TrendGroup,
  TrendGroupBy,
  TrendPeriod,
  TrendQuery,
} from "./problems.types.js";
