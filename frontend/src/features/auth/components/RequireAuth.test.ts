import { describe, expect, it } from 'vitest';
import { portalPathFor } from './RequireAuth';

describe('portalPathFor', () => {
  it('sends an end user to the portal copy of what they followed a link to', () => {
    expect(portalPathFor('/approvals/12')).toBe('/portal/approvals/12');
    expect(portalPathFor('/approvals')).toBe('/portal/approvals');
    expect(portalPathFor('/records/UserRequest/33')).toBe('/portal/requests/33');
  });

  it("falls back to the portal's home for anything else", () => {
    expect(portalPathFor('/dashboard')).toBe('/portal');
    expect(portalPathFor('/records/Incident/4')).toBe('/portal');
    expect(portalPathFor('/approvals/12/extra')).toBe('/portal');
  });
});
