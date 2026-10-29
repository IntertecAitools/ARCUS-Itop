import type { HandledClass } from '../types';

/** 95 → "1h 35m", 30 → "30m", 120 → "2h". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * What someone types for time spent: "45", "45m", "1h", "1h 30m", "1:30",
 * "1.5h". Undefined when it is none of those or not a positive amount.
 */
export function parseDuration(text: string): number | undefined {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  let minutes: number | undefined;
  let m: RegExpExecArray | null;
  if ((m = /^(\d+):([0-5]\d)$/.exec(t))) minutes = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = /^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*m?)?$/.exec(t))) minutes = Math.round(Number(m[1]) * 60) + Number(m[2] ?? 0);
  else if ((m = /^(\d+)\s*m?$/.exec(t))) minutes = Number(m[1]);
  return minutes !== undefined && minutes > 0 ? minutes : undefined;
}

/** Where a ticket's own screen is. */
export function ticketPath(cls: HandledClass, id: number | string): string {
  return cls === 'Incident' ? `/incidents/${id}` : `/records/UserRequest/${id}`;
}

/**
 * A ticket typed by its ref ("I-000123", "r-45") or number. iTop's refs are
 * the id with a class letter, so the ref names the ticket outright; a bare
 * number is taken to be of `fallback`'s class.
 */
export function parseTicketRef(text: string, fallback: HandledClass): { class: HandledClass; id: number } | undefined {
  const m = /^\s*(?:([ir])\s*-?\s*)?0*(\d+)\s*$/i.exec(text);
  if (!m || Number(m[2]) <= 0) return undefined;
  const letter = m[1]?.toUpperCase();
  return { class: letter === 'I' ? 'Incident' : letter === 'R' ? 'UserRequest' : fallback, id: Number(m[2]) };
}

/** Today in the viewer's calendar, `YYYY-MM-DD`. */
export function todayInput(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
