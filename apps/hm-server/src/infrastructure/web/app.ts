import { zValidator } from "@hono/zod-validator";
import {
  CreateSeriesBody,
  EnqueueBody,
  ListJobsQuery,
  LoginBody,
  PreviewRequest,
  SeriesPatch,
  type ApiErrorBody,
  type Me,
} from "@orca/hm-contract";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import { streamSSE } from "hono/streaming";
import type { ZodType } from "zod";
import { AppError } from "../../domain/errors.ts";
import type { EventBus } from "../../application/ports.ts";
import type { UseCases } from "../../application/use-cases.ts";
import { describeError } from "./errors.ts";
import { LoginRateLimiter } from "./rate-limit.ts";
import { serveWeb } from "./static.ts";

export const SESSION_COOKIE = "hm_session";
const MAX_BODY_BYTES = 1024 * 1024;
const PING_MS = 25_000;
const POSTER_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export interface AppDeps {
  useCases: UseCases;
  events: EventBus;
  /** `Secure` on the session cookie: only behind HTTPS (the LAN is plain http for now). */
  secureCookies: boolean;
  sessionTtlMs: number;
  /** Absolute path of the built panel. When set it is served from the same origin. */
  webRoot?: string;
  /** Brake on password guessing. A default one is made when left out. */
  loginLimiter?: LoginRateLimiter;
}

type Env = { Variables: { me: Me } };

/** Zod failures become the same 400 body every route uses. */
function validate<Target extends "json" | "query", Schema extends ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result, c) => {
    if (result.success) return;
    const body: ApiErrorBody = {
      error: "bad_request",
      message: "The request is not valid",
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
    return c.json(body, 400);
  });
}

