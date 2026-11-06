import {
  FolderQuery,
  JellyfinConnectBody,
  NewFolderBody,
  SetupBody,
  type ApiErrorBody,
} from "@orca/hm-contract";
import { AppError } from "../../domain/errors.ts";
import { listFolders, makeFolder } from "../folders.ts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import type { ServerSetup } from "../setup.ts";
import { validate } from "./app.ts";
import { describeError } from "./errors.ts";
import { serveWeb } from "./static.ts";

const MAX_BODY_BYTES = 1024 * 1024;

export interface RootDeps {
  setup: ServerSetup;
  /** Absolute path of the built panel, served before the server is set up too. */
  webRoot?: string;
}

/**
 * The server's front door: the first setup, and once there are settings, whatever they started. The
 * panel itself is served either way, so it can show the setup.
 */
export function createRootApp(deps: RootDeps) {
  const { setup } = deps;
  const app = new Hono();
  app.use(secureHeaders());
  app.get("/health", (c) => c.json({ status: "ok" }));

  const first = new Hono();
  first.use(
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
  // As in the API: a cross-site request always carries an Origin, and is refused here.
  const checkOrigin = csrf();
  first.use((c, next) => (c.req.header("origin") ? checkOrigin(c, next) : next()));
  first.get("/", (c) => c.json(setup.status()));
  // The series folder is picked from the server's own disk; once it is set up, only from Settings.
  first.get("/folders", validate("query", FolderQuery), async (c) => {
    if (setup.configured) throw new AppError("conflict", "The server is already set up");
    return c.json(await listFolders(c.req.valid("query").path));
  });
  first.post("/folders", validate("json", NewFolderBody), async (c) => {
    if (setup.configured) throw new AppError("conflict", "The server is already set up");
    const { parent, name } = c.req.valid("json");
    return c.json(await makeFolder(parent, name), 201);
  });
  first.post("/jellyfin", validate("json", JellyfinConnectBody), async (c) =>
    c.json(await setup.setupConnect(c.req.valid("json"))),
  );
  first.post("/", validate("json", SetupBody), async (c) => {
    await setup.setup(c.req.valid("json"));
    return c.body(null, 204);
  });
  app.route("/api/setup", first);

  app.all("*", (c, next) => {
    const runtime = setup.handler;
    if (runtime) return runtime.fetch(c.req.raw, c.env);
    return next();
  });
  // Not set up yet: the API says so, and the panel is still served to show the setup.
  app.all("/api/*", (c) =>
    c.json(
      {
        error: "not_configured",
        message: "The server is not set up yet: open the panel to set it up",
      } satisfies ApiErrorBody,
      503,
    ),
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
