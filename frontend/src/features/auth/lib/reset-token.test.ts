import { describe, expect, it } from 'vitest';
import { newPasswordProblem, readResetToken } from './reset-token';

describe('readResetToken', () => {
  it('reads the token from the link fragment', () => {
    const token = 'aB3_-x'.repeat(7);
    expect(readResetToken(`#token=${token}`)).toBe(token);
  });

  it('ignores a missing or malformed token', () => {
    expect(readResetToken('')).toBe('');
    expect(readResetToken('#token=')).toBe('');
    expect(readResetToken('#token=<script>alert(1)</script>')).toBe('');
  });
});

describe('newPasswordProblem', () => {
  it('asks for a long enough password, typed the same twice', () => {
    expect(newPasswordProblem('short', 'short')).toMatch(/at least 8/);
    expect(newPasswordProblem('long-enough', 'long-enougH')).toMatch(/do not match/);
    expect(newPasswordProblem('long-enough', 'long-enough')).toBeNull();
  });
});
