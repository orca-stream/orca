import { lookup } from "node:dns/promises";
import {
  createServer,
  request,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { connect, isIP, type AddressInfo, type Socket } from "node:net";
import type { Duplex } from "node:stream";

/** How long a name's addresses are trusted: long enough to check once per page, short enough to follow DNS. */
export const DNS_CACHE_TTL_MS = 30_000;
/** How long to wait for the target to accept a connection. */
export const CONNECT_TIMEOUT_MS = 15_000;
/** Above this many cached names, the expired ones are dropped. */
const DNS_CACHE_PRUNE_SIZE = 256;

/** Headers that belong to one hop, not to the request being forwarded. */
const HOP_BY_HOP = [
  "connection",
  "proxy-connection",
  "proxy-authorization",
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
  dnsCacheTtlMs?: number;
  now?: () => number;
}

/** A target that may not be reached (403) or could not be looked up (502). */
class Refusal extends Error {
  readonly status: 403 | 502;
  constructor(status: 403 | 502, message: string) {
    super(message);
    this.status = status;
  }
}

const defaultResolve = async (host: string): Promise<string[]> =>
  (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

const REASONS: Record<number, string> = {
  200: "Connection Established",
  400: "Bad Request",
  403: "Forbidden",
  502: "Bad Gateway",
};

/**
 * A forward proxy (plain HTTP and CONNECT) on 127.0.0.1 that only lets traffic reach public
 * addresses. It resolves each name itself, refuses it if any record is blocked, and connects to the
 * very IP it checked, so a name that changes its answer afterwards (DNS rebinding) gains nothing.
 * Redirects are not followed here: the client sends the next hop as a new request, which is checked
 * like the first. A browser and ffmpeg are both pointed at it, which covers what only they can do:
 * follow redirects, fetch segments and keys, open sockets.
 */
export class GuardedProxy {
  private readonly options: GuardedProxyOptions;
  private readonly resolve: (host: string) => Promise<string[]>;
  private readonly ttl: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, { addresses: string[]; expires: number }>();
  private readonly sockets = new Set<Duplex>();
  private server: Server | null = null;
  private address: string | null = null;

  constructor(options: GuardedProxyOptions) {
    this.options = options;
    this.resolve = options.resolve ?? defaultResolve;
    this.ttl = options.dnsCacheTtlMs ?? DNS_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /** Where clients send their requests: `http://127.0.0.1:<port>`. */
  get url(): string {
    if (this.address === null) throw new Error("The proxy has not been started");
    return this.address;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => void this.forward(req, res));
    server.on("connect", (req, socket, head) => void this.tunnel(req, socket, head));
    server.on("connection", (socket) => this.track(socket));
    server.on("clientError", (_error, socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    this.server = server;
    this.address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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

  private track(socket: Duplex): void {
    this.sockets.add(socket);
    socket.once("close", () => this.sockets.delete(socket));
  }

  private async addressesOf(host: string): Promise<string[]> {
    const now = this.now();
    const cached = this.cache.get(host);
    if (cached && cached.expires > now) return cached.addresses;
    let addresses: string[];
    try {
      addresses = await this.resolve(host);
    } catch {
      throw new Refusal(502, `Could not resolve ${host}`);
    }
    if (addresses.length === 0) throw new Refusal(502, `Could not resolve ${host}`);
    if (this.cache.size >= DNS_CACHE_PRUNE_SIZE) {
      for (const [name, entry] of this.cache) if (entry.expires <= now) this.cache.delete(name);
    }
    this.cache.set(host, { addresses, expires: now + this.ttl });
    return addresses;
  }

  /** The one IP to connect to: every record of the name has to be allowed. */
  private async pick(rawHost: string): Promise<string> {
    const host = rawHost.replace(/^\[|\]$/g, "");
    const addresses = isIP(host) !== 0 ? [host] : await this.addressesOf(host);
    if (addresses.some((address) => this.options.isBlockedAddress(address))) {
      throw new Refusal(403, `${host} points to a private or internal address`);
    }
    return addresses[0]!;
  }

  private refuse(res: ServerResponse, status: number, message: string): void {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(status, { "content-type": "text/plain", connection: "close" }).end(message);
  }

  private async forward(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let url: URL;
    try {
      url = new URL(req.url ?? "");
    } catch {
      return this.refuse(res, 400, "This is a proxy: send the whole address");
    }
    if (url.protocol !== "http:") return this.refuse(res, 400, "Only http goes this way");
    let ip: string;
    try {
      ip = await this.pick(url.hostname);
    } catch (error) {
      const refusal = error instanceof Refusal ? error : new Refusal(502, "Lookup failed");
      return this.refuse(res, refusal.status, refusal.message);
    }
    const out = request({
      host: ip,
      port: Number(url.port) || 80,
      method: req.method,
      path: `${url.pathname}${url.search}`,
      headers: forwardedHeaders(req.headers, url.host),
      setHost: false,
    });
    this.track(out as unknown as Duplex);
    out.once("response", (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    });
    out.once("error", () => this.refuse(res, 502, "The target could not be reached"));
    req.once("aborted", () => out.destroy());
    res.once("close", () => out.destroy());
    req.pipe(out);
  }

  private async tunnel(req: IncomingMessage, client: Duplex, head: Buffer): Promise<void> {
    const reply = (status: number, message?: string) => {
      client.end(
        `HTTP/1.1 ${status} ${REASONS[status] ?? "Error"}\r\nConnection: close\r\n` +
          `Content-Length: ${Buffer.byteLength(message ?? "")}\r\n\r\n${message ?? ""}`,
      );
    };
    const authority = req.url ?? "";
    const colon = authority.lastIndexOf(":");
    const port = Number(authority.slice(colon + 1));
    if (colon <= 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
      return reply(400, "Expected host:port");
    }
    let ip: string;
    try {
      ip = await this.pick(authority.slice(0, colon));
    } catch (error) {
      const refusal = error instanceof Refusal ? error : new Refusal(502, "Lookup failed");
      return reply(refusal.status, refusal.message);
    }
    const upstream: Socket = connect({ host: ip, port });
    this.track(upstream);
    upstream.setTimeout(CONNECT_TIMEOUT_MS, () => upstream.destroy(new Error("connect timeout")));
    let open = false;
    upstream.once("connect", () => {
      open = true;
      upstream.setTimeout(0);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.once("error", () => {
      if (open) client.destroy();
      else reply(502, "The target could not be reached");
    });
    upstream.once("close", () => client.destroy());
    client.once("close", () => upstream.destroy());
    client.on("error", () => upstream.destroy());
  }
}

function forwardedHeaders(headers: IncomingHttpHeaders, host: string): IncomingHttpHeaders {
  const kept: IncomingHttpHeaders = { ...headers };
  for (const name of HOP_BY_HOP) delete kept[name];
  kept["host"] = host;
  return kept;
}
