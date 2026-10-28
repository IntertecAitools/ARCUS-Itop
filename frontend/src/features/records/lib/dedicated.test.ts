import { describe, expect, it } from 'vitest';
import { dedicatedRecordPath } from './dedicated';

describe('dedicatedRecordPath', () => {
  it('sends an incident to its own screen', () => {
    expect(dedicatedRecordPath('Incident', '9')).toBe('/incidents/9');
  });

  it("sends iTop's New incident menu to the incident form", () => {
    expect(dedicatedRecordPath('Incident', 'new')).toBe('/incidents/new');
  });

  it('leaves classes without a screen of their own on the generic page', () => {
    expect(dedicatedRecordPath('UserRequest', '9')).toBeNull();
    expect(dedicatedRecordPath('Server', '3')).toBeNull();
  });
});
