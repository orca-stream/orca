const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function toInt(ip: string): number | undefined {
  const m = IPV4.exec(ip);
  if (!m) return undefined;
  const octets = m.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return undefined;
  return ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0;
}

function parseCidr(cidr: string): { net: number; mask: number } | undefined {
  const m = /^([\d.]+)\/(\d{1,2})$/.exec(cidr);
  if (!m) return undefined;
  const net = toInt(m[1]!);
  const bits = Number(m[2]);
  if (net === undefined || bits > 32 || (m[2]!.length > 1 && m[2]!.startsWith("0")))
    return undefined;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { net, mask };
}

/** A real IPv4 network: valid octets, prefix 0-32 and no host bits set (ufw would normalise those away). */
export function isNetworkCidr(cidr: string): boolean {
  const c = parseCidr(cidr);
  return c !== undefined && (c.net & c.mask) >>> 0 === c.net;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const c = parseCidr(cidr);
  const n = toInt(ip);
  return c !== undefined && n !== undefined && (n & c.mask) >>> 0 === (c.net & c.mask) >>> 0;
}

/** `$SSH_CLIENT` is "client-ip client-port server-port". Only IPv4 is understood. */
export function clientIpFromSshClient(value: string): string | undefined {
  const ip = value.trim().split(/\s+/)[0] ?? "";
  return toInt(ip) === undefined ? undefined : ip;
}
