import { describe, expect, it } from 'vitest';
import { rolesFromEnv } from './roles.js';

describe('Rôles du processus (NUDGE_ROLES)', () => {
  it('fait tout dans le même processus par défaut', () => {
    expect([...rolesFromEnv({})]).toEqual(['api', 'worker']);
    expect([...rolesFromEnv({ NUDGE_ROLES: '' })]).toEqual(['api', 'worker']);
  });

  it('sépare l’api du worker pour les répliquer à part', () => {
    expect([...rolesFromEnv({ NUDGE_ROLES: 'api' })]).toEqual(['api']);
    expect([...rolesFromEnv({ NUDGE_ROLES: 'worker' })]).toEqual(['worker']);
    expect([...rolesFromEnv({ NUDGE_ROLES: ' worker , api ' })]).toEqual(['worker', 'api']);
  });

  it('refuse un rôle inconnu plutôt que de démarrer un processus qui ne fait rien', () => {
    expect(() => rolesFromEnv({ NUDGE_ROLES: 'triage' })).toThrow(
      'NUDGE_ROLES invalide : « triage »',
    );
    expect(() => rolesFromEnv({ NUDGE_ROLES: ',' })).toThrow('NUDGE_ROLES invalide');
  });
});
