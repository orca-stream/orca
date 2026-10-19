import { createServer, request, type IncomingMessage, type Server } from "node:http";
import {
  connect,
  createServer as createTcpServer,
  type AddressInfo,
  type Server as TcpServer,
} from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { GuardedProxy, type GuardedProxyOptions } from "./proxy.ts";

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
let refusals: { host: string; status: number }[];

const listen = (server: Server | TcpServer, host: string) =>
  new Promise<number>((resolve) =>
    server.listen(0, host, () => resolve((server.address() as AddressInfo).port)),
  );

beforeEach(async () => {
  privateHits = [];
  publicSeen = [];
  resolveCalls = [];
  refusals = [];
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
    // The test servers listen on ephemeral ports; the port rule has its own tests below.
    isPortAllowed: () => true,
    onRefused: (refusal) => refusals.push(refusal),
  });
  await proxy.start();
});

afterEach(async () => {
  await proxy.close();
  await new Promise((resolve) => publicServer.close(resolve));
  await new Promise((resolve) => privateServer.close(resolve));
});

/** What a client has to send to be let in: the credentials the proxy made up at start. */
const basic = (proxyUrl: string) => {
  const { username, password } = new URL(proxyUrl);
  return `Basic ${Buffer.from(`${decodeURIComponent(username)}:${decodeURIComponent(password)}`).toString("base64")}`;
};

/** A request the way a browser sends it to a forward proxy: the whole address on the request line. */
function viaProxy(
  target: string,
  options: { path?: string; headers?: Record<string, string>; auth?: string | false } = {},
) {
  const proxyUrl = new URL(proxy.url);
  return new Promise<{ status: number; headers: IncomingMessage["headers"]; body: string }>(
    (resolve, reject) => {
      const req = request(
        {
          host: proxyUrl.hostname,
          port: Number(proxyUrl.port),
          path: options.path ?? target,
          headers: {
            host: new URL(target).host,
            ...(options.auth === false
              ? {}
              : { "proxy-authorization": options.auth ?? basic(proxy.url) }),
            ...options.headers,
          },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
          // A response cut short never "ends": it errors or just closes.
          res.on("error", reject);
          res.on("close", () => reject(new Error("closed before the end")));
        },
      );
      req.on("error", reject);
      req.end();
    },
  );
}

/** `CONNECT host:port`, the way a browser opens a tunnel; resolves with the status line and the socket. */
function connectThrough(authority: string, auth: string | false = basic(proxy.url)) {
  const proxyUrl = new URL(proxy.url);
  return new Promise<{ status: number; socket: ReturnType<typeof connect>; rest: string }>(
    (resolve, reject) => {
      const socket = connect(Number(proxyUrl.port), proxyUrl.hostname, () => {
        const credentials = auth === false ? "" : `Proxy-Authorization: ${auth}\r\n`;
        socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${credentials}\r\n`);
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

/** A second proxy with its own options, on the same fake network. */
async function another(options: Partial<GuardedProxyOptions> = {}) {
  const extra = new GuardedProxy({
    isBlockedAddress: (address) => !["127.0.0.2", "127.0.0.3"].includes(address),
    resolve: async (host) => table[host] ?? Promise.reject(new Error("ENOTFOUND")),
    isPortAllowed: () => true,
    ...options,
  });
  await extra.start();
  return extra;
}

/** Sends one raw CONNECT to a proxy and gives back the socket and what came back first. */
function rawConnect(target: GuardedProxy, authority: string, auth: string | false) {
  const url = new URL(target.url);
  return new Promise<{ socket: ReturnType<typeof connect>; first: string }>((resolve, reject) => {
    const socket = connect(Number(url.port), url.hostname, () => {
      const header = auth === false ? "" : `Proxy-Authorization: ${auth}\r\n`;
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${header}\r\n`);
    });
    socket.setEncoding("utf8");
    socket.once("data", (first: Buffer | string) => resolve({ socket, first: String(first) }));
    socket.once("error", reject);
  });
}

