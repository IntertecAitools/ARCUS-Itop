import { describe, expect, it } from 'vitest';
import { ApiError, errorMessage } from './ApiError';

describe('errorMessage', () => {
  it('adds the fields a validation refusal names, with the form labels', () => {
    const err = new ApiError('Invalid request body.', 400, 'bad_request', [
      { path: 'newTenant.orgIds', message: 'Enter at least one organisation id.' },
      { path: 'agents', message: 'Number must be greater than or equal to 1' },
    ]);
    expect(errorMessage(err, { 'newTenant.orgIds': 'Organisation ids', agents: 'Agents' })).toBe(
      'Invalid request body. Organisation ids: Enter at least one organisation id. Agents: Number must be greater than or equal to 1',
    );
  });

  it('falls back to the last part of the path, then the path itself', () => {
    const err = new ApiError('Invalid request body.', 400, 'bad_request', [
      { path: 'newTenant.id', message: 'bad id' },
      { path: 'other.thing', message: 'nope' },
    ]);
    expect(errorMessage(err, { id: 'Tenant id' })).toBe('Invalid request body. Tenant id: bad id other.thing: nope');
  });

  it('is the plain message without details, and a generic one for non-errors', () => {
    expect(errorMessage(new ApiError('Tenant acme already exists.', 409, 'conflict'))).toBe('Tenant acme already exists.');
    expect(errorMessage(new Error('Network down'))).toBe('Network down');
    expect(errorMessage('boom')).toBe('Something went wrong.');
  });
});
