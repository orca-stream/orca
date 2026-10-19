import { randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import {
  Agent,
  createServer,
  request,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import { connect, isIP, type AddressInfo, type Socket } from "node:net";
import type { Duplex } from "node:stream";

/** How long a name's addresses are trusted: long enough to check once per page, short enough to follow DNS. */
export const DNS_CACHE_TTL_MS = 30_000;
/** How long to wait for the target to accept a connection. */
export const CONNECT_TIMEOUT_MS = 15_000;
/** A connection with nothing moving for this long is closed, on both sides. */
export const IDLE_TIMEOUT_MS = 120_000;
/** Connections the proxy holds at once; more are dropped. */
export const MAX_CONNECTIONS = 256;
/** The ports the web lives on: nothing else (SSH, databases, Jellyfin's 8096…) is reachable through it. */
export const ALLOWED_PORTS: readonly number[] = [80, 443, 8080, 8443];
/** Above this many cached names, the expired ones are dropped. */
const DNS_CACHE_PRUNE_SIZE = 256;
const AUTH_REALM = "orca-guarded-proxy";

/** Headers that belong to one hop, not to the message being forwarded. */
const HOP_BY_HOP = [
  "connection",
  "proxy-connection",
  "proxy-authorization",
  "proxy-authenticate",
  "keep-alive",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

export interface GuardedProxyOptions {
  /** True for an IP address that must never be connected to. Called on every record of a name. */
  isBlockedAddress: (address: string) => boolean;
  /** Every address a name resolves to. Replaced in tests. */
  resolve?: (host: string) => Promise<string[]>;
  /** Which ports may be reached. Default: {@link ALLOWED_PORTS}. */
  isPortAllowed?: ((port: number) => boolean) | undefined;
  dnsCacheTtlMs?: number;
  idleTimeoutMs?: number;
  maxConnections?: number;
  /** Told about every request it refuses (blocked address, port, missing credentials). */
  onRefused?: (refusal: { host: string; status: number }) => void;
  now?: () => number;
}

/** A target that may not be reached (403) or could not be looked up (502). */
class Refusal extends Error {
  readonly status: 403 | 502;
  readonly host: string;
  constructor(status: 403 | 502, host: string, message: string) {
    super(message);
    this.status = status;
    this.host = host;
  }
}

const defaultResolve = async (host: string): Promise<string[]> =>
  (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

const REASONS: Record<number, string> = {
  200: "Connection Established",
  400: "Bad Request",
  403: "Forbidden",
  407: "Proxy Authentication Required",
  502: "Bad Gateway",
};

/** An agent that hands every request one socket that is already connected. */
class SingleSocketAgent extends Agent {
  private readonly socket: Socket;
  constructor(socket: Socket) {
    super({ keepAlive: false });
    this.socket = socket;
  }
  override createConnection(): Socket {
    return this.socket;
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The headers of one hop removed, together with every name the `Connection` header lists. */
function withoutHopByHop<T extends IncomingHttpHeaders | OutgoingHttpHeaders>(headers: T): T {
  const kept = { ...headers };
  const listed = String(headers["connection"] ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== "");
  for (const name of [...HOP_BY_HOP, ...listed]) delete kept[name];
  return kept;
}

/**
 * A forward proxy (plain HTTP and CONNECT) on 127.0.0.1 that only lets traffic reach public
 * addresses on web ports, for clients that know the credentials it made up at start. It resolves
 * each name itself, refuses it if any record is blocked, and connects to an IP it checked (trying
 * them in order), so a name that changes its answer afterwards (DNS rebinding) gains nothing.
 * Redirects are not followed here: the client sends the next hop as a new request, which is checked
 * like the first. A browser and ffmpeg are both pointed at it, which covers what only they can do:
 * follow redirects, fetch segments and keys, open sockets.
 */
export class GuardedProxy {
  private readonly options: GuardedProxyOptions;
  private readonly resolve: (host: string) => Promise<string[]>;
  private readonly ttl: number;
  private readonly idleMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, { addresses: string[]; expires: number }>();
  private readonly sockets = new Set<Duplex>();
  private readonly username = randomBytes(12).toString("hex");
  private readonly password = randomBytes(24).toString("hex");
  private server: Server | null = null;
  private address: string | null = null;

  constructor(options: GuardedProxyOptions) {
    this.options = options;
    this.resolve = options.resolve ?? defaultResolve;
    this.ttl = options.dnsCacheTtlMs ?? DNS_CACHE_TTL_MS;
    this.idleMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  /** Where clients send their requests, credentials included: `http://user:pass@127.0.0.1:<port>`. */
  get url(): string {
    if (this.address === null) throw new Error("The proxy has not been started");
    return `http://${this.username}:${this.password}@${this.address}`;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => void this.forward(req, res));
    server.maxConnections = this.options.maxConnections ?? MAX_CONNECTIONS;
    server.on("connect", (req, socket, head) => void this.tunnel(req, socket, head));
    server.on("connection", (socket) => this.track(socket));
    server.on("clientError", (_error, socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    this.server = server;
    this.address = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.address = null;
    if (!server) return;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** Remembers a socket so close() can end it, closes it when idle, and swallows its errors. */
  private track(socket: Duplex): void {
    this.sockets.add(socket);
    socket.once("close", () => this.sockets.delete(socket));
    // An error with no listener would be thrown as an uncaught exception: this is the listener.
    socket.on("error", () => socket.destroy());
    if ("setTimeout" in socket) {
      (socket as Socket).setTimeout(this.idleMs, () => socket.destroy());
    }
  }

  private authorized(header: string | undefined): boolean {
    const match = /^Basic\s+(\S+)$/i.exec(header ?? "");
    if (!match) return false;
    return safeEqual(
      Buffer.from(match[1]!, "base64").toString("utf8"),
      `${this.username}:${this.password}`,
    );
  }

  private refused(host: string, status: number): void {
    this.options.onRefused?.({ host, status });
  }

  private async addressesOf(host: string): Promise<string[]> {
    const now = this.now();
    const cached = this.cache.get(host);
    if (cached && cached.expires > now) return cached.addresses;
    let addresses: string[];
    try {
      addresses = await this.resolve(host);
    } catch {
      throw new Refusal(502, host, `Could not resolve ${host}`);
    }
    if (addresses.length === 0) throw new Refusal(502, host, `Could not resolve ${host}`);
    if (this.cache.size >= DNS_CACHE_PRUNE_SIZE) {
      for (const [name, entry] of this.cache) if (entry.expires <= now) this.cache.delete(name);
    }
    this.cache.set(host, { addresses, expires: now + this.ttl });
    return addresses;
  }

  /** The addresses to try, in order: the port must be a web port and every record must be allowed. */
  private async pick(rawHost: string, port: number): Promise<string[]> {
    const host = rawHost.replace(/^\[|\]$/g, "");
    const portAllowed = this.options.isPortAllowed ?? ((p) => ALLOWED_PORTS.includes(p));
    if (!portAllowed(port)) throw new Refusal(403, host, `Port ${port} is not allowed`);
    const addresses = isIP(host) !== 0 ? [host] : await this.addressesOf(host);
    if (addresses.some((address) => this.options.isBlockedAddress(address))) {
      throw new Refusal(403, host, `${host} points to a private or internal address`);
    }
    return addresses;
  }

  /** A connection to the first address that accepts one. */
  private async open(addresses: string[], port: number): Promise<Socket> {
    let last: unknown;
    for (const host of addresses) {
      try {
        return await new Promise<Socket>((resolve, reject) => {
          const socket = connect({ host, port });
          socket.setTimeout(CONNECT_TIMEOUT_MS, () => socket.destroy(new Error("connect timeout")));
          socket.once("connect", () => {
            socket.setTimeout(0);
            resolve(socket);
          });
          socket.once("error", reject);
        });
      } catch (error) {
        last = error;
      }
    }
    throw last instanceof Error ? last : new Error("No address accepted the connection");
  }

  private refuse(res: ServerResponse, status: number, message: string, extra = {}): void {
    if (res.headersSent || res.destroyed) {
      res.destroy();
      return;
    }
    res
      .writeHead(status, { "content-type": "text/plain", connection: "close", ...extra })
      .end(message);
  }

  private async forward(req: IncomingMessage, res: ServerResponse): Promise<void> {
    req.on("error", () => res.destroy());
    if (!this.authorized(req.headers["proxy-authorization"])) {
      this.refused("", 407);
      return this.refuse(res, 407, "Proxy credentials required", {
        "proxy-authenticate": `Basic realm="${AUTH_REALM}"`,
      });
    }
    let url: URL;
    try {
      url = new URL(req.url ?? "");
    } catch {
      return this.refuse(res, 400, "This is a proxy: send the whole address");
    }
    if (url.protocol !== "http:") return this.refuse(res, 400, "Only http goes this way");
    const port = Number(url.port) || 80;
    let addresses: string[];
    try {
      addresses = await this.pick(url.hostname, port);
    } catch (error) {
      const refusal =
        error instanceof Refusal ? error : new Refusal(502, url.hostname, "Lookup failed");
      this.refused(refusal.host, refusal.status);
      return this.refuse(res, refusal.status, refusal.message);
    }
    // The client may have given up while the name was being looked up.
    if (res.destroyed || req.destroyed) return;
    let upstream: Socket;
    try {
      upstream = await this.open(addresses, port);
    } catch {
      return this.refuse(res, 502, "The target could not be reached");
    }
    if (res.destroyed || req.destroyed) {
      upstream.destroy();
      return;
    }
    this.track(upstream);
    upstream.setTimeout(this.idleMs, () => upstream.destroy());
    const out = request({
      method: req.method,
      path: `${url.pathname}${url.search}`,
      headers: { ...withoutHopByHop(req.headers), host: url.host },
      setHost: false,
      // The socket is already connected to an address we checked: the request must use that one.
      agent: new SingleSocketAgent(upstream),
    });
    out.once("response", (response) => {
      response.on("error", () => res.destroy());
      res.writeHead(response.statusCode ?? 502, withoutHopByHop(response.headers));
      response.pipe(res);
    });
    out.once("error", () => this.refuse(res, 502, "The target could not be reached"));
    req.once("aborted", () => out.destroy());
    res.once("close", () => out.destroy());
    req.pipe(out);
  }

  private async tunnel(req: IncomingMessage, client: Duplex, head: Buffer): Promise<void> {
    // The first thing, before any await: a client that resets while we look up the name emits an
    // 'error' that, with no listener, would take the process down.
    let upstream: Socket | undefined;
    client.on("error", () => upstream?.destroy());
    const reply = (status: number, message = "", extra = "") => {
      if (client.destroyed || !client.writable) return;
      client.end(
        `HTTP/1.1 ${status} ${REASONS[status] ?? "Error"}\r\n${extra}Connection: close\r\n` +
          `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
      );
    };
    if (!this.authorized(req.headers["proxy-authorization"])) {
      this.refused("", 407);
      return reply(
        407,
        "Proxy credentials required",
        `Proxy-Authenticate: Basic realm="${AUTH_REALM}"\r\n`,
      );
    }
    const authority = req.url ?? "";
    const colon = authority.lastIndexOf(":");
    const port = Number(authority.slice(colon + 1));
    if (colon <= 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
      return reply(400, "Expected host:port");
    }
    let addresses: string[];
    try {
      addresses = await this.pick(authority.slice(0, colon), port);
    } catch (error) {
      const refusal =
        error instanceof Refusal ? error : new Refusal(502, authority, "Lookup failed");
      this.refused(refusal.host, refusal.status);
      return reply(refusal.status, refusal.message);
    }
    if (client.destroyed) return;
    try {
      upstream = await this.open(addresses, port);
    } catch {
      return reply(502, "The target could not be reached");
    }
    if (client.destroyed) {
      upstream.destroy();
      return;
    }
    this.track(upstream);
    upstream.setTimeout(this.idleMs, () => upstream?.destroy());
    const target = upstream;
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) target.write(head);
    target.pipe(client);
    client.pipe(target);
    target.once("close", () => client.destroy());
    client.once("close", () => target.destroy());
  }
}
