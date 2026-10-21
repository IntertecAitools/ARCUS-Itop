/**
 * Mock state that survives a page reload, the way a real server's would.
 *
 * MSW handlers run in the page, so module state resets on every full
 * navigation; sessionStorage keeps a write visible after it. It is per tab, so
 * parallel browser tests stay isolated from each other. A quota error or
 * disabled storage (Vitest's node server, a locked-down browser) falls back to
 * the in-memory value.
 */
const PREFIX = 'arcus.mock.';

export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (raw !== null) return JSON.parse(raw) as T;
  } catch {
    // No storage: the fallback serves this page.
  }
  return fallback;
}

export function writeStored(key: string, value: unknown) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Ignore: the in-memory copy still serves this page.
  }
}

/**
 * A switch the browser tests flip before the app loads
 * (`sessionStorage['arcus.mock.seeded'] = 'true'`), so a journey can start
 * from data while `npm run dev` keeps showing the empty instance.
 */
export const mockFlag = (name: string) => readStored<boolean>(name, false) === true;
