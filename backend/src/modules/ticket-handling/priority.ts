/**
 * iTop's priority matrix, and how an override is expressed in it.
 *
 * Incident and UserRequest compute `priority` from impact × urgency in
 * ComputeValues (itop-incident-mgmt-itil / itop-request-mgmt-itil), on every
 * write: a priority written directly is silently put back. So an override
 * changes the inputs instead, the smallest change that makes iTop compute the
 * wanted priority. The ticket then really has that priority in iTop: its
 * SLA, queues, lists and reports all follow it.
 */

/** priority[impact][urgency], as iTop's ComputePriority has it. */
export const PRIORITY_MATRIX: Record<number, Record<number, number>> = {
  1: { 1: 1, 2: 1, 3: 2, 4: 4 },
  2: { 1: 1, 2: 2, 3: 3, 4: 4 },
  3: { 1: 2, 2: 3, 3: 3, 4: 4 },
};

export const computePriority = (impact: number, urgency: number): number | undefined =>
  PRIORITY_MATRIX[impact]?.[urgency];

export interface ImpactUrgency {
  impact: number;
  urgency: number;
}

/**
 * The impact and urgency closest to `current` that give `priority`: urgency
 * moves first (it is the "how soon" the override is really about), impact
 * only when no urgency reaches the priority at the current impact (impact 1
 * has no P3, impact 3 no P1). Undefined when nothing gives it.
 */
export function inputsFor(priority: number, current: ImpactUrgency): ImpactUrgency | undefined {
  let best: { pair: ImpactUrgency; cost: number } | undefined;
  for (const [impactKey, row] of Object.entries(PRIORITY_MATRIX)) {
    const impact = Number(impactKey);
    for (const [urgencyKey, p] of Object.entries(row)) {
      if (p !== priority) continue;
      const urgency = Number(urgencyKey);
      const cost = Math.abs(impact - current.impact) * 10 + Math.abs(urgency - current.urgency);
      if (!best || cost < best.cost) best = { pair: { impact, urgency }, cost };
    }
  }
  return best?.pair;
}
