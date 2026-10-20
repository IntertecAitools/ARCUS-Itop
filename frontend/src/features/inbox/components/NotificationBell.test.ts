import { describe, expect, it } from 'vitest';
import { badgeText } from './NotificationBell';

describe('badgeText', () => {
  it('shows the count up to nine, then 9+', () => {
    expect(badgeText(1)).toBe('1');
    expect(badgeText(9)).toBe('9');
    expect(badgeText(10)).toBe('9+');
  });
});
