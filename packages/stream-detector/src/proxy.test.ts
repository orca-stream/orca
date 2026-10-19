import { createServer, request, type IncomingMessage, type Server } from "node:http";
import {
  connect,
  createServer as createTcpServer,
  type AddressInfo,
  type Server as TcpServer,
} from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { GuardedProxy } from "./proxy.ts";

/**
 * "Public" and "private" are two loopback addresses: 127.0.0.2 stands for a site anyone may reach,
 * 127.0.0.1 for the server's own network. The proxy under test is told only the first is allowed.
 */
const PUBLIC = "127.0.0.2";
const PRIVATE = "127.0.0.1";
const isBlockedAddress = (address: string) => address !== PUBLIC;

let publicServer: Server;
let privateServer: Server;
let publicPort: number;
let privatePort: number;
let privateHits: string[];
let publicSeen: IncomingMessage[];
let proxy: GuardedProxy;
let resolveCalls: string[];
let table: Record<string, string[]>;
let clock: number;

const listen = (server: Server | TcpServer, host: string) =>
  new Promise<number>((resolve) =>
    server.listen(0, host, () => resolve((server.address() as AddressInfo).port)),
  );

beforeEach(async () => {
  privateHits = [];
  publicSeen = [];
  resolveCalls = [];
  clock = 1_000;
  table = {};
  privateServer = createServer((req, res) => {
    privateHits.push(req.url ?? "");
    res.writeHead(200).end("the secret");
  });
  privatePort = await listen(privateServer, PRIVATE);
  publicServer = createServer((req, res) => {
    publicSeen.push(req);
    if (req.url?.startsWith("/redirect")) {
      res.writeHead(302, { location: `http://${PRIVATE}:${privatePort}/secret` }).end();
    } else {
      res.writeHead(200, { "content-type": "text/plain", "x-seen-host": req.headers.host ?? "" });
      res.end(`public:${req.url}`);
    }
  });
  publicPort = await listen(publicServer, PUBLIC);
  proxy = new GuardedProxy({
    isBlockedAddress,
    resolve: async (host) => {
      resolveCalls.push(host);
      const found = table[host];
      if (!found) throw new Error(`ENOTFOUND ${host}`);
      return found;
    },
    dnsCacheTtlMs: 5_000,
    now: () => clock,
  });
  await proxy.start();
});

afterEach(async () => {
  await proxy.close();
  await new Promise((resolve) => publicServer.close(resolve));
  await new Promise((resolve) => privateServer.close(resolve));
});

/** A request the way a browser sends it to a forward proxy: the whole address on the request line. */
function viaProxy(target: string, options: { path?: string } = {}) {
  const proxyUrl = new URL(proxy.url);
  return new Promise<{ status: number; headers: IncomingMessage["headers"]; body: string }>(
    (resolve, reject) => {
      const req = request(
        {
          host: proxyUrl.hostname,
          port: Number(proxyUrl.port),
          path: options.path ?? target,
          headers: { host: new URL(target).host },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
        },
      );
      req.on("error", reject);
      req.end();
    },
  );
}

/** `CONNECT host:port`, the way a browser opens a tunnel; resolves with the status line and the socket. */
function connectThrough(authority: string) {
  const proxyUrl = new URL(proxy.url);
  return new Promise<{ status: number; socket: ReturnType<typeof connect>; rest: string }>(
    (resolve, reject) => {
      const socket = connect(Number(proxyUrl.port), proxyUrl.hostname, () => {
        socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
      });
      let buffer = "";
      socket.setEncoding("utf8");
      const onData = (chunk: string) => {
        buffer += chunk;
        const end = buffer.indexOf("\r\n\r\n");
        if (end === -1) return;
        socket.off("data", onData);
        const status = Number(/^HTTP\/1\.\d (\d{3})/.exec(buffer)?.[1]);
        resolve({ status, socket, rest: buffer.slice(end + 4) });
      };
      socket.on("data", onData);
      socket.on("error", reject);
    },
  );
}

