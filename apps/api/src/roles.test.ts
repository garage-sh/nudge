import { describe, expect, it } from 'vitest';
import { rolesFromEnv } from './roles.js';

describe('Process roles (NUDGE_ROLES)', () => {
  it('does everything in the same process by default', () => {
    expect([...rolesFromEnv({})]).toEqual(['api', 'worker']);
    expect([...rolesFromEnv({ NUDGE_ROLES: '' })]).toEqual(['api', 'worker']);
  });

  it('splits the api from the worker to replicate them separately', () => {
    expect([...rolesFromEnv({ NUDGE_ROLES: 'api' })]).toEqual(['api']);
    expect([...rolesFromEnv({ NUDGE_ROLES: 'worker' })]).toEqual(['worker']);
    expect([...rolesFromEnv({ NUDGE_ROLES: ' worker , api ' })]).toEqual(['worker', 'api']);
  });

  it('refuses an unknown role rather than start a process that does nothing', () => {
    expect(() => rolesFromEnv({ NUDGE_ROLES: 'triage' })).toThrow('Invalid NUDGE_ROLES: "triage"');
    expect(() => rolesFromEnv({ NUDGE_ROLES: ',' })).toThrow('Invalid NUDGE_ROLES');
  });
});
