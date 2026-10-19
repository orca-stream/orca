import { describe, expect, it, vi } from "vite-plus/test";
import { requestUrl } from "../test/request-url";
import { ApiError, createApiClient } from "./client";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function failure(call: Promise<unknown>): Promise<ApiError> {
  try {
    await call;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("the call was expected to fail");
}

function setup(respond: (request: Request) => Response | Promise<Response>) {
  const fetchFake = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    respond(new Request(new URL(requestUrl(input), "http://panel.test"), init)),
  );
  const onUnauthorized = vi.fn();
  const api = createApiClient({ fetch: fetchFake, onUnauthorized });
  return { api, fetchFake, onUnauthorized };
}

describe("api client", () => {
  it("returns the parsed JSON under the /api base", async () => {
    const { api, fetchFake } = setup(() => json({ userId: "u1", userName: "sam" }));
    await expect(api.get("/auth/me")).resolves.toEqual({ userId: "u1", userName: "sam" });
    expect(requestUrl(fetchFake.mock.calls[0]![0])).toBe("/api/auth/me");
  });

  it("sends a JSON body with its content type", async () => {
    let seen: Request | undefined;
    const { api } = setup((request) => {
      seen = request;
      return json({ ok: true });
    });
    await api.post("/auth/login", { username: "a", password: "b" });
    expect(seen?.method).toBe("POST");
    expect(seen?.headers.get("content-type")).toBe("application/json");
    expect(await seen?.json()).toEqual({ username: "a", password: "b" });
  });

  it("keeps the session cookie to its own origin", async () => {
    const { api, fetchFake } = setup(() => json({}));
    await api.get("/series");
    expect(fetchFake.mock.calls[0]?.[1]?.credentials).toBe("same-origin");
  });

  it("returns undefined for an empty 204", async () => {
    const { api } = setup(() => new Response(null, { status: 204 }));
    await expect(api.delete("/jobs/1")).resolves.toBeUndefined();
  });

  it("turns a 400 with issues into an ApiError", async () => {
    const { api } = setup(() =>
      json({ error: "invalid_body", issues: [{ path: "title", message: "Required" }] }, 400),
    );
    const error = await api.post("/series", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: "invalid_body",
      issues: [{ path: "title", message: "Required" }],
    });
  });

  it("falls back to a generic code when the error body is not JSON", async () => {
    const { api } = setup(() => new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(api.get("/series")).rejects.toMatchObject({ status: 502, code: "http_error" });
  });

  it("reports a network failure as status 0", async () => {
    const api = createApiClient({
      fetch: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    await expect(api.get("/series")).rejects.toMatchObject({ status: 0, code: "network" });
  });

  it("lets an abort through untouched", async () => {
    const abort = new DOMException("aborted", "AbortError");
    const api = createApiClient({ fetch: () => Promise.reject(abort) });
    await expect(api.get("/series")).rejects.toBe(abort);
  });

  describe("onUnauthorized", () => {
    it("fires once for a burst of 401s, and again after a reset", async () => {
      const { api, onUnauthorized } = setup(() => json({ error: "unauthorized" }, 401));
      await Promise.allSettled([api.get("/series"), api.get("/jobs"), api.get("/jobs")]);
      expect(onUnauthorized).toHaveBeenCalledTimes(1);

      api.resetUnauthorized();
      await api.get("/series").catch(() => undefined);
      expect(onUnauthorized).toHaveBeenCalledTimes(2);
    });

    it("still rejects with the ApiError", async () => {
      const { api } = setup(() => json({ error: "unauthorized" }, 401));
      await expect(api.get("/series")).rejects.toMatchObject({ status: 401 });
    });

    it("is skipped for a request that expects a 401 (wrong credentials)", async () => {
      const { api, onUnauthorized } = setup(() => json({ error: "invalid_credentials" }, 401));
      await expect(
        api.post("/auth/login", { username: "a", password: "b" }, { expectUnauthorized: true }),
      ).rejects.toMatchObject({ status: 401, code: "invalid_credentials" });
      expect(onUnauthorized).not.toHaveBeenCalled();
    });

    it("is not fired by other errors", async () => {
      const { api, onUnauthorized } = setup(() => json({ error: "forbidden" }, 403));
      await api.get("/series").catch(() => undefined);
      expect(onUnauthorized).not.toHaveBeenCalled();
    });
  });

  it("keeps the Retry-After of a throttled call, in seconds", async () => {
    const { api } = setup(() =>
      Response.json(
        { error: "too_many_requests" },
        { status: 429, headers: { "retry-after": "42" } },
      ),
    );
    const error = await failure(api.post("/auth/login", {}, { expectUnauthorized: true }));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(42);
  });

  it("has no Retry-After when the header is absent or not a number of seconds", async () => {
    const { api } = setup(() =>
      Response.json({ error: "x" }, { status: 429, headers: { "retry-after": "soon" } }),
    );
    const error = await failure(api.get("/x"));
    expect(error.retryAfterSeconds).toBeUndefined();
  });
});
