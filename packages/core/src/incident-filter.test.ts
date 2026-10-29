import { describe, expect, it } from 'vitest';
import { incidentFilterAccepts, type IncidentFilter } from './incident-filter.js';

const anyIncident: IncidentFilter = { minimumLevel: 'info', environments: [], conditions: [] };
const onCall: IncidentFilter = {
  minimumLevel: 'error',
  environments: ['production'],
  conditions: [],
};

const incident = (
  fields: Partial<Parameters<typeof incidentFilterAccepts>[1]> = {},
): Parameters<typeof incidentFilterAccepts>[1] => ({
  level: 'error',
  environment: 'production',
  context: {},
  ...fields,
});

describe('A Destination’s Incident Filter', () => {
  it('turned off, accepts no Incident', () => {
    expect(incidentFilterAccepts(null, incident({ level: 'critical' }))).toBe(false);
  });

  it('accepts an Incident whose Level reaches the minimum Level, inclusive', () => {
    expect(incidentFilterAccepts(onCall, incident({ level: 'error' }))).toBe(true);
    expect(incidentFilterAccepts(onCall, incident({ level: 'critical' }))).toBe(true);
    expect(incidentFilterAccepts(onCall, incident({ level: 'warning' }))).toBe(false);
    expect(incidentFilterAccepts(onCall, incident({ level: 'info' }))).toBe(false);
  });

  it('accepts only the listed Environments', () => {
    expect(incidentFilterAccepts(onCall, incident({ environment: 'staging' }))).toBe(false);
    const both = { ...onCall, environments: ['production', 'staging'] };
    expect(incidentFilterAccepts(both, incident({ environment: 'staging' }))).toBe(true);
  });

  it('an empty list of Environments accepts every Environment, and none', () => {
    expect(incidentFilterAccepts(anyIncident, incident({ environment: 'staging' }))).toBe(true);
    expect(incidentFilterAccepts(anyIncident, incident({ environment: null }))).toBe(true);
  });

  it('an Incident without an Environment passes only an empty list', () => {
    expect(incidentFilterAccepts(onCall, incident({ environment: null }))).toBe(false);
  });

  it('accepts an Incident whose context meets every condition', () => {
    const payments: IncidentFilter = {
      ...anyIncident,
      conditions: [
        { key: 'service', values: ['checkout', 'billing'] },
        { key: 'region', values: ['eu'] },
      ],
    };
    expect(
      incidentFilterAccepts(payments, incident({ context: { service: 'billing', region: 'eu' } })),
    ).toBe(true);
    expect(
      incidentFilterAccepts(payments, incident({ context: { service: 'search', region: 'eu' } })),
    ).toBe(false);
    expect(
      incidentFilterAccepts(payments, incident({ context: { service: 'billing', region: 'us' } })),
    ).toBe(false);
  });

  it('refuses an Incident whose context lacks a key a condition requires', () => {
    const payments: IncidentFilter = {
      ...anyIncident,
      conditions: [{ key: 'service', values: ['checkout'] }],
    };
    expect(incidentFilterAccepts(payments, incident({ context: {} }))).toBe(false);
    expect(incidentFilterAccepts(payments, incident({ context: { service: null } }))).toBe(false);
  });

  it('compares a number or a boolean of the context as its text', () => {
    const v2: IncidentFilter = {
      ...anyIncident,
      conditions: [
        { key: 'major', values: ['2'] },
        { key: 'canary', values: ['true'] },
      ],
    };
    expect(incidentFilterAccepts(v2, incident({ context: { major: 2, canary: true } }))).toBe(true);
    expect(incidentFilterAccepts(v2, incident({ context: { major: 3, canary: true } }))).toBe(
      false,
    );
  });

  it('every requirement must hold together', () => {
    const paymentsOnCall: IncidentFilter = {
      ...onCall,
      conditions: [{ key: 'service', values: ['checkout'] }],
    };
    const matching = incident({ context: { service: 'checkout' } });
    expect(incidentFilterAccepts(paymentsOnCall, matching)).toBe(true);
    expect(incidentFilterAccepts(paymentsOnCall, { ...matching, level: 'warning' })).toBe(false);
    expect(incidentFilterAccepts(paymentsOnCall, { ...matching, environment: 'staging' })).toBe(
      false,
    );
  });
});
