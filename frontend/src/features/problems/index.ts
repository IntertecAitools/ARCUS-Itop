// problems: public API. Other features may import ONLY from this file.
export { ProblemTrendsPage } from './pages/ProblemTrendsPage';
// The "Root cause" tab of a Problem in the generic record screen.
export { ProblemAnalysisPanel } from './components/ProblemAnalysisPanel';
export type {
  AnalysisSaveInput,
  CandidateCause,
  KnownErrorCreated,
  RcaDraft,
  RcaEvidence,
  ProblemAnalysis,
  ProblemTrends,
  RootCauseAnalysis,
  TrendGroup,
  TrendGroupBy,
  TrendPeriod,
} from './types';
