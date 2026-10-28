/**
 * business-hours: public API.
 *
 * The ONLY file other modules and the app shell may import from.
 */
export { registerBusinessHoursRoutes } from "./business-hours.routes.js";
export { BusinessHoursService, type WorkingCalendar } from "./business-hours.service.js";
export { workingSeconds } from "./working-time.js";
export type {
  AssignmentInput,
  BusinessHours,
  CalendarInput,
  CoverageAssignment,
  CoverageWindow,
  CoverageWindowInput,
  Holiday,
  HolidayCalendar,
  HolidayInput,
  OpenInterval,
  Weekday,
} from "./business-hours.types.js";
