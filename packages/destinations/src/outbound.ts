import { lookup as dnsLookup, type LookupAddress, type LookupAllOptions } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { optionalEnv, type Env } from '@nudge/core';
import { Agent, buildConnector, fetch as undiciFetch } from 'undici';

/** Variable through which the Self-hoster lets outbound calls reach non-public hosts. */
export const OUTBOUND_ALLOWED_HOSTS_VARIABLE = 'NUDGE_OUTBOUND_ALLOWED_HOSTS';

/**
 * What a URL a Member configured (webhook, Alert destination, Judge base URL) may reach
 * besides the public internet. By default, nothing: loopback, private, link-local
 * (cloud metadata), CGNAT, multicast and other non-public addresses are refused.
 */
export interface OutboundPolicy {
  /**
   * Host names (exact match, `hooks.lan`), IP addresses (`10.0.0.5`) or CIDR ranges
   * (`192.168.0.0/16`, `fd00::/8`) allowed although not public.
   */
  readonly allowedHosts: readonly string[];
}

export const STRICT_OUTBOUND_POLICY: OutboundPolicy = { allowedHosts: [] };

/**
 * `NUDGE_OUTBOUND_ALLOWED_HOSTS`: comma-separated host names, IP addresses or CIDR
 * ranges. Absent: only public addresses. An invalid entry throws, naming the variable.
 */
export function outboundPolicyFromEnv(env: Env): OutboundPolicy {
  const raw = optionalEnv(env, OUTBOUND_ALLOWED_HOSTS_VARIABLE);
  if (raw === null) return STRICT_OUTBOUND_POLICY;
  const entries = raw.split(',').map((entry) => entry.trim().toLowerCase());
  for (const entry of entries) {
    if (!isValidEntry(entry)) {
      throw new Error(
        `Invalid ${OUTBOUND_ALLOWED_HOSTS_VARIABLE}: "${entry}" (expected comma-separated ` +
          'host names, IP addresses or CIDR ranges)',
      );
    }
  }
  return { allowedHosts: entries };
}

/** A connection a policy refuses: the target is not public and the Self-hoster did not allow it. */
export class OutboundRefusedError extends Error {
  override readonly name = 'OutboundRefusedError';
  constructor(readonly host: string) {
    // The resolved address is not given: a Member would learn the internal network map.
    super(
      `Refused to connect to ${host}: not a public address ` +
        `(the Self-hoster can allow it with ${OUTBOUND_ALLOWED_HOSTS_VARIABLE})`,
    );
  }
}

/**
 * A `fetch` that only connects to public addresses, or to those the policy allows. The
 * check runs at connection time, on the addresses actually connected to (IP literal,
 * or every address the name resolves to): a name that resolves to a public address
 * when configured and to an internal one later (DNS rebinding) is refused all the same.
 * A refusal rejects with `OutboundRefusedError`.
 */
export function guardedFetch(policy: OutboundPolicy): typeof globalThis.fetch {
  const allowed = compile(policy);
  const connect = buildConnector({ lookup: guardedLookup(allowed) });
  const dispatcher = new Agent({
    connect(options, callback) {
      // An IP literal is not resolved: `lookup` would not see it.
      if (isIP(options.hostname) && !allowed.address(options.hostname)) {
        callback(new OutboundRefusedError(options.hostname), null);
        return;
      }
      connect(options, callback);
    },
  });
  return (async (input: string | URL, init?: RequestInit) => {
    try {
      return await undiciFetch(input, { ...(init as object), dispatcher });
    } catch (error) {
      // `fetch failed` hides the refusal in its cause.
      const cause = error instanceof Error ? error.cause : undefined;
      throw cause instanceof OutboundRefusedError ? cause : error;
    }
  }) as typeof globalThis.fetch;
}

/** Whether an IP address is public: not in any special-purpose range (IANA registries). */
export const isPublicAddress = (address: string): boolean =>
  !NON_PUBLIC.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');

