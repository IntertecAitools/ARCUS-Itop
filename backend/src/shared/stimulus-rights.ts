import { AppError } from "../core/errors.js";
import { currentCaller, type Caller } from "../core/request-context.js";

/**
 * Who may apply each lifecycle action (iTop "stimulus" grants).
 *
 * iTop's REST API checks only that the caller may modify the class, never
 * these per-action grants (core/restservices: apply_stimulus asks
 * UserRights::IsActionAllowed for UR_ACTION_MODIFY, not
 * IsStimulusAllowed), so the BFF applies them, for every screen and the
 * bulk actions alike.
 *
 * Transcribed from iTop's own profiles: datamodels/2.x/itop-profiles-itil
 * (and the Portal user's incident grants from itop-incident-mgmt-itil).
 * A group holds its classes AND their subclasses, as iTop compiles it.
 * Administrators may do everything.
 */

/** iTop's class groups that carry stimulus grants, and the classes in each. */
const GROUP_CLASSES: Record<string, string[]> = {
  Incident: ["Incident"],
  Problem: ["Problem"],
  Change: ["Change", "RoutineChange", "NormalChange", "EmergencyChange"],
  UserRequest: ["UserRequest"],
  Ticketing: ["lnkFunctionalCIToTicket", "lnkContactToTicket", "WorkOrder", "Attachment"],
  NormalChange: ["NormalChange"],
  EmergencyChange: ["EmergencyChange"],
  RoutineChange: ["RoutineChange"],
};

const CHANGE_IMPLEMENTOR = ["ev_plan", "ev_replan", "ev_implement", "ev_monitor"];

/** profile -> group -> the stimuli it allows there. */
const STIMULUS_GRANTS: Record<string, Record<string, string[]>> = {
  SuperUser: {
    Ticketing: ["ev_close"],
    UserRequest: [
      "ev_approve", "ev_assign", "ev_close", "ev_dispatch", "ev_pending",
      "ev_reassign", "ev_reject", "ev_reopen", "ev_resolve",
    ],
    Incident: ["ev_assign", "ev_dispatch", "ev_reassign", "ev_resolve", "ev_reopen", "ev_close", "ev_pending"],
    Change: [
      "ev_approve", "ev_assign", "ev_finish", "ev_plan", "ev_reject", "ev_reopen",
      "ev_validate", "ev_notapprove", "ev_replan", "ev_implement", "ev_monitor",
    ],
    Problem: ["ev_reassign", "ev_assign", "ev_resolve", "ev_close"],
  },
  // ev_dispatch for these two comes from the arcus-ticket-dispatch extension.
  "Service Desk Agent": {
    Ticketing: ["ev_close"],
    Incident: ["ev_assign", "ev_dispatch"],
    UserRequest: ["ev_assign", "ev_dispatch"],
  },
  "Support Agent": {
    Ticketing: ["ev_close"],
    Incident: ["ev_assign", "ev_dispatch", "ev_reassign", "ev_resolve", "ev_close", "ev_pending"],
    UserRequest: [
      "ev_assign", "ev_dispatch", "ev_reassign", "ev_resolve", "ev_close", "ev_pending", "ev_wait_for_approval",
    ],
  },
  "Problem Manager": {
    Ticketing: ["ev_close"],
    Problem: ["ev_assign", "ev_reassign", "ev_resolve", "ev_close"],
  },
  "Change Implementor": {
    Change: ["ev_assign", "ev_plan", "ev_reopen", "ev_finish"],
    Ticketing: ["ev_close"],
    NormalChange: CHANGE_IMPLEMENTOR,
    EmergencyChange: CHANGE_IMPLEMENTOR,
    RoutineChange: CHANGE_IMPLEMENTOR,
  },
  "Change Supervisor": {
    Change: ["ev_assign", "ev_reopen", "ev_finish"],
    Ticketing: ["ev_close"],
    NormalChange: ["ev_validate", "ev_reject", "ev_assign", "ev_reopen", "ev_finish"],
    EmergencyChange: ["ev_assign", "ev_reopen", "ev_finish"],
    RoutineChange: ["ev_assign", "ev_reopen", "ev_finish"],
  },
  "Change Approver": {
    Change: ["ev_approve", "ev_reject"],
    Ticketing: ["ev_close"],
    NormalChange: ["ev_approve", "ev_notapprove"],
    EmergencyChange: ["ev_approve", "ev_notapprove"],
  },
  "Portal user": {
    UserRequest: ["ev_close", "ev_reopen"],
    Incident: ["ev_close", "ev_reopen"],
  },
};

/** The groups a class belongs to: its own and those of its ancestors. */
function groupsOf(classes: readonly string[]): string[] {
  return Object.entries(GROUP_CLASSES)
    .filter(([, members]) => members.some((c) => classes.includes(c)))
    .map(([group]) => group);
}

function profileAllows(profile: string, groups: string[], stimulus: string): boolean {
  const grants = STIMULUS_GRANTS[profile];
  return !!grants && groups.some((g) => grants[g]?.includes(stimulus));
}

/**
 * Whether the caller may apply `stimulus` on a record of the class whose
 * chain is `classes` (the record's own class first, then its ancestors).
 * Without sign-in (development) the BFF acts as its own administrator.
 */
export function mayApplyStimulus(
  classes: readonly string[],
  stimulus: string,
  caller: Caller | undefined = currentCaller(),
): boolean {
  if (!caller || caller.isAdmin) return true;
  const groups = groupsOf(classes);
  return caller.profiles.some((p) => profileAllows(p, groups, stimulus));
}

/** Of `stimuli`, the ones the caller may apply on that class. */
export function allowedStimuli(
  classes: readonly string[],
  stimuli: readonly string[],
  caller: Caller | undefined = currentCaller(),
): string[] {
  return stimuli.filter((s) => mayApplyStimulus(classes, s, caller));
}

/** The profiles that grant the action, for the refusal message. SuperUser goes unsaid when others do. */
export function profilesGranting(classes: readonly string[], stimulus: string): string[] {
  const groups = groupsOf(classes);
  const all = Object.keys(STIMULUS_GRANTS).filter((p) => profileAllows(p, groups, stimulus));
  const named = all.filter((p) => p !== "SuperUser");
  return named.length > 0 ? named.sort() : all;
}

/** "A", "A or B", "A, B or C". */
function orList(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

/**
 * Refuses (403) an action the caller's profiles do not grant on the class.
 * `what` names the record in the message ("normal change", "incident").
 */
export function assertMayApplyStimulus(classes: readonly string[], stimulus: string, what: string): void {
  if (mayApplyStimulus(classes, stimulus)) return;
  const needs = profilesGranting(classes, stimulus);
  throw new AppError(
    "forbidden",
    `Your profiles do not allow this action on ${/^[aeiou]/i.test(what) ? "an" : "a"} ${what}` +
      (needs.length > 0 ? ` (it needs ${orList(needs)}).` : " (only an administrator may apply it)."),
    { details: { reason: "profile_not_allowed", stimulus } },
  );
}
