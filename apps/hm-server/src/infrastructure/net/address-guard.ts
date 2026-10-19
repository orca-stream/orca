import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { PermanentError, RetryableError } from "../../domain/errors.ts";

/** Prefix lengths below are in bits: `[a, b, c, d, bits]`. */
type V4Range = readonly [number, number, number, number, number];

/** Addresses a server-side fetch must never reach: this machine, the LAN, link-local, metadata. */
const BLOCKED_V4: readonly V4Range[] = [
  [0, 0, 0, 0, 8], // "this" network, 0.0.0.0
  [10, 0, 0, 0, 8], // private
  [100, 64, 0, 0, 10], // carrier-grade NAT (includes Alibaba's metadata, 100.100.100.200)
  [127, 0, 0, 0, 8], // loopback
  [169, 254, 0, 0, 16], // link-local, cloud metadata (169.254.169.254)
  [172, 16, 0, 0, 12], // private
  [192, 0, 0, 0, 24], // IETF protocol assignments
  [192, 168, 0, 0, 16], // private
  [198, 18, 0, 0, 15], // benchmarking
  [224, 0, 0, 0, 4], // multicast
  [240, 0, 0, 0, 4], // reserved, and 255.255.255.255
];

function v4Blocked(bytes: readonly number[]): boolean {
  const value = (((bytes[0]! * 256 + bytes[1]!) * 256 + bytes[2]!) * 256 + bytes[3]!) >>> 0;
  return BLOCKED_V4.some(([a, b, c, d, bits]) => {
    const base = (((a * 256 + b) * 256 + c) * 256 + d) >>> 0;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (base & mask);
  });
}

/** The 16 bytes of an IPv6 address, handling `::` and a dotted IPv4 tail. Null if malformed. */
function v6Bytes(address: string): number[] | null {
  let text = address;
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail) {
    const octets = tail.slice(1).map(Number);
    if (octets.some((n) => n > 255)) return null;
    const hex = (a: number, b: number) => ((a << 8) | b).toString(16);
    text = `${text.slice(0, tail.index)}${hex(octets[0]!, octets[1]!)}:${hex(octets[2]!, octets[3]!)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = groups(halves[0]!);
  const rest = halves.length === 2 ? groups(halves[1]!) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  const bytes: number[] = [];
  for (const group of all) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    const n = parseInt(group, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

function v6Blocked(bytes: readonly number[]): boolean {
  const first12Zero = bytes.slice(0, 12).every((b) => b === 0);
  // :: and ::1
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15]! <= 1) return true;
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible)
  const mapped =
    bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mapped || first12Zero) return v4Blocked(bytes.slice(12));
  // 64:ff9b::/96 (NAT64) carries an IPv4 address too
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    if (bytes.slice(4, 12).every((b) => b === 0)) return v4Blocked(bytes.slice(12));
  }
  // 2002::/16 (6to4) carries it in bytes 2..5
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return v4Blocked(bytes.slice(2, 6));
  if ((bytes[0]! & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (bytes[0] === 0xff) return true; // multicast
  return false;
}

/** True for loopback, private, link-local, CGNAT, metadata, reserved and anything unparseable. */
export function isBlockedAddress(input: string): boolean {
  const address = input.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const family = isIP(address);
  if (family === 4) return v4Blocked(address.split(".").map(Number));
  if (family === 6) {
    const bytes = v6Bytes(address);
    return bytes === null || v6Blocked(bytes);
  }
  return true;
}

export interface AddressGuardOptions {
  /** Every address a name resolves to. Replaced in tests. */
  resolve?: (host: string) => Promise<string[]>;
}

const defaultResolve = async (host: string): Promise<string[]> =>
  (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

/** Schemes whose content never leaves this machine: a page may use them freely. */
const LOCAL_SCHEMES = new Set(["data:", "blob:", "about:"]);

/**
 * Keeps server-side fetches (the headless browser, ffmpeg, ffprobe, the downloader) away from this
 * machine and its network: only http(s) addresses whose every resolved IP is public. The check and
 * the later connection resolve the name separately, so DNS rebinding can still slip through: see
 * "Residual risks" in docs/hm-server-design.md.
 */
export class AddressGuard {
  private readonly resolve: (host: string) => Promise<string[]>;

  constructor(options: AddressGuardOptions = {}) {
    this.resolve = options.resolve ?? defaultResolve;
  }

  async assertUrl(input: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(input.trim());
    } catch {
      throw new PermanentError("That is not a web address");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new PermanentError("Only http and https addresses can be opened");
    }
    if (url.username !== "" || url.password !== "") {
      throw new PermanentError("Addresses with a user name or password are not accepted");
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const refusal = (name: string) =>
      new PermanentError(`Refusing to open ${name}: it points to a private or internal address`);
    if (isIP(host) !== 0) {
      if (isBlockedAddress(host)) throw refusal(url.hostname);
      return url;
    }
    let addresses: string[];
    try {
      addresses = await this.resolve(host);
    } catch (error) {
      throw new RetryableError(`Could not resolve ${host}`, { cause: error });
    }
    if (addresses.length === 0) throw new RetryableError(`Could not resolve ${host}`);
    if (addresses.some(isBlockedAddress)) throw refusal(host);
    return url;
  }

  /** For the browser's request interception: a yes or no, never an exception. */
  async isAllowed(input: string): Promise<boolean> {
    if (LOCAL_SCHEMES.has(input.slice(0, input.indexOf(":") + 1).toLowerCase())) return true;
    try {
      await this.assertUrl(input);
      return true;
    } catch {
      return false;
    }
  }
}