interface CompiledPolicy {
  readonly host: (hostname: string) => boolean;
  readonly address: (address: string) => boolean;
}

function compile(policy: OutboundPolicy): CompiledPolicy {
  const hosts = new Set<string>();
  const networks = new BlockList();
  for (const entry of policy.allowedHosts) {
    const [address, prefix] = entry.split('/');
    const family = isIP(address!) === 6 ? 'ipv6' : 'ipv4';
    if (prefix !== undefined) networks.addSubnet(address!, Number(prefix), family);
    else if (isIP(entry)) networks.addAddress(entry, family);
    else hosts.add(entry.replace(/\.$/, ''));
  }
  return {
    host: (hostname) => hosts.has(hostname.toLowerCase().replace(/\.$/, '')),
    address: (address) =>
      isPublicAddress(address) || networks.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4'),
  };
}

/** `dns.lookup`, refused if one of the addresses is not allowed, unless the name itself is. */
function guardedLookup(allowed: CompiledPolicy): LookupFunction {
  return (hostname, options, callback) => {
    const all: LookupAllOptions = { ...options, all: true };
    dnsLookup(hostname, all, (error, addresses: LookupAddress[]) => {
      if (error) return callback(error, '', 0);
      if (!allowed.host(hostname) && addresses.some(({ address }) => !allowed.address(address))) {
        return callback(new OutboundRefusedError(hostname), '', 0);
      }
      // `net.connect` asks for every address when it tries them in turn (autoSelectFamily).
      if (options.all) return callback(null, addresses);
      const [first] = addresses;
      if (!first) return callback(new Error(`No address for ${hostname}`), '', 0);
      callback(null, first.address, first.family);
    });
  };
}

const HOST_NAME =
  /^(?=.{1,253}\.?$)[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)*\.?$/;

function isValidEntry(entry: string): boolean {
  const [address, prefix, ...rest] = entry.split('/');
  if (prefix === undefined) return isIP(entry) !== 0 || HOST_NAME.test(entry);
  const family = isIP(address!);
  const max = family === 6 ? 128 : 32;
  return family !== 0 && rest.length === 0 && /^\d{1,3}$/.test(prefix) && Number(prefix) <= max;
}

/** IPv4 special-purpose ranges, none reachable on the public internet. */
const NON_PUBLIC_IPV4: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8], // "this network", unspecified
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // shared address space (CGNAT)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata (169.254.169.254)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
];

/** The two last IPv6 groups that embed an IPv4 address (`10.0.0.0` → `a00:0`). */
const embedded = (ipv4: string): string => {
  const [a, b, c, d] = ipv4.split('.').map(Number) as [number, number, number, number];
  return `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
};

const NON_PUBLIC = (() => {
  const list = new BlockList();
  for (const [address, prefix] of NON_PUBLIC_IPV4) {
    // Also covers IPv4-mapped IPv6 (::ffff:127.0.0.1), which BlockList matches to IPv4.
    list.addSubnet(address, prefix, 'ipv4');
    // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) embed an IPv4 address.
    list.addSubnet(`64:ff9b::${embedded(address)}`, 96 + prefix, 'ipv6');
    const [high, low] = embedded(address).split(':');
    list.addSubnet(`2002:${high}:${low}::`, 16 + prefix, 'ipv6');
  }
  for (const [address, prefix] of [
    ['::', 96], // unspecified, loopback, IPv4-compatible
    ['64:ff9b:1::', 48], // local-use NAT64
    ['100::', 64], // discard-only
    ['2001::', 23], // IETF protocol assignments (Teredo, ORCHID…)
    ['2001:db8::', 32], // documentation
    ['3fff::', 20], // documentation
    ['fc00::', 7], // unique local (ULA), AWS metadata (fd00:ec2::254)
    ['fe80::', 10], // link-local
    ['fec0::', 10], // site-local (deprecated)
    ['ff00::', 8], // multicast
  ] as const) {
    list.addSubnet(address, prefix, 'ipv6');
  }
  return list;
})();
