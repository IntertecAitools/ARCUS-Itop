import { isModuleRegistered } from '@/config/modules';

/**
 * Classes that have a screen of their own, richer than the generic record
 * page. The sidebar's iTop menus and lists all link into `/records/<class>`;
 * these send those links on to the dedicated screen, so a feature built there
 * (an incident's on-hold date, its major-incident panel) is never out of reach.
 */
const DEDICATED: Record<string, string> = {
  Incident: '/incidents',
};

/** The dedicated screen for one record (`id`) or its create form (`'new'`), if any. */
export function dedicatedRecordPath(className: string, id: string): string | null {
  const base = DEDICATED[className];
  if (!base || !id || !isModuleRegistered(base)) return null;
  return `${base}/${encodeURIComponent(id)}`;
}