describe("GuardedProxy forwarding", () => {
  it("listens on loopback on a port of its own", () => {
    const url = new URL(proxy.url);
    expect(url.hostname).toBe("127.0.0.1");
    expect(Number(url.port)).toBeGreaterThan(0);
  });

  it("forwards a request to an allowed address, keeping the path, the query and the Host", async () => {
    const res = await viaProxy(`http://${PUBLIC}:${publicPort}/a/b.m3u8?token=1`);
    expect(res.status).toBe(200);
    expect(res.body).toBe("public:/a/b.m3u8?token=1");
    expect(res.headers["x-seen-host"]).toBe(`${PUBLIC}:${publicPort}`);
  });

  it("does not pass the proxy's own headers on to the site", async () => {
    await viaProxy(`http://${PUBLIC}:${publicPort}/x`);
    const headers = publicSeen[0]!.headers;
    expect(headers["proxy-connection"]).toBeUndefined();
    expect(headers["proxy-authorization"]).toBeUndefined();
  });

  it("refuses an address that is not allowed, and never connects to it", async () => {
    const res = await viaProxy(`http://${PRIVATE}:${privatePort}/secret`);
    expect(res.status).toBe(403);
    expect(privateHits).toEqual([]);
  });

  it("does not follow a redirect: the next hop is a new request, and it is checked", async () => {
    const first = await viaProxy(`http://${PUBLIC}:${publicPort}/redirect`);
    expect(first.status).toBe(302);
    const next = first.headers.location!;
    expect(next).toBe(`http://${PRIVATE}:${privatePort}/secret`);
    expect((await viaProxy(next)).status).toBe(403);
    expect(privateHits).toEqual([]);
  });

  it("answers 400 to a request that is not a proxy request, and 502 to a name that does not resolve", async () => {
    expect((await viaProxy(`http://${PUBLIC}:${publicPort}/x`, { path: "/x" })).status).toBe(400);
    expect((await viaProxy("http://nowhere.test/x")).status).toBe(502);
  });
});

describe("GuardedProxy and names", () => {
  it("refuses a name when any of its records is not allowed", async () => {
    table["mixed.test"] = [PUBLIC, PRIVATE];
    table["inside.test"] = [PRIVATE];
    expect((await viaProxy(`http://mixed.test:${publicPort}/x`)).status).toBe(403);
    expect((await viaProxy(`http://inside.test:${privatePort}/x`)).status).toBe(403);
    expect(privateHits).toEqual([]);
  });

  it("connects to the address it resolved, not to whatever the name means a moment later", async () => {
    // The system resolver knows nothing of this name: only connecting to the checked IP can work.
    table["site.test"] = [PUBLIC];
    const res = await viaProxy(`http://site.test:${publicPort}/hello`);
    expect(res.status).toBe(200);
    expect(res.body).toBe("public:/hello");
    expect(res.headers["x-seen-host"]).toBe(`site.test:${publicPort}`);
  });

  it("resolves a name once for a short while, then asks again", async () => {
    table["site.test"] = [PUBLIC];
    await viaProxy(`http://site.test:${publicPort}/1`);
    await viaProxy(`http://site.test:${publicPort}/2`);
    expect(resolveCalls).toEqual(["site.test"]);
    clock += 5_001;
    table["site.test"] = [PRIVATE]; // the name moved: after the cache expires it is checked again
    expect((await viaProxy(`http://site.test:${privatePort}/3`)).status).toBe(403);
    expect(resolveCalls).toEqual(["site.test", "site.test"]);
  });

  it("does not let a cached answer outlive a refusal: a blocked name stays blocked for the whole window", async () => {
    table["site.test"] = [PRIVATE];
    expect((await viaProxy(`http://site.test:${privatePort}/1`)).status).toBe(403);
    table["site.test"] = [PUBLIC];
    expect((await viaProxy(`http://site.test:${publicPort}/2`)).status).toBe(403);
    expect(resolveCalls).toEqual(["site.test"]);
  });
});

describe("GuardedProxy tunnels", () => {
  let echo: TcpServer;
  let echoPort: number;
  beforeEach(async () => {
    echo = createTcpServer((socket) => socket.pipe(socket));
    echoPort = await listen(echo, PUBLIC);
  });
  afterEach(async () => {
    await new Promise((resolve) => echo.close(resolve));
  });

  it("opens a CONNECT tunnel to an allowed address and carries bytes both ways", async () => {
    const { status, socket } = await connectThrough(`${PUBLIC}:${echoPort}`);
    expect(status).toBe(200);
    const echoed = new Promise<string>((resolve) => socket.once("data", (d) => resolve(String(d))));
    socket.write("ping");
    expect(await echoed).toBe("ping");
    socket.destroy();
  });

  it("refuses to tunnel to an address that is not allowed", async () => {
    const { status, socket } = await connectThrough(`${PRIVATE}:${privatePort}`);
    expect(status).toBe(403);
    expect(privateHits).toEqual([]);
    socket.destroy();
  });

  it("refuses a tunnel to a name that points inside, and answers 502 for one that does not resolve", async () => {
    table["inside.test"] = [PRIVATE];
    expect((await connectThrough(`inside.test:${privatePort}`)).status).toBe(403);
    expect((await connectThrough("nowhere.test:443")).status).toBe(502);
  });

  it("closes the tunnels it opened when it is closed", async () => {
    const { socket } = await connectThrough(`${PUBLIC}:${echoPort}`);
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    await proxy.close();
    await closed;
  });
});
