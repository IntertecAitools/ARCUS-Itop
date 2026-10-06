/**
 * Mutable mock database. In the browser it is persisted to localStorage so
 * created problems survive page reloads (and Playwright navigations).
 */
import { buildSeed, type MockDb } from './seed';

const STORAGE_KEY = 'arcus-mock-db-v1';

function canPersist(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function load(): MockDb | null {
  if (!canPersist()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MockDb) : null;
  } catch {
    return null;
  }
}

let db: MockDb = load() ?? buildSeed();

export function getDb(): MockDb {
  return db;
}

/** Call after every mutation */
export function saveDb(): void {
  if (!canPersist()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // storage full (large attachments): keep working in memory
  }
}

/** Back to the seed (tests, or `resetMockDb()` from the browser console) */
export function resetDb(now?: number): void {
  db = buildSeed(now);
  if (canPersist()) window.localStorage.removeItem(STORAGE_KEY);
}

if (typeof window !== 'undefined') {
  (window as unknown as { resetMockDb: () => void }).resetMockDb = () => {
    resetDb();
    window.location.reload();
  };
}
