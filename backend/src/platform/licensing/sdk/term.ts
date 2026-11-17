import type { LicenceEnvelope } from "./format.js";

/**
 * Where a licence is in its term on a given day. Pure date arithmetic on
 * calendar days in UTC; products turn this into their own states.
 */
export type TermPhase =
  | "not_yet_valid" // before valid_from
  | "active" //        inside its dates
  | "expiring_soon" // within `expiringSoonDays` of expires_at
  | "grace" //         after expires_at, within grace_days
  | "expired"; //      grace has ended

export interface TermStatus {
  phase: TermPhase;
  /** Days until expires_at (0 on the last day, negative after); null for perpetual. */
  daysLeft: number | null;
  /** In grace: days of grace left (0 on the last day). */
  graceDaysLeft: number | null;
  /** Perpetual licence past maintenance_until (no upgrade rights). */
  maintenanceLapsed: boolean;
}

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" of an instant, in UTC. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

export function addDays(day: string, days: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS));
}

/**
 * The licence's phase on `now`. `expires_at` and `maintenance_until` are the
 * last days of use, inclusive. An evaluation licence has no grace: it ends on
 * its last day (the Build Guide's "evaluation key, day 31").
 */
export function termStatus(licence: LicenceEnvelope, now: Date, expiringSoonDays = 30): TermStatus {
  const today = utcDay(now);
  const maintenanceLapsed =
    licence.licence_type === "perpetual" && licence.maintenance_until !== null && today > licence.maintenance_until;
  if (today < licence.valid_from) return { phase: "not_yet_valid", daysLeft: null, graceDaysLeft: null, maintenanceLapsed };
  if (licence.expires_at === null) return { phase: "active", daysLeft: null, graceDaysLeft: null, maintenanceLapsed };

  const daysLeft = daysBetween(today, licence.expires_at);
  if (daysLeft >= 0) {
    return { phase: daysLeft < expiringSoonDays ? "expiring_soon" : "active", daysLeft, graceDaysLeft: null, maintenanceLapsed };
  }
  const grace = licence.licence_type === "evaluation" ? 0 : licence.grace_days;
  const graceDaysLeft = grace + daysLeft; // daysLeft is negative here
  if (graceDaysLeft >= 0 && grace > 0) return { phase: "grace", daysLeft, graceDaysLeft, maintenanceLapsed };
  return { phase: "expired", daysLeft, graceDaysLeft: null, maintenanceLapsed };
}

/**
 * The clock check (LIC-12, LT-09): a current time more than `toleranceMs`
 * earlier than the latest time ever seen means the clock was moved back.
 * The caller then uses the high-water time, so the term is not extended.
 */
export function checkClock(now: Date, highWater: Date | undefined, toleranceMs = DAY_MS): { rolledBack: boolean; effectiveNow: Date } {
  if (!highWater || now.getTime() >= highWater.getTime() - toleranceMs) {
    return { rolledBack: false, effectiveNow: highWater && highWater > now ? highWater : now };
  }
  return { rolledBack: true, effectiveNow: highWater };
}

/**
 * Perpetual licences (LIC-11): a release built after `maintenance_until` is
 * refused; the release in use keeps running. `releaseDate` is YYYY-MM-DD.
 */
export function releaseAllowed(licence: LicenceEnvelope, releaseDate: string): boolean {
  if (licence.licence_type !== "perpetual" || licence.maintenance_until === null) return true;
  return releaseDate <= licence.maintenance_until;
}
