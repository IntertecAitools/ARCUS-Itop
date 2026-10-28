// sla: business-hours types. The same JSON as backend/src/modules/business-hours/business-hours.types.ts.

export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export const WEEKDAYS: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/** One stretch of open hours: 'HH:MM' to 'HH:MM' (end may be '24:00'). */
export interface OpenInterval {
  weekday: Weekday;
  start: string;
  end: string;
}

export interface CoverageWindow {
  id: string;
  name: string;
  description: string;
  intervals: OpenInterval[];
  /** Contract services whose TTO/TTR count in this window. */
  usedBy: number;
}

export interface HolidayCalendar {
  id: string;
  name: string;
  holidayCount: number;
}

export interface Holiday {
  id: string;
  name: string;
  /** YYYY-MM-DD. */
  date: string;
  /** '' when in no calendar. */
  calendarId: string;
  calendarName: string;
}

/** A service on a customer contract: which SLA and coverage window apply to its tickets. */
export interface CoverageAssignment {
  /** The lnkCustomerContractToService row. */
  id: string;
  contractId: string;
  contractName: string;
  customerName: string;
  serviceId: string;
  serviceName: string;
  slaId: string;
  slaName: string;
  /** '' = no window: TTO/TTR count around the clock. */
  coverageWindowId: string;
  coverageWindowName: string;
}

export interface BusinessHours {
  /** False when iTop lacks Combodo's business-hours modules: nothing else is filled. */
  available: boolean;
  coverageWindows: CoverageWindow[];
  calendars: HolidayCalendar[];
  holidays: Holiday[];
  assignments: CoverageAssignment[];
}

export interface CoverageWindowInput {
  name: string;
  description: string;
  intervals: OpenInterval[];
}

export interface CalendarInput {
  name: string;
}

export interface HolidayInput {
  name: string;
  date: string;
  /** '' for none. */
  calendarId: string;
}

export interface AssignmentInput {
  /** '' removes the window. */
  coverageWindowId: string;
}
