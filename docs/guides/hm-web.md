# Orca'H&M — the admin panel

**English** · [Español](es/hm-web.md) · [All guides](../../README.md)

The panel (`apps/hm-web`) is the web interface of the [Orca'H&M server](hm-server.md): a dashboard
with the job queue, the list of series, adding a series from an address (with a preview of what will be
downloaded, the season, the first episode number, TMDB/IMDb ids and track choices), each series' sources
and episodes, the available extractors and notifications (live, over server-sent events).

It has no backend of its own: it always talks to an H&M server on the **same origin**, under `/api`.
Sign in with a **Jellyfin administrator** account of the Jellyfin that server uses.

## In development

The Vite dev server proxies `/api` to the H&M server, so the browser sees one origin and the session
cookie works.

```bash
cp apps/hm-web/.env.example apps/hm-web/.env
```

| Variable        | Meaning                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `HM_SERVER_URL` | Where the H&M server listens, e.g. `http://127.0.0.1:8787` (match the profile's `HOST`/`PORT`) |

```bash
HM_PROFILE=home pnpm dev:hm               # server + panel together
pnpm --filter @orca/hm-web dev            # the panel alone, against a server already running
```

Open the address Vite prints (`http://localhost:5173`, or the next free port when Orca'JP's dev server
already took it).

## In production

Build it and let the H&M server serve it:

```bash
pnpm --filter @orca/hm-web build          # output: apps/hm-web/dist/
```

Set `WEB_ROOT` to the absolute path of `apps/hm-web/dist` in the server's profile. The Docker image and
Bifröst's `hm up` already include the built panel; open `http://<server>:<port>/`.

Behind HTTPS, set `SECURE_COOKIES=true` on the server.

## Tests

```bash
pnpm --filter @orca/hm-web test
```