/** The peer address; behind a reverse proxy this is the proxy's, which is the best we can trust. */
function clientAddress(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function createApp(deps: AppDeps) {
  const { useCases } = deps;
  const api = new Hono<Env>();

  api.use(
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) =>
        c.json(
          {
            error: "payload_too_large",
            message: "The request body is too large",
          } satisfies ApiErrorBody,
          413,
        ),
    }),
  );
  // Origin check on form-style posts; JSON posts are already blocked cross-site by SameSite=Strict + CORS.
  // A cross-site request always carries an Origin; one without it is not a browser riding a cookie.
  const checkOrigin = csrf();
  api.use((c, next) => (c.req.header("origin") ? checkOrigin(c, next) : next()));

  // --- auth (login and logout are the only routes open without a session)
  const limiter = deps.loginLimiter ?? new LoginRateLimiter();
  api.post("/auth/login", validate("json", LoginBody), async (c) => {
    const { username, password } = c.req.valid("json");
    const address = clientAddress(c);
    const decision = limiter.check(address, username);
    if (!decision.allowed) {
      c.header("Retry-After", String(decision.retryAfterSec));
      return c.json(
        {
          error: "too_many_attempts",
          message: "Too many sign-in attempts: wait a while and try again",
        } satisfies ApiErrorBody,
        429,
      );
    }
    let session;
    try {
      session = await useCases.login(username, password);
    } catch (error) {
      if (error instanceof AppError && error.code === "unauthorized")
        limiter.recordFailure(address, username);
      throw error;
    }
    limiter.recordSuccess(address, username);
    const { sessionId, me } = session;
    setCookie(c, SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      secure: deps.secureCookies,
      maxAge: Math.floor(deps.sessionTtlMs / 1000),
    });
    return c.json(me);
  });

  api.post("/auth/logout", async (c) => {
    const id = getCookie(c, SESSION_COOKIE);
    if (id) await useCases.logout(id);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  const requireSession: MiddlewareHandler<Env> = async (c, next) => {
    const id = getCookie(c, SESSION_COOKIE);
    const me = id ? await useCases.resolveSession(id) : null;
    if (!me) {
      return c.json(
        { error: "unauthorized", message: "Sign in first" } satisfies ApiErrorBody,
        401,
      );
    }
    c.set("me", me);
    return next();
  };
  // Listed, not a blanket `use`: an unknown path under /api is a plain 404 whether or not you're signed in.
  for (const path of [
    "/auth/me",
    "/extractors",
    "/series",
    "/series/*",
    "/jobs",
    "/jobs/*",
    "/events",
  ]) {
    api.use(path, requireSession);
  }

  api.get("/auth/me", (c) => c.json(c.get("me")));

  // --- extractors and series
  api.get("/extractors", (c) => c.json(useCases.listExtractors()));

  api.post("/series/preview", validate("json", PreviewRequest), async (c) => {
    const { url } = c.req.valid("json");
    return c.json(await useCases.previewSeries(url, c.req.raw.signal));
  });

  api.post("/series", validate("json", CreateSeriesBody), async (c) => {
    return c.json(await useCases.addSeries(c.req.valid("json")), 201);
  });

  api.get("/series", async (c) => c.json(await useCases.listSeries()));
  api.get("/series/:id", async (c) => c.json(await useCases.getSeries(c.req.param("id"))));

  api.patch("/series/:id", validate("json", SeriesPatch), async (c) => {
    return c.json(await useCases.patchSeries(c.req.param("id"), c.req.valid("json")));
  });

  api.get("/series/:id/episodes", async (c) =>
    c.json(await useCases.listEpisodes(c.req.param("id"))),
  );

  api.get("/series/:id/poster", async (c) => {
    const path = await useCases.posterOf(c.req.param("id"));
    if (!path)
      return c.json(
        { error: "not_found", message: "This series has no poster" } satisfies ApiErrorBody,
        404,
      );
    return c.body(new Uint8Array(await readFile(path)), 200, {
      "content-type": POSTER_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "private, max-age=3600",
    });
  });

  api.post("/series/:id/download", async (c) =>
    c.json(await useCases.downloadSeries(c.req.param("id")), 201),
  );

  // --- jobs
  api.post("/jobs", validate("json", EnqueueBody), async (c) => {
    const { episodeIds } = c.req.valid("json");
    return c.json(await useCases.enqueue(episodeIds), 201);
  });

  api.get("/jobs", validate("query", ListJobsQuery), async (c) => {
    return c.json(await useCases.listJobs(c.req.valid("query")));
  });

  api.post("/jobs/:id/retry", async (c) => c.json(await useCases.retryJob(c.req.param("id"))));
  api.post("/jobs/:id/cancel", async (c) => c.json(await useCases.cancelJob(c.req.param("id"))));

  // --- server-sent events
  api.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = deps.events.subscribe((event) => {
        void stream
          .writeSSE({ event: event.type, data: JSON.stringify(event), id: String(event.seq) })
          .catch(() => undefined);
      });
      stream.onAbort(unsubscribe);
      try {
        while (!stream.aborted) {
          await stream.writeSSE({ event: "ping", data: "" });
          await stream.sleep(PING_MS);
        }
      } finally {
        unsubscribe();
      }
    }),
  );

  const app = new Hono();
  app.use(secureHeaders());
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.route("/api", api);
  app.all("/api/*", (c) =>
    c.json({ error: "not_found", message: "No such route" } satisfies ApiErrorBody, 404),
  );
  if (deps.webRoot) app.use(serveWeb(deps.webRoot));

  app.onError((error, c) => {
    if ("getResponse" in error && typeof error.getResponse === "function")
      return error.getResponse() as Response;
    if (error instanceof SyntaxError) {
      return c.json(
        {
          error: "bad_request",
          message: "The request body is not valid JSON",
        } satisfies ApiErrorBody,
        400,
      );
    }
    const { status, body } = describeError(error);
    return c.json(body, status);
  });
  app.notFound((c) =>
    c.json({ error: "not_found", message: "No such route" } satisfies ApiErrorBody, 404),
  );

  return app;
}