describe("GuardedProxy and clients that go away", () => {
  it("survives a client that resets the connection while the name is being resolved", async () => {
    let release!: () => void;
    const slow = await another({
      resolve: async () => {
        await new Promise<void>((resolve) => (release = resolve));
        return [PUBLIC];
      },
    });
    const url = new URL(slow.url);
    const uncaught: unknown[] = [];
    const record = (error: unknown) => void uncaught.push(error);
    process.on("uncaughtException", record);
    try {
      const socket = connect(Number(url.port), url.hostname, () => {
        socket.write(
          `CONNECT slow.test:443 HTTP/1.1\r\nHost: slow.test:443\r\nProxy-Authorization: ${basic(slow.url)}\r\n\r\n`,
        );
        setTimeout(() => socket.resetAndDestroy(), 30);
      });
      socket.on("error", () => {});
      await new Promise((resolve) => setTimeout(resolve, 100));
      release();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(uncaught).toEqual([]);
    } finally {
      process.off("uncaughtException", record);
      await slow.close();
    }
  });

  it("survives a client that goes away while a forwarded request waits for its name", async () => {
    let release!: () => void;
    const slow = await another({
      resolve: async () => {
        await new Promise<void>((resolve) => (release = resolve));
        return [PUBLIC];
      },
    });
    const url = new URL(slow.url);
    const uncaught: unknown[] = [];
    const record = (error: unknown) => void uncaught.push(error);
    process.on("uncaughtException", record);
    try {
      const socket = connect(Number(url.port), url.hostname, () => {
        socket.write(
          `GET http://slow.test:${publicPort}/x HTTP/1.1\r\nHost: slow.test\r\nProxy-Authorization: ${basic(slow.url)}\r\n\r\n`,
        );
        setTimeout(() => socket.resetAndDestroy(), 30);
      });
      socket.on("error", () => {});
      await new Promise((resolve) => setTimeout(resolve, 100));
      release();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(uncaught).toEqual([]);
      expect(publicSeen).toEqual([]);
    } finally {
      process.off("uncaughtException", record);
      await slow.close();
    }
  });

  it("survives a target that resets the connection halfway through a response", async () => {
    const broken = createTcpServer((socket) => {
      socket.once("data", () => {
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 100000\r\n\r\npartial");
        setTimeout(() => socket.resetAndDestroy(), 30);
      });
    });
    const port = await listen(broken, PUBLIC);
    const uncaught: unknown[] = [];
    const record = (error: unknown) => void uncaught.push(error);
    process.on("uncaughtException", record);
    try {
      await viaProxy(`http://${PUBLIC}:${port}/`).catch(() => null);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(uncaught).toEqual([]);
      expect((await viaProxy(`http://${PUBLIC}:${publicPort}/after`)).status).toBe(200);
    } finally {
      process.off("uncaughtException", record);
      await new Promise((resolve) => broken.close(resolve));
    }
  });
});

describe("GuardedProxy and ports", () => {
  it("lets only the web's ports through by default, for tunnels and forwarded requests", async () => {
    const strict = await another({ isPortAllowed: undefined });
    table["site.test"] = [PUBLIC];
    try {
      for (const port of [22, 25, 3306, 6379, 8096, 8787]) {
        const { socket, first } = await rawConnect(strict, `site.test:${port}`, basic(strict.url));
        expect(first, `CONNECT ${port}`).toMatch(/^HTTP\/1\.1 403/);
        socket.destroy();
      }
      const url = new URL(strict.url);
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(
          {
            host: url.hostname,
            port: Number(url.port),
            path: "http://site.test:8096/System/Info",
            headers: { "proxy-authorization": basic(strict.url) },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.end();
      });
      expect(status).toBe(403);
      expect(resolveCalls).toEqual([]);
      // 443 is a web port: it gets as far as connecting (and finds nobody home).
      const { socket, first } = await rawConnect(strict, "site.test:443", basic(strict.url));
      expect(first).not.toMatch(/^HTTP\/1\.1 403/);
      socket.destroy();
    } finally {
      await strict.close();
    }
  });
});

describe("GuardedProxy credentials", () => {
  it("makes up its own for every start, and puts them in its address", async () => {
    const other = await another();
    try {
      const a = new URL(proxy.url);
      const b = new URL(other.url);
      expect(a.username).not.toBe("");
      expect(a.password).not.toBe("");
      expect([a.username, a.password]).not.toEqual([b.username, b.password]);
    } finally {
      await other.close();
    }
  });

  it("answers 407 to a request or a tunnel without them, or with the wrong ones, and connects to nothing", async () => {
    const none = await viaProxy(`http://${PUBLIC}:${publicPort}/x`, { auth: false });
    expect(none.status).toBe(407);
    expect(none.headers["proxy-authenticate"]).toMatch(/^Basic/);
    const wrong = await viaProxy(`http://${PUBLIC}:${publicPort}/x`, {
      auth: `Basic ${Buffer.from("nope:nope").toString("base64")}`,
    });
    expect(wrong.status).toBe(407);
    expect(publicSeen).toEqual([]);
    expect((await connectThrough(`${PUBLIC}:${publicPort}`, false)).status).toBe(407);
    expect((await connectThrough(`${PUBLIC}:${publicPort}`, "Bearer abc")).status).toBe(407);
  });
});

describe("GuardedProxy and several addresses", () => {
  it("tries each address it checked, in order, before giving up", async () => {
    const both = await another();
    // 127.0.0.3 is allowed but nothing listens there: the next address is the one that works.
    table["flaky.test"] = ["127.0.0.3", PUBLIC];
    try {
      const url = new URL(both.url);
      const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request(
          {
            host: url.hostname,
            port: Number(url.port),
            path: `http://flaky.test:${publicPort}/hello`,
            headers: { "proxy-authorization": basic(both.url), host: `flaky.test:${publicPort}` },
          },
          (r) => {
            let body = "";
            r.setEncoding("utf8");
            r.on("data", (c: string) => (body += c));
            r.on("end", () => resolve({ status: r.statusCode ?? 0, body }));
          },
        );
        req.on("error", reject);
        req.end();
      });
      expect(res).toEqual({ status: 200, body: "public:/hello" });

      const echo = createTcpServer((socket) => socket.pipe(socket));
      const echoPort = await listen(echo, PUBLIC);
      const tunnel = await rawConnect(both, `flaky.test:${echoPort}`, basic(both.url));
      expect(tunnel.first).toMatch(/^HTTP\/1\.1 200/);
      tunnel.socket.destroy();
      await new Promise((resolve) => echo.close(resolve));
    } finally {
      await both.close();
    }
  });

  it("answers 502 only when none of them accepts", async () => {
    const both = await another();
    table["dead.test"] = ["127.0.0.3"];
    try {
      const { first, socket } = await rawConnect(both, "dead.test:9", basic(both.url));
      expect(first).toMatch(/^HTTP\/1\.1 502/);
      socket.destroy();
    } finally {
      await both.close();
    }
  });
});

