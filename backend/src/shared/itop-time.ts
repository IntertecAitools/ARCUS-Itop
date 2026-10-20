/**
 * iTop writes datetimes as wall-clock text ("2026-10-20 14:04:17") in its
 * own configured timezone (`timezone` in config-itop.php), with no offset.
 * A browser elsewhere would read that as its own local time and be hours
 * out ("4 hours ago" for something just now). This turns iTop's text into an
 * exact ISO instant, given iTop's timezone.
 */

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
