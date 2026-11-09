import { zValidator } from "@hono/zod-validator";
import {
  ArtworkFromUrlBody,
  ArtworkKind,
  CreateSeriesBody,
  DeleteSeriesQuery,
  EnqueueBody,
  ExtractorsBody,
  FolderQuery,
  NewFolderBody,
  JellyfinConnectBody,
  LocalAdminBody,
  SettingsUpdate,
  ListJobsQuery,
  LoginBody,
  MarkReadBody,
  PreviewRequest,
  SeriesPatch,
  SourcePatch,
  SwitchSourceBody,
  ShowLookupParams,
  ShowSearchQuery,
  GuideEpisodesParams,
  GuideQuery,
  GuideSeasonsParams,
  type ApiErrorBody,
  type JellyfinConnection,
  type Me,
  type SettingsView,
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
import { MAX_ARTWORK_BYTES } from "../../application/artwork.ts";
import { AppError } from "../../domain/errors.ts";
import type { EventBus } from "../../application/ports.ts";
import type { UseCases } from "../../application/use-cases.ts";
import { listFolders, makeFolder } from "../folders.ts";
import { describeError } from "./errors.ts";
import { LoginRateLimiter } from "./rate-limit.ts";
import { serveWeb } from "./static.ts";

export const SESSION_COOKIE = "hm_session";
const MAX_BODY_BYTES = 1024 * 1024;
const PING_MS = 25_000;
/** How many notifications the bell lists. */
const NOTIFICATIONS_SHOWN = 50;
/** A series' artwork, as uploaded: `/api/series/:id/poster`, `…/backdrop`, `…/logo`. */
const ARTWORK_PATH = /\/series\/[^/]+\/(poster|backdrop|logo)$/;

const POSTER_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** The server's own settings, which only a signed-in administrator reads and changes. */
export interface SettingsRoutes {
  view(): Promise<SettingsView>;
  /** Saves them and restarts what they drive; refused, keeping the old ones, when they cannot run. */
  update(input: SettingsUpdate): Promise<SettingsView>;
  /** Signs in to a Jellyfin server as an administrator and makes this server a key there. */
  connectJellyfin(body: JellyfinConnectBody): Promise<JellyfinConnection>;
  /** Makes, or changes, the server's own administrator. */
  saveLocalAdmin(body: LocalAdminBody): Promise<void>;
  /** The extractors file's text, as it was saved. */
  extractors(): Promise<string>;
  saveExtractors(text: string): Promise<void>;
}

export interface AppDeps {
  useCases: UseCases;
  events: EventBus;
  settings: SettingsRoutes;
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
export function validate<Target extends "json" | "query" | "param", Schema extends ZodType>(
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

/**
 * The browser's first language as TMDB takes it (`es`, `en-US`), for a server that looks shows up on
 * TMDB itself; undefined when it names none TMDB would take.
 */
export function firstLanguage(header: string | undefined): string | undefined {
  const tag = header?.split(",")[0]?.split(";")[0]?.trim();
  if (!tag) return undefined;
  const [language = "", region = ""] = tag.split("-");
  if (!/^[a-z]{2}$/i.test(language)) return undefined;
  // TMDB has two Spanish: Spain's (plain `es`) and Mexico's, the one Latin America reads (Jellyfin
  // takes `es-419` that way too). Any other region of Spanish would fall back to Spain's.
  if (language.toLowerCase() === "es" && region !== "" && region.toUpperCase() !== "ES") {
    return "es-MX";
  }
  // A region TMDB has no name for leaves the language alone.
  return /^[a-z]{2}$/i.test(region)
    ? `${language.toLowerCase()}-${region.toUpperCase()}`
    : language.toLowerCase();
}

/** The peer address; behind a reverse proxy this is the proxy's, which is the best we can trust. */
export function clientAddress(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function createApp(deps: AppDeps) {
  const { useCases } = deps;
  const api = new Hono<Env>();

  const limitBody = (maxSize: number) =>
    bodyLimit({
      maxSize,
      onError: (c) =>
        c.json(
          {
            error: "payload_too_large",
            message: "The request body is too large",
          } satisfies ApiErrorBody,
          413,
        ),
    });
  const smallBody = limitBody(MAX_BODY_BYTES);
  // An uploaded image is the one body allowed to be large.
  const imageBody = limitBody(MAX_ARTWORK_BYTES + 64 * 1024);
  api.use((c, next) =>
    c.req.method === "PUT" && ARTWORK_PATH.test(c.req.path)
      ? imageBody(c, next)
      : smallBody(c, next),
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
      else limiter.release(address, username);
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
    "/lookup/*",
    "/library/*",
    "/series",
    "/series/*",
    "/jobs",
    "/jobs/*",
    "/notifications",
    "/notifications/*",
    "/events",
    "/settings",
    "/settings/*",
  ]) {
    api.use(path, requireSession);
  }

  api.get("/auth/me", (c) => c.json(c.get("me")));

  // --- extractors and series
  api.get("/extractors", (c) => c.json(useCases.listExtractors()));

  api.get("/lookup/tmdb", validate("query", ShowSearchQuery), async (c) => {
    const { query, year } = c.req.valid("query");
    return c.json(
      await useCases.searchShows(
        query,
        year,
        firstLanguage(c.req.header("accept-language")),
        c.req.raw.signal,
      ),
    );
  });

  api.get("/lookup/tmdb/:tmdbId", validate("param", ShowLookupParams), async (c) => {
    const { tmdbId } = c.req.valid("param");
    return c.json(
      await useCases.lookupShow(
        tmdbId,
        c.req.raw.signal,
        firstLanguage(c.req.header("accept-language")),
      ),
    );
  });

  api.get("/lookup/tmdb/:tmdbId/artwork", validate("param", ShowLookupParams), async (c) => {
    const { tmdbId } = c.req.valid("param");
    return c.json(
      await useCases.showArtworkOptions(
        tmdbId,
        firstLanguage(c.req.header("accept-language")),
        c.req.raw.signal,
      ),
    );
  });

  api.get(
    "/lookup/tmdb/:tmdbId/seasons",
    validate("param", GuideSeasonsParams),
    validate("query", GuideQuery),
    async (c) => {
      const { tmdbId } = c.req.valid("param");
      const { language } = c.req.valid("query");
      return c.json(await useCases.guideSeasons(tmdbId, language, c.req.raw.signal));
    },
  );

  api.get(
    "/lookup/tmdb/:tmdbId/seasons/:season",
    validate("param", GuideEpisodesParams),
    validate("query", GuideQuery),
    async (c) => {
      const { tmdbId, season } = c.req.valid("param");
      const { language } = c.req.valid("query");
      return c.json(await useCases.guideEpisodes(tmdbId, season, language, c.req.raw.signal));
    },
  );

  api.get("/library/shows", async (c) => c.json(await useCases.listLibraryShows(c.req.raw.signal)));
  api.get("/library/shows/:id/episodes", async (c) =>
    c.json(await useCases.listLibraryEpisodes(c.req.param("id"), c.req.raw.signal)),
  );

  api.post("/series/preview", validate("json", PreviewRequest), async (c) => {
    const { url, extractorId } = c.req.valid("json");
    return c.json(await useCases.previewSeries(url, c.req.raw.signal, extractorId));
  });

  api.get("/series/preview/:previewId/poster", async (c) => {
    const image = await useCases.previewPoster(c.req.param("previewId"), c.req.raw.signal);
    return c.body(new Uint8Array(image.bytes), 200, {
      "content-type": POSTER_TYPES[image.extension] ?? "application/octet-stream",
      "cache-control": "private, max-age=600",
    });
  });

  api.post("/series", validate("json", CreateSeriesBody), async (c) => {
    return c.json(await useCases.addSeries(c.req.valid("json")), 201);
  });

  api.get("/series", async (c) => c.json(await useCases.listSeries()));
  api.get("/series/:id", async (c) => c.json(await useCases.getSeries(c.req.param("id"))));

  api.patch("/series/:id", validate("json", SeriesPatch), async (c) => {
    return c.json(await useCases.patchSeries(c.req.param("id"), c.req.valid("json")));
  });

  // Its downloads stop; its folder goes only with `?files=true`.
  api.delete("/series/:id", validate("query", DeleteSeriesQuery), async (c) => {
    const { files } = c.req.valid("query");
    await useCases.deleteSeries(c.req.param("id"), { files });
    return c.body(null, 204);
  });

  api.patch("/series/:id/sources/:sourceId", validate("json", SourcePatch), async (c) => {
    const { id, sourceId } = c.req.param();
    return c.json(await useCases.patchSource(id, sourceId, c.req.valid("json")));
  });

  api.get("/series/:id/episodes", async (c) =>
    c.json(await useCases.listEpisodes(c.req.param("id"))),
  );

  // Nothing is downloaded: the episodes only take their video from that source from now on.
  api.post("/series/:id/episodes/source", validate("json", SwitchSourceBody), async (c) => {
    const body = c.req.valid("json");
    return c.json(await useCases.switchSource(c.req.param("id"), body, c.req.raw.signal));
  });

  // The episode stays in the series, not downloaded: only its file goes.
  api.delete("/series/:id/episodes/:episodeId/file", async (c) => {
    const { id, episodeId } = c.req.param();
    return c.json(await useCases.deleteEpisodeFile(id, episodeId));
  });

  // A series' own artwork, in its folder. The panel adds `?v=` (its `artworkVersion`) to the address,
  // so a changed image is a new address and the cached one can be kept a long time.
  api.get("/series/:id/:kind{poster|backdrop|logo}", async (c) => {
    const kind = ArtworkKind.parse(c.req.param("kind"));
    const path = await useCases.artworkOf(c.req.param("id"), kind);
    if (!path)
      return c.json(
        { error: "not_found", message: `This series has no ${kind}` } satisfies ApiErrorBody,
        404,
      );
    return c.body(new Uint8Array(await readFile(path)), 200, {
      "content-type": POSTER_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
      "cache-control": c.req.query("v")
        ? "private, max-age=31536000, immutable"
        : "private, no-cache",
    });
  });

  api.get("/series/:id/artwork", async (c) =>
    c.json(
      await useCases.artworkOptions(
        c.req.param("id"),
        firstLanguage(c.req.header("accept-language")),
        c.req.raw.signal,
      ),
    ),
  );

  // One of TMDB's (a JSON `{ url }`) or an image of one's own (the image itself as the body).
  api.put("/series/:id/:kind{poster|backdrop|logo}", async (c) => {
    const id = c.req.param("id");
    const kind = ArtworkKind.parse(c.req.param("kind"));
    const type = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (type === "application/json") {
      const body = ArtworkFromUrlBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) throw new AppError("bad_request", "Send the address of a TMDB image");
      return c.json(await useCases.setArtwork(id, kind, { url: body.data.url }, c.req.raw.signal));
    }
    if (!type.startsWith("image/")) {
      throw new AppError("bad_request", "Send an image, or the address of a TMDB image");
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    return c.json(await useCases.setArtwork(id, kind, { bytes }));
  });

  api.delete("/series/:id/:kind{poster|backdrop|logo}", async (c) =>
    c.json(await useCases.removeArtwork(c.req.param("id"), ArtworkKind.parse(c.req.param("kind")))),
  );

  api.post("/series/:id/check", async (c) =>
    c.json(await useCases.checkSeriesNow(c.req.param("id")), 202),
  );

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

  api.post("/jobs/cancel-queued", async (c) => c.json(await useCases.cancelQueuedDownloads()));
  api.post("/jobs/:id/retry", async (c) => c.json(await useCases.retryJob(c.req.param("id"))));
  api.post("/jobs/:id/cancel", async (c) => c.json(await useCases.cancelJob(c.req.param("id"))));

  // --- notifications
  api.get("/notifications", async (c) =>
    c.json(await useCases.listNotifications(NOTIFICATIONS_SHOWN)),
  );
  api.post("/notifications/read", async (c) => {
    // The body is optional: no body at all means "all of them".
    const text = await c.req.text();
    let body: unknown = {};
    if (text !== "") {
      try {
        body = JSON.parse(text);
      } catch {
        return c.json(
          {
            error: "bad_request",
            message: "The request body is not valid JSON",
          } satisfies ApiErrorBody,
          400,
        );
      }
    }
    const parsed = MarkReadBody.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "bad_request", message: "The request is not valid" } satisfies ApiErrorBody,
        400,
      );
    }
    return c.json(await useCases.markNotificationsRead(parsed.data.ids));
  });

  // --- settings
  api.get("/settings", async (c) => c.json(await deps.settings.view()));
  api.put("/settings", validate("json", SettingsUpdate), async (c) => {
    const before = (await deps.settings.view()).signIn;
    const view = await deps.settings.update(c.req.valid("json"));
    // Someone else signs in now: no session made the old way stays, this one included.
    if (view.signIn !== before) await useCases.endSessions(null);
    return c.json(view);
  });
  api.put("/settings/admin", validate("json", LocalAdminBody), async (c) => {
    await deps.settings.saveLocalAdmin(c.req.valid("json"));
    // A new password ends the administrator's other sessions; whoever changed it stays in.
    if ((await deps.settings.view()).signIn === "local") {
      await useCases.endSessions(getCookie(c, SESSION_COOKIE) ?? null);
    }
    return c.body(null, 204);
  });
  api.get("/settings/folders", validate("query", FolderQuery), async (c) =>
    c.json(await listFolders(c.req.valid("query").path)),
  );
  api.post("/settings/folders", validate("json", NewFolderBody), async (c) => {
    const { parent, name } = c.req.valid("json");
    return c.json(await makeFolder(parent, name), 201);
  });
  api.post("/settings/jellyfin", validate("json", JellyfinConnectBody), async (c) =>
    c.json(await deps.settings.connectJellyfin(c.req.valid("json"))),
  );
  api.get("/settings/extractors", async (c) =>
    c.body(await deps.settings.extractors(), 200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="extractors.json"',
    }),
  );
  api.put("/settings/extractors", validate("json", ExtractorsBody), async (c) => {
    await deps.settings.saveExtractors(c.req.valid("json").text);
    return c.body(null, 204);
  });

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
