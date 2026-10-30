import { describe, expect, it, vi } from 'vitest';
import { apiConfigFromEnv } from './env.js';

const MINIMAL = {
  DATABASE_URL: 'postgres://nudge:nudge@postgres:5432/nudge',
  REDIS_URL: 'redis://redis:6379',
  NUDGE_ENCRYPTION_KEY: 'ZHVtbXktdGVzdC1rZXktZXhhY3RseS0zMi1ieXRlcyE=', // gitleaks:allow (dummy key)
};

describe('Api configuration from environment variables', () => {
  it('starts with the database, Redis and the Instance key, the rest by default', () => {
    expect(apiConfigFromEnv(MINIMAL)).toEqual({
      port: 3000,
      databaseUrl: MINIMAL.DATABASE_URL,
      redisUrl: MINIMAL.REDIS_URL,
      encryptionKey: MINIMAL.NUDGE_ENCRYPTION_KEY,
      storage: { type: 'disk', dir: '/var/lib/nudge/captures' },
      outbound: { allowedHosts: [] },
      sessionCookieSecure: true,
      setupToken: null,
      trustProxy: false,
      widgetLimits: {
        perIp: { limit: 20, windowMs: 60_000 },
        perProject: { limit: 600, windowMs: 60_000 },
      },
      openingCap: { limit: 20, windowMs: 60_000 },
    });
  });

  it('reads the Instance Opening cap of the Incidents, per minute', () => {
    expect(apiConfigFromEnv({ ...MINIMAL, NUDGE_INCIDENT_OPENING_CAP: '50' }).openingCap).toEqual({
      limit: 50,
      windowMs: 60_000,
    });
    expect(() => apiConfigFromEnv({ ...MINIMAL, NUDGE_INCIDENT_OPENING_CAP: '0' })).toThrow(
      /NUDGE_INCIDENT_OPENING_CAP/,
    );
  });

  it('reads the port, the cookie, the Widget limits per minute', () => {
    expect(
      apiConfigFromEnv(
        {
          ...MINIMAL,
          NUDGE_API_PORT: '8081',
          NUDGE_COOKIE_SECURE: 'false',
          NUDGE_DASHBOARD_URL: 'http://localhost:8080',
          NUDGE_WIDGET_RATE_LIMIT_IP: '5',
          NUDGE_WIDGET_RATE_LIMIT_PROJECT: '1000',
        },
        () => {},
      ),
    ).toMatchObject({
      port: 8081,
      sessionCookieSecure: false,
      widgetLimits: {
        perIp: { limit: 5, windowMs: 60_000 },
        perProject: { limit: 1000, windowMs: 60_000 },
      },
    });
  });

  it.each([
    ['http://localhost:8080', false],
    ['http://127.0.0.1:8080', false],
    ['http://nudge.lan:8080', true],
    [undefined, true],
  ])(
    'warns about NUDGE_COOKIE_SECURE=false with the dashboard at %s unless on localhost',
    (dashboardUrl, warned) => {
      const warn = vi.fn();

      const config = apiConfigFromEnv(
        { ...MINIMAL, NUDGE_COOKIE_SECURE: 'false', NUDGE_DASHBOARD_URL: dashboardUrl },
        warn,
      );

      expect(config.sessionCookieSecure).toBe(false);
      if (warned) expect(warn).toHaveBeenCalledWith(expect.stringContaining('NUDGE_COOKIE_SECURE'));
      else expect(warn).not.toHaveBeenCalled();
    },
  );

  it('refuses NUDGE_COOKIE_SECURE=false with a dashboard served over HTTPS', () => {
    expect(() =>
      apiConfigFromEnv({
        ...MINIMAL,
        NUDGE_COOKIE_SECURE: 'false',
        NUDGE_DASHBOARD_URL: 'https://nudge.example.com',
      }),
    ).toThrow('NUDGE_COOKIE_SECURE');
  });

  it.each([
    ['1', 1],
    ['2', 2],
    ['false', false],
    ['loopback, uniquelocal', 'loopback, uniquelocal'],
    ['10.0.0.0/8', '10.0.0.0/8'],
  ])('reads NUDGE_TRUST_PROXY=%s as the Express `trust proxy` setting', (value, expected) => {
    expect(apiConfigFromEnv({ ...MINIMAL, NUDGE_TRUST_PROXY: value }).trustProxy).toEqual(expected);
  });

  it('reads the internal hosts a Member-configured URL may reach', () => {
    expect(
      apiConfigFromEnv({ ...MINIMAL, NUDGE_OUTBOUND_ALLOWED_HOSTS: 'hooks.lan,10.0.0.0/8' })
        .outbound,
    ).toEqual({ allowedHosts: ['hooks.lan', '10.0.0.0/8'] });
  });

  it.each([
    ['NUDGE_OUTBOUND_ALLOWED_HOSTS', 'http://hooks.lan'],
    ['NUDGE_COOKIE_SECURE', 'no'],
    ['NUDGE_API_PORT', '70000'],
    ['NUDGE_WIDGET_RATE_LIMIT_IP', '0'],
    ['NUDGE_WIDGET_RATE_LIMIT_PROJECT', 'unlimited'],
    ['NUDGE_CAPTURES_DIR', 'captures'],
    ['NUDGE_TRUST_PROXY', 'true'],
    ['NUDGE_SETUP_TOKEN', 'too-short'],
  ])('refuses to start with %s=%s', (variable, value) => {
    expect(() => apiConfigFromEnv({ ...MINIMAL, [variable]: value })).toThrow(variable);
  });

  it.each(['DATABASE_URL', 'REDIS_URL', 'NUDGE_ENCRYPTION_KEY'])(
    'refuses to start without %s',
    (variable) => {
      expect(() => apiConfigFromEnv({ ...MINIMAL, [variable]: '' })).toThrow(variable);
    },
  );
});
