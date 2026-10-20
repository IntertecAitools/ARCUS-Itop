/**
 * iTop writes datetimes as wall-clock text ("2026-10-20 14:04:17") in its
 * own configured timezone (`timezone` in config-itop.php), with no offset.
 * A browser elsewhere would read that as its own local time and be hours
 * out ("4 hours ago" for something just now). This turns iTop's text into an
 * exact ISO instant, given iTop's timezone.
 */

/** iTop's own default when config-itop.php does not set `timezone`. */
export const DEFAULT_ITOP_TIMEZONE = "Europe/Paris";

const ITOP_DATETIME = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/** Offset of `timeZone` from UTC at `instant`, in minutes. */
function offsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - instant) / 60_000);
}

/** iTop's "YYYY-MM-DD HH:MM:SS" in `timeZone` to an ISO instant; "" when empty or unreadable. */
export function itopTimeToIso(text: string, timeZone: string): string {
  const m = ITOP_DATETIME.exec(text.trim());
  if (!m) return "";
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  // The offset depends on the instant itself (daylight saving): estimate it
  // at the wall time, then correct once with the offset at the result.
  let instant = wall - offsetMinutes(wall, timeZone) * 60_000;
  instant = wall - offsetMinutes(instant, timeZone) * 60_000;
  return new Date(instant).toISOString();
}

/** An instant as iTop's "YYYY-MM-DD HH:MM:SS" in `timeZone`, for writing dates iTop will read. */
export function toItopTime(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * An exact instant from a caller ("2026-10-20T08:34:00.000Z", or with an
 * offset) as iTop's text in `timeZone`; null when `text` is not one. A browser
 * sends instants, so what it writes or filters on lines up with iTop's clock.
 */
export function isoToItopTime(text: string, timeZone: string): string | null {
  const trimmed = text.trim();
  if (!ISO_INSTANT.test(trimmed)) return null;
  const instant = new Date(trimmed);
  return Number.isNaN(instant.getTime()) ? null : toItopTime(instant, timeZone);
}

/** A value iTop sent for a DateTime as an ISO instant; anything else unchanged. */
export function itopValueToIso(value: unknown, timeZone: string): unknown {
  if (typeof value !== "string" || value === "") return value;
  return itopTimeToIso(value, timeZone) || value;
}

/** The calendar day (YYYY-MM-DD) an instant falls on in `timeZone`. */
export function itopDay(instant: Date, timeZone: string): string {
  return toItopTime(instant, timeZone).slice(0, 10);
}

/** A YYYY-MM-DD day moved by `days` (calendar arithmetic, no time zone). */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** Day of the week of a YYYY-MM-DD day, 0 = Sunday. */
export function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** The parts of a class's schema that say which attributes hold datetimes. */
interface DatedClass {
  fields: Record<string, { type: string; widget: string } | undefined>;
}

/** A stopwatch's datetime parts (e.g. Incident.tto_escalation_deadline). */
const STOPWATCH_TIME = /_(started|laststart|stopped|deadline)$/;

/**
 * A record's fields as iTop returned them, with every DateTime attribute and
 * every case-log entry's date (and a stopwatch's deadlines) turned into an
 * ISO instant. Date-only
 * attributes (AttributeDate) have no time zone and stay YYYY-MM-DD.
 */
export function itopFieldsToIso(
  fields: Record<string, unknown>,
  info: DatedClass | undefined,
  timeZone: string,
): Record<string, unknown> {
  if (!info) return fields;
  let out: Record<string, unknown> | undefined;
  const set = (code: string, value: unknown) => {
    out ??= { ...fields };
    out[code] = value;
  };
  for (const [code, value] of Object.entries(fields)) {
    const field = info.fields[code];
    if (!field) continue;
    if (field.widget === "datetime" || (field.type === "SubItem" && STOPWATCH_TIME.test(code))) {
      const iso = itopValueToIso(value, timeZone);
      if (iso !== value) set(code, iso);
    } else if (field.type === "CaseLog") {
      const log = caseLogToIso(value, timeZone);
      if (log !== value) set(code, log);
    }
  }
  return out ?? fields;
}

/** A CaseLog value (`{ entries: [...] }`) with each entry's date as an ISO instant. */
export function caseLogToIso(value: unknown, timeZone: string): unknown {
  if (typeof value !== "object" || value === null) return value;
  const entries = (value as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return value;
  return {
    ...value,
    entries: entries.map((entry) => {
      if (typeof entry !== "object" || entry === null) return entry;
      const e = entry as Record<string, unknown>;
      return "date" in e ? { ...e, date: itopValueToIso(e["date"], timeZone) } : e;
    }),
  };
}
