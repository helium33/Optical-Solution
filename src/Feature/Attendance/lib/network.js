/**
 * IP allowlisting — the second half of the location check.
 *
 * SCOPE, stated plainly: a browser cannot read the LAN address of the router
 * it is talking to. What it *can* observe is the shop's public egress IP, and
 * that is what "matching the shop's Wi-Fi" means in practice — every device on
 * the shop router shares it, and a staff member at home does not.
 *
 * TRUST, stated equally plainly: the value this module fetches is reported by
 * the client and is therefore spoofable. It is a convenience signal that makes
 * the kiosk fast and gives good error copy. The binding check is the Cloud
 * Function comparing `request.rawRequest.ip` — the address the *server* saw —
 * against the same allowlist. See docs/ATTENDANCE_ARCHITECTURE.md.
 */

/* ───────────────────────────── IPv4 ───────────────────────────────────── */

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function ipv4ToInt(ip) {
  const match = IPV4_RE.exec(String(ip).trim());
  if (!match) return null;
  let value = 0;
  for (let i = 1; i <= 4; i += 1) {
    const octet = Number(match[i]);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    /* Multiply rather than shift: << is signed 32-bit and flips negative
       for anything at or above 128.x.x.x. */
    value = value * 256 + octet;
  }
  return value;
}

/* ───────────────────────────── IPv6 ───────────────────────────────────── */

export function ipv6ToBigInt(ip) {
  let text = String(ip).trim().toLowerCase();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  if (!text.includes(':')) return null;

  /* An embedded IPv4 tail (::ffff:192.0.2.1) becomes two hex groups. */
  const v4Tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
  if (v4Tail) {
    const asInt = ipv4ToInt(v4Tail[1]);
    if (asInt === null) return null;
    const high = (asInt >>> 16) & 0xffff;
    const low = asInt & 0xffff;
    text = text.slice(0, v4Tail.index) + high.toString(16) + ':' + low.toString(16);
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];

  let groups;
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array(fill).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

/* ───────────────────────────── Matching ───────────────────────────────── */

/**
 * Does `ip` fall inside `cidr`? Accepts "203.0.113.0/24", "2001:db8::/32", or a
 * bare address (treated as a /32 or /128).
 */
export function matchesCidr(ip, cidr) {
  if (!ip || !cidr) return false;
  const [network, prefixText] = String(cidr).trim().split('/');
  const isV6 = network.includes(':');

  if (isV6) {
    const prefix = prefixText === undefined ? 128 : Number(prefixText);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return false;
    const a = ipv6ToBigInt(ip);
    const b = ipv6ToBigInt(network);
    if (a === null || b === null) return false;
    if (prefix === 0) return true;
    const mask = ((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix);
    return (a & mask) === (b & mask);
  }

  const prefix = prefixText === undefined ? 32 : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(network);
  if (a === null || b === null) return false;
  if (prefix === 0) return true;
  /* 2**(32-prefix) keeps the arithmetic unsigned; ~0 << n does not. */
  const size = 2 ** (32 - prefix);
  return Math.floor(a / size) === Math.floor(b / size);
}

export function ipMatchesAny(ip, cidrs = []) {
  return cidrs.some((cidr) => matchesCidr(ip, cidr));
}

/* ───────────────────────── Public IP lookup ───────────────────────────── */

const DEFAULT_ENDPOINT =
  import.meta?.env?.VITE_IP_ECHO_URL || 'https://api.ipify.org?format=json';

/**
 * Ask an echo service what our egress address looks like from outside.
 * Resolves to `null` on any failure — the caller decides whether "unknown IP"
 * blocks the punch or merely downgrades it to GPS-only.
 */
export async function fetchPublicIp({ endpoint = DEFAULT_ENDPOINT, timeoutMs = 4000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('json')) {
      const body = await response.json();
      return body?.ip ?? body?.address ?? null;
    }
    const text = (await response.text()).trim();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const NETWORK = {
  MATCH: 'match',
  MISMATCH: 'mismatch',
  UNKNOWN: 'unknown',
  /** Branch has no allowlist configured — the check is not applicable. */
  SKIPPED: 'skipped',
};

export function evaluateNetwork(ip, branchNetwork) {
  const allowed = branchNetwork?.allowedCidrs ?? [];
  if (!allowed.length) return { verdict: NETWORK.SKIPPED, ip, enforced: false };
  if (!ip) return { verdict: NETWORK.UNKNOWN, ip: null, enforced: Boolean(branchNetwork.enforce) };
  return {
    verdict: ipMatchesAny(ip, allowed) ? NETWORK.MATCH : NETWORK.MISMATCH,
    ip,
    enforced: Boolean(branchNetwork.enforce),
  };
}