describe("GuardedProxy limits", () => {
  it("closes a tunnel that has been idle for too long", async () => {
    const quick = await another({ idleTimeoutMs: 80 });
    const echo = createTcpServer((socket) => socket.pipe(socket));
    const echoPort = await listen(echo, PUBLIC);
    try {
      const { socket, first } = await rawConnect(quick, `${PUBLIC}:${echoPort}`, basic(quick.url));
      expect(first).toMatch(/^HTTP\/1\.1 200/);
      const closed = new Promise<number>((resolve) => {
        const started = Date.now();
        socket.once("close", () => resolve(Date.now() - started));
      });
      expect(await closed).toBeLessThan(1_000);
    } finally {
      await quick.close();
      await new Promise((resolve) => echo.close(resolve));
    }
  });

  it("gives up on a target that never answers a forwarded request", async () => {
    const quick = await another({ idleTimeoutMs: 80 });
    // It reads and says nothing: unread, it would never notice the proxy hanging up.
    const silent = createTcpServer((socket) => void socket.resume());
    const port = await listen(silent, PUBLIC);
    try {
      const url = new URL(quick.url);
      const outcome = await new Promise<string>((resolve) => {
        const req = request(
          {
            host: url.hostname,
            port: Number(url.port),
            path: `http://${PUBLIC}:${port}/x`,
            headers: { "proxy-authorization": basic(quick.url) },
          },
          (res) => {
            res.resume();
            resolve(`status ${res.statusCode}`);
          },
        );
        req.on("error", () => resolve("closed"));
        req.end();
      });
      expect(["status 502", "closed"]).toContain(outcome);
    } finally {
      await quick.close();
      await new Promise((resolve) => silent.close(resolve));
    }
  });

  it("refuses connections beyond its limit", async () => {
    const small = await another({ maxConnections: 2 });
    const url = new URL(small.url);
    const open = () =>
      new Promise<ReturnType<typeof connect>>((resolve) => {
        const socket = connect(Number(url.port), url.hostname, () => resolve(socket));
        socket.on("error", () => {});
      });
    const held = [await open(), await open()];
    try {
      const third = await open();
      const closed = await Promise.race([
        new Promise<boolean>((resolve) => third.once("close", () => resolve(true))),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
      ]);
      expect(closed).toBe(true);
    } finally {
      for (const socket of held) socket.destroy();
      await small.close();
    }
  });
});

describe("GuardedProxy and hop-by-hop headers", () => {
  it("does not hand a request's one-hop headers on, including the ones Connection names", async () => {
    await viaProxy(`http://${PUBLIC}:${publicPort}/x`, {
      headers: {
        connection: "x-hop, keep-alive",
        "x-hop": "secret",
        "keep-alive": "timeout=5",
        "x-kept": "yes",
        te: "trailers",
      },
    });
    const headers = publicSeen[0]!.headers;
    expect(headers["x-hop"]).toBeUndefined();
    expect(headers["keep-alive"]).toBeUndefined();
    expect(headers["te"]).toBeUndefined();
    expect(headers["x-kept"]).toBe("yes");
  });

  it("does not hand a response's one-hop headers on either", async () => {
    const odd = createServer((_req, res) => {
      res.writeHead(200, {
        connection: "x-private, close",
        "x-private": "inside",
        "keep-alive": "timeout=77",
        "proxy-authenticate": "Basic realm=upstream",
        "x-kept": "yes",
      });
      res.end("ok");
    });
    const port = await listen(odd, PUBLIC);
    try {
      const res = await viaProxy(`http://${PUBLIC}:${port}/`);
      expect(res.headers["x-private"]).toBeUndefined();
      // The proxy's own connection may say its own Keep-Alive; the target's is not passed on.
      expect(res.headers["keep-alive"] ?? "").not.toContain("77");
      expect(res.headers["proxy-authenticate"]).toBeUndefined();
      expect(res.headers["x-kept"]).toBe("yes");
    } finally {
      await new Promise((resolve) => odd.close(resolve));
    }
  });
});

describe("GuardedProxy reports what it refuses", () => {
  it("tells onRefused about a blocked target, with the status it answered", async () => {
    await viaProxy(`http://${PRIVATE}:${privatePort}/secret`);
    expect(refusals).toEqual([{ host: PRIVATE, status: 403 }]);
  });
});
