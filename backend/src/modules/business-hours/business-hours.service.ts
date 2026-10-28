import { AppError, badRequest, notFound } from "../../core/errors.js";
import type { ItopClient } from "../../itop/client.js";
import { normalizeObjects } from "../../itop/normalize.js";
import { str } from "../../shared/ticket-mapping.js";
import {
  WEEKDAYS,
  type AssignmentInput,
  type BusinessHours,
  type CalendarInput,
  type CoverageAssignment,
  type CoverageWindow,
  type CoverageWindowInput,
  type Holiday,
  type HolidayCalendar,
  type HolidayInput,
  type OpenInterval,
  type Weekday,
} from "./business-hours.types.js";
import { intervalProblems } from "./working-time.js";

/**
 * Business hours and holidays, kept in the classes of Combodo's "SLA
 * considering business hours" extension (combodo-sla-computation and
 * combodo-coverage-windows-computation; backend/README.md, "Business hours"):
 *
 *  - CoverageWindow, with its open hours as CoverageWindowInterval rows
 *    (weekday, start_time, end_time);
 *  - Holiday (name, date, calendar_id) and HolidayCalendar;
 *  - lnkCustomerContractToService.coveragewindow_id: the window a customer
 *    contract's service is covered in.
 *
 * With them installed iTop computes every TTO/TTR deadline in working time:
 * the window of the ticket's organisation's contract for its service, minus
 * every holiday (holidays_oql = SELECT Holiday). A ticket with no window
 * still counts 24x7. These classes are not in cmdb-schema.json, so this
 * service talks to iTop directly, and an iTop without the extension answers
 * `available: false`.
 */

const COMMENT = "Business hours via ARCUS";

const extensionMissing = () =>
  new AppError(
    "conflict",
    "This iTop has no business hours: install Combodo's combodo-sla-computation and " +
      "combodo-coverage-windows-computation modules (backend/README.md, \"Business hours\").",
    { details: { reason: "extension_missing" } },
  );

/**
 * iTop's answers without the modules (seen on the local iTop): a read says
 * "class 'CoverageWindow' is not valid" or "Unknown filter code - found
 * 'coveragewindow_id'", a create "Unknown class 'Holiday'", an update
 * "Unknown attribute coveragewindow_id".
 */
const isUnknownToItop = (error: unknown) =>
  error instanceof AppError &&
  /(Unknown class '|class ')(CoverageWindow|CoverageWindowInterval|Holiday|HolidayCalendar)'|Unknown (attribute|filter code)[^']*'coveragewindow_id'|Unknown attribute coveragewindow_id/i.test(
    error.message,
  );

type Row = { id: number; fields: Record<string, unknown> };

const isWeekday = (value: string): value is Weekday => (WEEKDAYS as readonly string[]).includes(value);

/** What the SLA dashboard needs to count working time. */
export interface WorkingCalendar {
  /** The open hours of the window covering a ticket, or null when it counts 24x7. */
  windowFor(orgId: string, serviceId: string): OpenInterval[] | null;
  holidays: ReadonlySet<string>;
}

export class BusinessHoursService {
  constructor(private readonly client: ItopClient) {}

  private async rows(className: string, fields: string, oql = `SELECT ${className}`, asService = false): Promise<Row[]> {
    const result = await this.client.call(
      "core/get",
      { class: className, key: oql, output_fields: fields },
      asService ? { asService: true } : {},
    );
    return normalizeObjects(result.objects).map((o) => ({ id: o.id, fields: o.fields }));
  }

