import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/infrastructure/web/app.ts";
import { LoginRateLimiter } from "../src/infrastructure/web/rate-limit.ts";
import { addBevhill, BEVHILL_URL, createHarness, type Harness } from "./harness.ts";

let h: Harness;
let app: ReturnType<typeof createApp>;
let cookie: string;

function build(webRoot?: string) {
  return createApp({
    useCases: h.useCases,
    events: h.bus,
    secureCookies: false,
    sessionTtlMs: 7 * 24 * 3600 * 1000,
    loginLimiter: new LoginRateLimiter({ now: () => h.clock.now() }),
    ...(webRoot ? { webRoot } : {}),
  });
}

beforeEach(async () => {
  h = await createHarness();
  app = build();
  const login = await app.request(
    "/api/auth/login",
    json({ username: "sam", password: "secret" }),
  );
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
});
afterEach(() => h.cleanup());

const json = (body: unknown, extra: RequestInit = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...(extra.headers as Record<string, string>) },
  body: JSON.stringify(body),
});
const authed = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...(init.headers as Record<string, string>), cookie },
});
const post = (path: string, body: unknown) => app.request(path, authed(json(body)));
const get = (path: string) => app.request(path, authed());

describe("health and the /api prefix", () => {
  it("answers /health without a session", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("only mounts the API under /api, with JSON 404s", async () => {
    expect((await app.request("/auth/me")).status).toBe(404);
    const res = await app.request("/api/nope", authed());
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
    expect((await app.request("/api/nope", { method: "POST" })).status).toBe(404);
  });
});

describe("auth", () => {
  it("sets an HttpOnly, SameSite=Strict cookie on login", async () => {
    const res = await app.request(
      "/api/auth/login",
      json({ username: "sam", password: "secret" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "id-sam", userName: "sam" });
    const header = res.headers.get("set-cookie")!;
    expect(header).toMatch(/^hm_session=/);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Strict/i);
    expect(header).toMatch(/Path=\//);
    expect(header).not.toMatch(/Secure/i);
  });

  it("marks the cookie Secure behind HTTPS", async () => {
    const secure = createApp({
      useCases: h.useCases,
      events: h.bus,
      secureCookies: true,
      sessionTtlMs: 1000,
    });
    const res = await secure.request(
      "/api/auth/login",
      json({ username: "sam", password: "secret" }),
    );
    expect(res.headers.get("set-cookie")).toMatch(/Secure/i);
  });

  it("401 for wrong credentials, 403 for a user who is not an administrator", async () => {
    expect(
      (await app.request("/api/auth/login", json({ username: "sam", password: "no" }))).status,
    ).toBe(401);
    h.authenticator.admins.set("kid", "pw");
    h.authenticator.demoted.add("id-kid");
    // The fake authenticates anyone it knows; the real one refuses non-admins with a 403.
    h.deps.authenticator.authenticate = async () => {
      const { AppError } = await import("../src/domain/errors.ts");
      throw new AppError("forbidden", "Only Jellyfin administrators can use Orca'H&M");
    };
    const res = await app.request("/api/auth/login", json({ username: "kid", password: "pw" }));
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("400 for a malformed login", async () => {
    const res = await app.request("/api/auth/login", json({ username: "" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("bad_request");
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("tells who is signed in, and signs out", async () => {
    const me = await get("/api/auth/me");
    expect(await me.json()).toEqual({ userId: "id-sam", userName: "sam" });
    const out = await app.request("/api/auth/logout", authed({ method: "POST" }));
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toMatch(/hm_session=;/);
    expect((await get("/api/auth/me")).status).toBe(401);
  });

  it("401 on every protected route without a session", async () => {
    for (const [method, path] of [
      ["GET", "/api/extractors"],
      ["POST", "/api/series/preview"],
      ["POST", "/api/series"],
      ["GET", "/api/series"],
      ["GET", "/api/series/x"],
      ["GET", "/api/jobs"],
      ["POST", "/api/jobs"],
      ["POST", "/api/jobs/x/retry"],
      ["POST", "/api/jobs/x/cancel"],
      ["GET", "/api/events"],
      ["GET", "/api/auth/me"],
    ] as const) {
      const res = await app.request(path, {
        method,
        ...(method === "POST"
          ? { headers: { "content-type": "application/json" }, body: "{}" }
          : {}),
      });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("401 for a forged or expired cookie", async () => {
    expect(
      (await app.request("/api/auth/me", { headers: { cookie: "hm_session=forged" } })).status,
    ).toBe(401);
    h.clock.advance(8 * 24 * 3600 * 1000);
    expect((await get("/api/auth/me")).status).toBe(401);
  });
});

describe("login rate limit", () => {
  const login = (username: string, password: string) =>
    app.request("/api/auth/login", json({ username, password }));

  it("answers 429 with Retry-After after two wrong passwords, even for the right one", async () => {
    for (let i = 0; i < 2; i++) expect((await login("sam", "wrong")).status).toBe(401);
    const blocked = await login("sam", "secret");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await blocked.json()).toMatchObject({ error: "too_many_attempts" });
    // Another account is still served.
    h.authenticator.admins.set("ana", "pw");
    expect((await login("ana", "pw")).status).toBe(200);
  });

  it("lets at most two of five parallel wrong logins reach Jellyfin", async () => {
    const real = h.authenticator.authenticate.bind(h.authenticator);
    let reached = 0;
    h.authenticator.authenticate = async (username, password) => {
      reached++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return real(username, password);
    };
    const statuses = (
      await Promise.all(Array.from({ length: 5 }, () => login("sam", "wrong")))
    ).map((response) => response.status);
    expect(reached).toBe(2);
    expect(statuses.filter((status) => status === 429)).toHaveLength(3);
  });

  it("lets the user in again after the window", async () => {
    for (let i = 0; i < 2; i++) await login("sam", "wrong");
    h.clock.advance(15 * 60 * 1000 + 1000);
    expect((await login("sam", "secret")).status).toBe(200);
  });
});

describe("request hygiene", () => {
  it("rejects a cross-origin form post (CSRF)", async () => {
    const res = await app.request(
      "/api/series/preview",
      authed({
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://evil.example",
          host: "hm.local",
        },
        body: "url=x",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("413 for a body over the limit", async () => {
    const res = await post("/api/series/preview", { url: "x".repeat(2 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "payload_too_large" });
  });

  it("400 for a body that isn't JSON", async () => {
    const res = await app.request(
      "/api/series/preview",
      authed({ method: "POST", headers: { "content-type": "application/json" }, body: "{nope" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("series routes", () => {
  it("lists the extractors", async () => {
    expect(await (await get("/api/extractors")).json()).toEqual([
      {
        id: "internet-archive",
        name: "Internet Archive",
        hosts: ["archive.org"],
        example: "https://archive.org/details/bevhill-s01e01-36",
      },
    ]);
  });

  it("previews, adds and lists a series", async () => {
    const previewRes = await post("/api/series/preview", { url: BEVHILL_URL });
    expect(previewRes.status).toBe(200);
    const preview = (await previewRes.json()) as { previewId: string; episodes: { key: string }[] };
    expect((await get("/api/series")).status).toBe(200);
    expect(await (await get("/api/series")).json()).toEqual([]);

    const created = await post("/api/series", {
      previewId: preview.previewId,
      title: "The Beverly Hillbillies",
      year: 1962,
      episodeKeys: preview.episodes.map((e) => e.key),
      follow: false,
      downloadNow: false,
      licenseAck: false,
    });
    expect(created.status).toBe(201);
    const series = (await created.json()) as { id: string; episodeCount: number };
    expect(series.episodeCount).toBe(6);

    expect(((await (await get("/api/series")).json()) as unknown[]).length).toBe(1);
    expect((await get(`/api/series/${series.id}`)).status).toBe(200);
    const episodes = (await (await get(`/api/series/${series.id}/episodes`)).json()) as {
      status: string;
    }[];
    expect(episodes).toHaveLength(6);
    expect(episodes[0]?.status).toBe("missing");
  });

  it("400 when the license confirmation is missing, 410 for an expired preview, 409 for a repeat", async () => {
    const preview = (await (await post("/api/series/preview", { url: BEVHILL_URL })).json()) as {
      previewId: string;
      episodes: { key: string }[];
    };
    const body = {
      previewId: preview.previewId,
      title: "T",
      year: 1982,
      episodeKeys: [preview.episodes[0]!.key],
      follow: false,
      downloadNow: false,
      licenseAck: false,
    };
    const refused = await post("/api/series", body);
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { message: string }).message).toMatch(/license_ack_required/);

    expect((await post("/api/series", { ...body, licenseAck: true })).status).toBe(201);
    expect((await post("/api/series", { ...body, licenseAck: true })).status).toBe(409);
    expect(
      (await post("/api/series", { ...body, previewId: "unknown", licenseAck: true })).status,
    ).toBe(410);
  });

  it("maps extractor failures to statuses", async () => {
    expect((await post("/api/series/preview", { url: "https://example.com/x" })).status).toBe(400);
    expect(
      (await post("/api/series/preview", { url: "https://archive.org/search?query=x" })).status,
    ).toBe(400);
    expect(
      (await post("/api/series/preview", { url: "https://archive.org/details/not-in-fixtures" }))
        .status,
    ).toBe(404);
    expect((await post("/api/series/preview", {})).status).toBe(400);
  });

  it("patches a series and 404s an unknown one", async () => {
    const { series } = await addBevhill(h);
    const res = await app.request(
      `/api/series/${series.id}`,
      authed({ ...json({ follow: true, checkIntervalHours: 6 }), method: "PATCH" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ follow: true, checkIntervalHours: 6 });
    expect(
      (
        await app.request(
          "/api/series/nope",
          authed({ ...json({ follow: true }), method: "PATCH" }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          `/api/series/${series.id}`,
          authed({ ...json({ checkIntervalHours: 0 }), method: "PATCH" }),
        )
      ).status,
    ).toBe(400);
    expect((await get("/api/series/nope")).status).toBe(404);
  });

  it("serves the poster, or 404s when there is none", async () => {
    const { series } = await addBevhill(h);
    const res = await get(`/api/series/${series.id}/poster`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3]);

    await rm(join(h.root, "The Beverly Hillbillies (1962)", "poster.jpg"));
    expect((await get(`/api/series/${series.id}/poster`)).status).toBe(404);
    expect((await get("/api/series/nope/poster")).status).toBe(404);
  });
});

describe("job routes", () => {
  it("enqueues downloads, lists jobs with filters and pages, retries and cancels", async () => {
    const { series } = await addBevhill(h);
    const episodes = (await (await get(`/api/series/${series.id}/episodes`)).json()) as {
      id: string;
    }[];
    const enqueued = await post("/api/jobs", { episodeIds: episodes.slice(0, 2).map((e) => e.id) });
    expect(enqueued.status).toBe(201);
    await h.queue.settle();

    const all = (await (await get("/api/jobs?limit=1")).json()) as {
      items: { status: string; seriesTitle: string }[];
      nextCursor: string | null;
    };
    expect(all.items).toHaveLength(1);
    expect(all.nextCursor).toBeTruthy();
    const page2 = (await (await get(`/api/jobs?limit=50&cursor=${all.nextCursor}`)).json()) as {
      items: unknown[];
    };
    expect(page2.items.length).toBeGreaterThan(0);

    const done = (await (await get("/api/jobs?status=done,failed")).json()) as {
      items: { status: string }[];
    };
    expect(done.items.every((j) => j.status === "done")).toBe(true);
    expect((await get("/api/jobs?status=bogus")).status).toBe(400);
    expect((await get("/api/jobs?limit=0")).status).toBe(400);

    const jobId = (done.items[0] as unknown as { id: string }).id;
    expect((await app.request(`/api/jobs/${jobId}/retry`, authed({ method: "POST" }))).status).toBe(
      409,
    );
    expect((await app.request("/api/jobs/nope/retry", authed({ method: "POST" }))).status).toBe(
      404,
    );
    expect((await app.request("/api/jobs/nope/cancel", authed({ method: "POST" }))).status).toBe(
      404,
    );
    expect((await post("/api/jobs", { episodeIds: [] })).status).toBe(400);
  });

  it("downloads a whole series from /series/:id/download", async () => {
    const { series } = await addBevhill(h);
    const res = await app.request(`/api/series/${series.id}/download`, authed({ method: "POST" }));
    expect(res.status).toBe(201);
    expect(((await res.json()) as unknown[]).length).toBe(6);
    await h.queue.settle();
    expect(h.downloader.calls).toHaveLength(6);
  });
});

describe("GET /api/events (SSE)", () => {
  it("streams a ping first, then the events as they happen", async () => {
    const res = await get("/api/events");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    const first = decoder.decode((await reader.read()).value);
    expect(first).toContain("event: ping");

    h.bus.publish({ type: "series.updated", seriesId: "s1" });
    let received = "";
    while (!received.includes("series.updated"))
      received += decoder.decode((await reader.read()).value);
    expect(received).toContain("event: series.updated");
    expect(received).toMatch(/id: \d+/);
    expect(received).toContain('"seriesId":"s1"');
    await reader.cancel();
  });
});

describe("serving the panel (webRoot)", () => {
  let web: string;
  beforeEach(async () => {
    web = await mkdtemp(join(tmpdir(), "hm-web-"));
    await mkdir(join(web, "assets"));
    await writeFile(join(web, "index.html"), "<!doctype html><title>panel</title>");
    await writeFile(join(web, "assets", "app.js"), "console.log(1)");
    app = build(web);
  });
  afterEach(() => rm(web, { recursive: true, force: true }));

  it("serves files and falls back to index.html for history routes", async () => {
    const js = await app.request("/assets/app.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toMatch(/javascript/);
    expect(await (await app.request("/series/123")).text()).toContain("<title>panel</title>");
    expect(await (await app.request("/")).text()).toContain("<title>panel</title>");
  });

  it("keeps the API and health out of the fallback, and refuses path traversal", async () => {
    expect((await app.request("/api/nope")).status).toBe(404);
    expect(((await (await app.request("/api/nope")).json()) as { error: string }).error).toBe(
      "not_found",
    );
    expect((await app.request("/health")).status).toBe(200);
    const escaped = await app.request("/..%2f..%2fetc%2fpasswd");
    expect(await escaped.text()).toContain("<title>panel</title>");
  });

  it("doesn't serve a panel when none is configured", async () => {
    app = build();
    expect((await app.request("/")).status).toBe(404);
  });
});
