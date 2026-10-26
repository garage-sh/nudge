import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  guardedFetch,
  isPublicAddress,
  outboundPolicyFromEnv,
  OutboundRefusedError,
  STRICT_OUTBOUND_POLICY,
} from './outbound.js';

describe('outbound policy from NUDGE_OUTBOUND_ALLOWED_HOSTS', () => {
  it('allows only public addresses when the variable is absent or empty', () => {
    expect(outboundPolicyFromEnv({})).toEqual(STRICT_OUTBOUND_POLICY);
    expect(outboundPolicyFromEnv({ NUDGE_OUTBOUND_ALLOWED_HOSTS: ' ' })).toEqual(
      STRICT_OUTBOUND_POLICY,
    );
  });

  it('reads host names, IP addresses and CIDR ranges, comma-separated', () => {
    expect(
      outboundPolicyFromEnv({
        NUDGE_OUTBOUND_ALLOWED_HOSTS: 'Hooks.LAN, decider ,10.0.0.5,192.168.0.0/16,fd00::/8,::1',
      }),
    ).toEqual({
      allowedHosts: ['hooks.lan', 'decider', '10.0.0.5', '192.168.0.0/16', 'fd00::/8', '::1'],
    });
  });

  it.each([
    '10.0.0.0/33',
    'fd00::/129',
    '10.0.0.0/8/1',
    'http://hooks.lan',
    'hooks.lan:8080',
    '',
    '*',
  ])('refuses to start with the entry "%s"', (entry) => {
    expect(() =>
      outboundPolicyFromEnv({ NUDGE_OUTBOUND_ALLOWED_HOSTS: `decider,${entry}` }),
    ).toThrow('NUDGE_OUTBOUND_ALLOWED_HOSTS');
  });
});

describe('public addresses', () => {
  it.each([
    '1.1.1.1',
    '93.184.215.14',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
  ])('%s is public', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    ['0.0.0.0', 'unspecified'],
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'private'],
    ['172.16.0.1', 'private'],
    ['192.168.1.1', 'private'],
    ['169.254.169.254', 'link-local, cloud metadata'],
    ['100.64.0.1', 'CGNAT'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
    ['::', 'IPv6 unspecified'],
    ['::1', 'IPv6 loopback'],
    ['fe80::1', 'IPv6 link-local'],
    ['fd00:ec2::254', 'unique local, AWS metadata'],
    ['ff02::1', 'IPv6 multicast'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:a9fe:a9fe', 'IPv4-mapped link-local'],
    ['64:ff9b::a00:1', 'NAT64 of a private address'],
    ['2002:7f00:1::', '6to4 of loopback'],
  ])('%s is not public (%s)', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe('guarded fetch', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((_, response) => response.end('internal'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it.each([
    'http://127.0.0.1:{port}/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[fd00:ec2::254]/',
    'http://[::ffff:127.0.0.1]:{port}/',
    'http://0.0.0.0:{port}/',
    'http://2130706433:{port}/',
  ])('refuses %s before connecting', async (url) => {
    const fetch = guardedFetch(STRICT_OUTBOUND_POLICY);

    const error = await fetch(url.replace('{port}', String(port)), { method: 'POST' }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(OutboundRefusedError);
    expect((error as Error).message).toContain('NUDGE_OUTBOUND_ALLOWED_HOSTS');
  });

  it('checks the addresses a name resolves to, at connection time', async () => {
    const error = await guardedFetch(STRICT_OUTBOUND_POLICY)(`http://localhost:${port}/`).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(OutboundRefusedError);
    // The Member does not learn where the name points.
    expect((error as Error).message).not.toContain('127.0.0.1');
  });

  it.each([['localhost'], ['127.0.0.0/8,::1'], ['127.0.0.1']])(
    'connects to an internal host the Self-hoster allowed (%s)',
    async (allowed) => {
      const fetch = guardedFetch(outboundPolicyFromEnv({ NUDGE_OUTBOUND_ALLOWED_HOSTS: allowed }));
      const host = allowed === '127.0.0.1' ? '127.0.0.1' : 'localhost';

      const response = await fetch(`http://${host}:${port}/`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('internal');
    },
  );

  it('an allowed name does not open other internal hosts', async () => {
    const fetch = guardedFetch({ allowedHosts: ['hooks.lan'] });

    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(OutboundRefusedError);
  });
});