  /** Every window, calendar, holiday and contract service, in one answer for the admin screen. */
  async overview(): Promise<BusinessHours> {
    let windows: Row[];
    try {
      windows = await this.rows("CoverageWindow", "name,description");
    } catch (error) {
      if (isUnknownToItop(error)) {
        return { available: false, coverageWindows: [], calendars: [], holidays: [], assignments: [] };
      }
      throw error;
    }
    const [intervals, calendars, holidays, links, contracts] = await Promise.all([
      this.rows("CoverageWindowInterval", "coverage_window_id,weekday,start_time,end_time"),
      this.rows("HolidayCalendar", "name"),
      this.rows("Holiday", "name,date,calendar_id,calendar_name"),
      this.rows(
        "lnkCustomerContractToService",
        "customercontract_id,customercontract_name,service_id,service_name,sla_id,sla_name,coveragewindow_id,coveragewindow_name",
      ),
      this.rows("CustomerContract", "name,organization_name"),
    ]);

    const customerOf = new Map(contracts.map((c) => [String(c.id), str(c.fields["organization_name"])]));
    const assignments: CoverageAssignment[] = links
      .map((l) => {
        const f = l.fields;
        const windowId = str(f["coveragewindow_id"]);
        return {
          id: String(l.id),
          contractId: str(f["customercontract_id"]),
          contractName: str(f["customercontract_name"]),
          customerName: customerOf.get(str(f["customercontract_id"])) ?? "",
          serviceId: str(f["service_id"]),
          serviceName: str(f["service_name"]),
          slaId: str(f["sla_id"]) === "0" ? "" : str(f["sla_id"]),
          slaName: str(f["sla_name"]),
          coverageWindowId: windowId === "0" ? "" : windowId,
          coverageWindowName: windowId === "0" ? "" : str(f["coveragewindow_name"]),
        };
      })
      .sort((a, b) => a.customerName.localeCompare(b.customerName) || a.contractName.localeCompare(b.contractName) || a.serviceName.localeCompare(b.serviceName));

    const coverageWindows: CoverageWindow[] = windows
      .map((w) => ({
        id: String(w.id),
        name: str(w.fields["name"]),
        description: str(w.fields["description"]),
        intervals: sortIntervals(
          intervals
            .filter((i) => str(i.fields["coverage_window_id"]) === String(w.id))
            .map(toInterval)
            .filter((i): i is OpenInterval => i !== null),
        ),
        usedBy: assignments.filter((a) => a.coverageWindowId === String(w.id)).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const holidayList: Holiday[] = holidays
      .map((h) => {
        const calendarId = str(h.fields["calendar_id"]);
        return {
          id: String(h.id),
          name: str(h.fields["name"]),
          date: str(h.fields["date"]).slice(0, 10),
          calendarId: calendarId === "0" ? "" : calendarId,
          calendarName: calendarId === "0" ? "" : str(h.fields["calendar_name"]),
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

    const calendarList: HolidayCalendar[] = calendars
      .map((c) => ({
        id: String(c.id),
        name: str(c.fields["name"]),
        holidayCount: holidayList.filter((h) => h.calendarId === String(c.id)).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { available: true, coverageWindows, calendars: calendarList, holidays: holidayList, assignments };
  }

  /* --------------------------------------------------------------------- *
   * Writes
   * --------------------------------------------------------------------- */

  private async write<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isUnknownToItop(error)) throw extensionMissing();
      throw error;
    }
  }

  private async exists(className: string, id: string): Promise<void> {
    const rows = await this.write(() => this.rows(className, "id", `SELECT ${className} WHERE id = ${Number(id)}`));
    if (rows.length === 0) throw notFound(`${className} ${id} was not found.`);
  }

  private static checkIntervals(intervals: OpenInterval[]): void {
    const problems = intervalProblems(intervals);
    if (problems.length) throw badRequest(`The open hours do not add up: ${problems.join(" ")}`, { problems });
  }

  /** The intervals as iTop's in-place link set; given whole, iTop replaces the set. */
  private static intervalSet(intervals: OpenInterval[]) {
    return sortIntervals(intervals).map((i) => ({ weekday: i.weekday, start_time: i.start, end_time: i.end }));
  }

  async createWindow(input: CoverageWindowInput): Promise<{ id: string }> {
    BusinessHoursService.checkIntervals(input.intervals);
    const result = await this.write(() =>
      this.client.call("core/create", {
        class: "CoverageWindow",
        fields: {
          name: input.name.trim(),
          description: input.description.trim(),
          interval_list: BusinessHoursService.intervalSet(input.intervals),
        },
        comment: COMMENT,
        output_fields: "id",
      }),
    );
    return { id: String(normalizeObjects(result.objects)[0]?.id ?? "") };
  }

  async updateWindow(id: string, input: CoverageWindowInput): Promise<void> {
    BusinessHoursService.checkIntervals(input.intervals);
    await this.exists("CoverageWindow", id);
    await this.write(() =>
      this.client.call("core/update", {
        class: "CoverageWindow",
        key: Number(id),
        fields: {
          name: input.name.trim(),
          description: input.description.trim(),
          interval_list: BusinessHoursService.intervalSet(input.intervals),
        },
        comment: COMMENT,
        output_fields: "id",
      }),
    );
  }

  /**
   * iTop deletes the contract-service links pointing at a window along with
   * it (DEL_AUTO), which would drop services from customer contracts. Those
   * links are moved to "no window" first; their tickets then count 24x7.
   */
  async deleteWindow(id: string): Promise<{ detached: number }> {
    await this.exists("CoverageWindow", id);
    const links = await this.rows(
      "lnkCustomerContractToService",
      "id",
      `SELECT lnkCustomerContractToService WHERE coveragewindow_id = ${Number(id)}`,
    );
    for (const link of links) {
      await this.client.call("core/update", {
        class: "lnkCustomerContractToService",
        key: link.id,
        fields: { coveragewindow_id: 0 },
        comment: COMMENT,
        output_fields: "id",
      });
    }
    await this.client.call("core/delete", { class: "CoverageWindow", key: Number(id), comment: COMMENT });
    return { detached: links.length };
  }

  async createCalendar(input: CalendarInput): Promise<{ id: string }> {
    const result = await this.write(() =>
      this.client.call("core/create", {
        class: "HolidayCalendar",
        fields: { name: input.name.trim() },
        comment: COMMENT,
        output_fields: "id",
      }),
    );
    return { id: String(normalizeObjects(result.objects)[0]?.id ?? "") };
  }

  async updateCalendar(id: string, input: CalendarInput): Promise<void> {
    await this.exists("HolidayCalendar", id);
    await this.client.call("core/update", {
      class: "HolidayCalendar",
      key: Number(id),
      fields: { name: input.name.trim() },
      comment: COMMENT,
      output_fields: "id",
    });
  }

  /** iTop deletes the calendar's holidays with it (DEL_AUTO). */
  async deleteCalendar(id: string): Promise<void> {
    await this.exists("HolidayCalendar", id);
    await this.client.call("core/delete", { class: "HolidayCalendar", key: Number(id), comment: COMMENT });
  }

  private async holidayFields(input: HolidayInput) {
    if (input.calendarId) await this.exists("HolidayCalendar", input.calendarId);
    return { name: input.name.trim(), date: input.date, calendar_id: input.calendarId ? Number(input.calendarId) : 0 };
  }

  async createHoliday(input: HolidayInput): Promise<{ id: string }> {
    const fields = await this.write(() => this.holidayFields(input));
    const result = await this.write(() =>
      this.client.call("core/create", { class: "Holiday", fields, comment: COMMENT, output_fields: "id" }),
    );
    return { id: String(normalizeObjects(result.objects)[0]?.id ?? "") };
  }

  async updateHoliday(id: string, input: HolidayInput): Promise<void> {
    await this.exists("Holiday", id);
    const fields = await this.holidayFields(input);
    await this.client.call("core/update", { class: "Holiday", key: Number(id), fields, comment: COMMENT, output_fields: "id" });
  }

  async deleteHoliday(id: string): Promise<void> {
    await this.exists("Holiday", id);
    await this.client.call("core/delete", { class: "Holiday", key: Number(id), comment: COMMENT });
  }

  /** Sets (or clears) the coverage window of one service on a customer contract. */
  async assign(linkId: string, input: AssignmentInput): Promise<void> {
    await this.exists("lnkCustomerContractToService", linkId);
    if (input.coverageWindowId) await this.exists("CoverageWindow", input.coverageWindowId);
    await this.write(() =>
      this.client.call("core/update", {
        class: "lnkCustomerContractToService",
        key: Number(linkId),
        fields: { coveragewindow_id: input.coverageWindowId ? Number(input.coverageWindowId) : 0 },
        comment: COMMENT,
        output_fields: "id",
      }),
    );
  }

  /* --------------------------------------------------------------------- *
   * For the SLA dashboard
   * --------------------------------------------------------------------- */

  /**
   * Windows and holidays as iTop applies them. Read as the service account:
   * it is configuration every agent's dashboard needs, not tenant data, and
   * agents' profiles may not read these classes. Null without the extension.
   */
  async workingCalendar(): Promise<WorkingCalendar | null> {
    let links: Row[];
    try {
      links = await this.rows(
        "lnkCustomerContractToService",
        "customercontract_id,service_id,coveragewindow_id",
        "SELECT lnkCustomerContractToService WHERE coveragewindow_id != 0",
        true,
      );
    } catch (error) {
      if (isUnknownToItop(error)) return null;
      throw error;
    }
    if (links.length === 0) return { windowFor: () => null, holidays: new Set() };

    const [contracts, intervals, holidays] = await Promise.all([
      this.rows("CustomerContract", "org_id", "SELECT CustomerContract", true),
      this.rows("CoverageWindowInterval", "coverage_window_id,weekday,start_time,end_time", "SELECT CoverageWindowInterval", true),
      this.rows("Holiday", "date", "SELECT Holiday", true),
    ]);
    const orgOf = new Map(contracts.map((c) => [String(c.id), str(c.fields["org_id"])]));
    const hoursOf = new Map<string, OpenInterval[]>();
    for (const row of intervals) {
      const interval = toInterval(row);
      if (!interval) continue;
      const windowId = str(row.fields["coverage_window_id"]);
      hoursOf.set(windowId, [...(hoursOf.get(windowId) ?? []), interval]);
    }
    // Like iTop's coverage_oql, the first matching window wins.
    const windowOf = new Map<string, string>();
    for (const link of [...links].sort((a, b) => a.id - b.id)) {
      const key = `${orgOf.get(str(link.fields["customercontract_id"])) ?? ""}|${str(link.fields["service_id"])}`;
      if (!windowOf.has(key)) windowOf.set(key, str(link.fields["coveragewindow_id"]));
    }
    return {
      windowFor: (orgId, serviceId) => {
        const windowId = windowOf.get(`${orgId}|${serviceId}`);
        return windowId ? (hoursOf.get(windowId) ?? []) : null;
      },
      holidays: new Set(holidays.map((h) => str(h.fields["date"]).slice(0, 10)).filter(Boolean)),
    };
  }
}

function toInterval(row: Row): OpenInterval | null {
  const weekday = str(row.fields["weekday"]);
  if (!isWeekday(weekday)) return null;
  return { weekday, start: str(row.fields["start_time"]), end: str(row.fields["end_time"]) };
}

function sortIntervals(intervals: OpenInterval[]): OpenInterval[] {
  return [...intervals].sort(
    (a, b) => WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) || a.start.localeCompare(b.start),
  );
}
