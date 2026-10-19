import { describe, expect, it } from 'vitest';
import { safeNext } from './LoginPage';

describe('safeNext', () => {
  it('returns to a page inside the app', () => {
    expect(safeNext('/records/Server?view=x')).toBe('/records/Server?view=x');
  });
  it('never sends a signed-in user to another site', () => {
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('//evil.example/path')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});
