import type { BadgeTone } from '@/components/ui';
import type { CabDecisionValue, ChangeType, PlanKind, PlanRequirement } from '../types';

export const PLAN_KINDS: PlanKind[] = ['implementation', 'rollback', 'test'];
export const CHANGE_TYPES: ChangeType[] = ['routine', 'normal', 'emergency'];

export const PLAN_LABEL: Record<PlanKind, string> = {
  implementation: 'Implementation plan',
  rollback: 'Rollback plan',
  test: 'Test plan',
};

export const PLAN_HINT: Record<PlanKind, string> = {
  implementation: 'The steps that carry out the change, in order, with who does what.',
  rollback: 'How to put things back if the change fails (iTop’s fallback plan).',
  test: 'How the change is verified once it is in.',
};

export const TYPE_LABEL: Record<ChangeType, string> = {
  routine: 'Routine',
  normal: 'Normal',
  emergency: 'Emergency',
};

export const REQUIREMENT_LABEL: Record<PlanRequirement, string> = {
  plan: 'Required to plan',
  implement: 'Required to implement',
  optional: 'Optional',
};

export const DECISION_LABEL: Record<CabDecisionValue, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  deferred: 'Deferred',
};

export const DECISION_TONE: Record<CabDecisionValue, BadgeTone> = {
  approved: 'good',
  rejected: 'critical',
  deferred: 'warning',
};
