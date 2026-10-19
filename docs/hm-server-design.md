# Orca'H&M (`apps/hm-server`): design doc

**Summary:** everything below was checked on 2026-10-18 against npm, live archive.org, Jellyfin's source on GitHub, the installed `@jellyfin/sdk` 1.0.0, Playwright's docs and context7.

Two findings change the plan:

- **Node ESM deep imports from the SDK break without a `.js` suffix** (§4). This affects extracting `packages/jellyfin`.
- **`licenseurl` on IA can't be trusted** (§1.5). The panel needs a confirmation step for it.

---

## 1. Internet Archive APIs

### 1.1 Endpoints (all tested with curl; none needs auth)

| Use                                              | Request                                                                                                                                               | Notes                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Item or collection metadata                      | `GET https://archive.org/metadata/{id}`                                                                                                               | Top-level keys: `created, d1, d2, dir, files, files_count, is_collection, item_last_updated, item_size, metadata, server, uniq, workable_servers`. Partial reads work, e.g. `/metadata/{id}/files?start=0&count=50`. A partial read wraps the value in `{result}`.                              |
| List a collection's members                      | `GET https://archive.org/services/search/v1/scrape?q=collection%3A{id}&fields=identifier,title,description,date,year,licenseurl&count=100[&cursor=…]` | Returns `{items, count, total, cursor?}`. `count` must be at least 100 (`RangeException` otherwise). Paginate until `cursor` is missing. **URL-encode `q`.** Unencoded, `collection:classic_tv` returned wrong totals. Use this for listing; Advanced Search caps out at 10,000 sorted results. |
| Ad-hoc search (optional, e.g. a "search IA" box) | `GET https://archive.org/advancedsearch.php?q=…&fl[]=identifier&fl[]=title&sort[]=downloads+desc&rows=N&output=json`                                  | Returns `response.{numFound,docs}`. Same Lucene syntax as scrape.                                                                                                                                                                                                                               |
| Download                                         | `GET https://archive.org/download/{id}/{encodeURIComponent(name)}`                                                                                    | Answers 302 to `https://dnXXXX.*.archive.org/0/items/{id}/{name}`, which serves `200 video/mp4` with `accept-ranges: bytes`. So **resume with `Range` works**.                                                                                                                                  |

### 1.2 Fields that matter

- **`metadata`:**
  - `identifier`, `title`, `mediatype` (`movies` | `collection`), `collection` (string or array).
  - `description`: may contain HTML. Strip it.
  - `date`, `year`: often missing.
  - `subject`: string or array.
  - `licenseurl`, `runtime`, `language`, `creator`.
  - Any field can be a string or an array. Normalize with Zod (`z.union([z.string(), z.array(z.string())])`, then convert to an array).
- **`files[]`:** `name`, `source` (`original` | `derivative` | `metadata`), `format`, `original` (for derivatives, the original file it came from), `length` (seconds, as a string), `size`, `width`, `height`, `md5`, `sha1`, `mtime`, and sometimes `title`/`track`.
- **Integrity and change detection:**
  - Check `size` and `md5` after downloading.
  - `item_last_updated` (epoch seconds) is the cheap signal for "did anything change" (F5).

### 1.3 How a "series" maps (both shapes exist in practice)

**A. One item with many files.** This is the most common shape. Example: `bevhill-s01e01-36` has 54 `MPEG4` originals, `s01e01…s02e19`, each with an `.ogv` derivative.

- 1 item = 1 series.
- Each video "group" is one episode.
- Group files by the original's stem. A derivative points back through `original`.

**B. A collection of items, one episode per item.** Example: `onestepbeyondcomplete`, with `mediatype: collection` and 95 items such as `S1E10THEVISION`.

- Series metadata comes from the collection.
- Episodes come from scrape (`collection:{id}`).
- Each episode's files come from `/metadata/{itemId}`.
- Per-item description and title are better than in shape A.

Not supported for now: a compilation file with several episodes in one video (`fg-1-12`: `FG 1-12.mp4`, 5 hours long). Detect it (`length` > 3× the median) and flag it in the preview rather than guessing.

### 1.4 Choosing the video file per episode

Formats seen in live data:

- Originals: `MPEG4`, `MPEG1`, `Cinepack` (`.avi`).
- Derivatives: `h.264` (full-resolution `.mp4`), `512Kb MPEG4` (legacy low-resolution), `Ogg Video`.
- Always ignored: `Thumbnail`, `Metadata`, `Item Tile`, `JPEG Thumb`, `Animated GIF`, `Archive BitTorrent`, `Text`.
- `Web Video Text Tracks` are autogenerated captions. Skip them; maybe add them in F5.

Ranking per group:

1. An original that is mp4 or mkv (`MPEG4`, `.mp4`/`.mkv`).
2. The `h.264` derivative. Use this when the original is MPEG1, AVI or anything else Jellyfin would have to transcode.
3. Any other original with a video extension.
4. `512Kb MPEG4`.
5. `Ogg Video`.

Within a tier, pick the larger `height`. Keep the original's `length`, `size` and `md5` for progress and verification.

Example of tier 2: the `The_Beverly_Hillbillies` item has `X.MPG` (MPEG1 original), `X.mp4` (h.264), `X_512kb.mp4` and `X.ogv`. Pick `X.mp4`.

### 1.5 Title, year, description, ordering, license

- **Series title:**
  - Shape B: the collection's `title`, minus suffixes like ": The Complete Series".
  - Shape A: the item's `title`. It is often junk (`"beverly hillbillies s01 e01-18"`).
  - So the **preview is editable**. The user confirms or fixes the title and year before confirming. The year is often missing: `bevhill` has none. The `The_Beverly_Hillbillies` item has `year: ["1962","1962-71"]`. Take the first 4-digit year from `year`, then `date`, else leave it empty for the user.
- **Episode numbers:**
  - Regex on the filename, then on `title`: `/\bS(\d{1,2})\s*E(\d{1,3})\b/i`. It handles `s01e01`, `S01e21`, `S1E10`, `S1 E10`.
  - Also handle a missing season (`"S E13"` exists in One Step Beyond). Inherit the season of its neighbours and mark it `inferred`.
  - Fallback: natural sort by filename, numbered as season 1, every episode marked `inferred`.
  - Report gaps (e.g. `bevhill` has no s01e19) and duplicates.
- **Episode title:** what follows the `SxxEyy` token, with `_`/`-` turned into spaces (`s01e02-Getting-Settled` gives "Getting Settled"). In shape B, use the item `title` minus the series prefix and the code.
- **Plot:** the item's `description` in shape B, HTML stripped. In shape A the series description is often the only text.
- **License:** values seen are `http://creativecommons.org/publicdomain/mark/1.0/`, `http://creativecommons.org/licenses/publicdomain/` and `https://creativecommons.org/publicdomain/zero/1.0/`. Map them to `public-domain | cc-by… | unknown`.
  - **Uploaders set this field themselves, and it's wrong sometimes.** "The Young Ones" (1982, BBC) is tagged PD Mark. "Jonny Quest" (1996) is tagged CC0.
  - Policy (fits decision 6): show the license in the preview. If it's `unknown`, or the year is after 1977, require an explicit "I have the right to download this" check before confirming.

### 1.6 Etiquette

There is no official number for the rate limit (the search turned up only third-party Wayback pages). Conservative defaults:

- `User-Agent: OrcaHM/<version> (+contact: <CONTACT_EMAIL>)`. The address comes from the optional `CONTACT_EMAIL` environment variable; without it the contact part is left out.
- At most 1 metadata or scrape request per second.
- At most 1 concurrent download per IA host. Allow 2 as a config option.
- Honor `429`/`503` + `Retry-After`, then exponential backoff (§5).
- Cache metadata JSON per run.
- Never hammer `/download` with retries without a delay.

### 1.7 Fixtures to save (`packages/extractor-internet-archive/test/fixtures/`)

All four exist and were fetched today.

1. **`bevhill-s01e01-36.metadata.json`** from `https://archive.org/metadata/bevhill-s01e01-36` (118 KB raw; trim it).
   - Keep `metadata` and `item_last_updated`.
   - Keep `files` for: `s01e01-The-Clampetts-Strike-Oil.mp4`, `s01e02-Getting-Settled.mp4`, `S01e21_jedPlaysSolomon.mp4` (capital S plus a `title` field), `s01e18…` and `s01e20…` (the e19 gap), `s02e01_Jed_Gets_The_Misery.mp4`, each one's `.ogv`, 2 `Thumbnail` rows, `__ia_thumb.jpg` and the torrent.
   - jq: `jq '{metadata, item_last_updated, files: [.files[] | select((.name|test("^(s01e0[12]|S01e21|s01e1[8]|s01e20|s02e01)")) or .format=="Item Tile" or .format=="Archive BitTorrent")]}'` plus two thumbnails picked by hand. Result is about 5 KB.
2. **`onestepbeyondcomplete.metadata.json`** from `https://archive.org/metadata/onestepbeyondcomplete`. Keep `metadata` and `is_collection`, and set `files: []`.
3. **`onestepbeyondcomplete.scrape.json`** from `https://archive.org/services/search/v1/scrape?q=collection%3Aonestepbeyondcomplete&fields=identifier,title,description,date,year,licenseurl&count=100`.
   - Trim to about 5 items, including `S1E13THENAVIGATOR` (`"S E13"` title) and `S1E16THEBURNINGGIRL_201804`.
   - Add a second page file with a fake `cursor` to test pagination.
4. **`S1E10THEVISION.metadata.json`** from `https://archive.org/metadata/S1E10THEVISION`. It has an HTML description and an `MPEG4` original plus an `.ogv`. Keep it as is, minus thumbnails.
5. Optional, for the format ranking: **`The_Beverly_Hillbillies.metadata.json`** from `https://archive.org/metadata/The_Beverly_Hillbillies`. It has an MPEG1 original, an h.264 derivative, 512Kb and ogv, plus the `year` array. Keep the 7 files of one episode.

## 2. URLs the extractor accepts

Normalize the host (`archive.org` or `www.archive.org`; turn `http` into `https`). Drop the query string and the hash. Identifiers match `[A-Za-z0-9._-]+`.

- `https://archive.org/details/{id}` as an item or a collection. Tell them apart by calling `/metadata/{id}` and checking whether `metadata.mediatype === "collection"` or `is_collection` is true.
- `https://archive.org/details/{id}/{file…}` gives the item, with the preview preselecting that file.
- `https://archive.org/download/{id}[/{file}]` and `https://archive.org/embed/{id}` are treated the same way.
- Rejected with a clear error: `/search…`, `/details/@user`, `web.archive.org/*` (Wayback), and any non-IA host.
- `SiteExtractor.canHandle(url): boolean` is pure, so the registry in `GET /extractors` stays testable.

## 3. Versions and key APIs

`minimumReleaseAge: 1440` means a version must be at least 1 day old. Every version below is older than that as of 2026-10-18.

| Package                 | Version                                     | Published  | Notes                                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hono`                  | **4.13.13**                                 | 2026-10-04 | Has `hono/streaming` (`streamSSE`), `hono/cookie`, `hono/csrf`, `hono/secure-headers`, `hono/body-limit`, `hono/request-id`. Verified in the tarball.                                                                                              |
| `@hono/node-server`     | **2.1.5**                                   | 2026-10-13 | Engines `>=20`, peer `hono ^4`. Usage: `serve({ fetch: app.fetch, port })`. It returns the server; call `server.close()` on SIGTERM.                                                                                                               |
| `@hono/zod-validator`   | **0.9.1**                                   | 2026-08-31 | Peers `zod ^3.25 \|\| ^4`, `hono >=4.11.2`.                                                                                                                                                                                                        |
| `zod`                   | **4.6.7**                                   | 2026-10-12 | Use Zod 4: `import * as z from "zod"`.                                                                                                                                                                                                             |
| `drizzle-orm`           | **0.45.4** (latest; 1.0 is still `rc`)      | 2026-10-08 | Stay on 0.45. 1.0 rc changes the migrations layout.                                                                                                                                                                                                |
| `drizzle-kit`           | **0.31.11**                                 | 2026-09-21 |                                                                                                                                                                                                                                                    |
| `better-sqlite3`        | **13.0.3**                                  | 2026-08-05 | Engines `>=22`. Uses **N-API (`node-addon-api`) with prebuilds inside the tarball** (`prebuilds/linux-x64.node`, `linuxmusl-x64`, arm64). **No install script**, so it needs no pnpm build-script approval and works on Node 24 without compiling. |
| `@types/better-sqlite3` | 9.6.0                                       | 2026-08-01 |                                                                                                                                                                                                                                                    |
| `playwright`            | **1.64.1**                                  | 2026-10-14 | Supports Node 22/24/26 and Debian 12/13.                                                                                                                                                                                                           |
| `@types/node`           | **24.19.2**                                 | 2026-10-09 | Match the runtime.                                                                                                                                                                                                                                 |
| `@jellyfin/sdk`         | 1.0.0 (repo); 1.0.1 exists, from 2026-10-16 |            | Peer `axios ^1.12`.                                                                                                                                                                                                                                |
| Base image              | `node:24-trixie-slim`                       | 2026-10-14 | Node 24.22.0 (LTS "Krypton"). Debian 13 ships ffmpeg `7.1.5`.                                                                                                                                                                                      |

Key usage, as checked in the docs and `.d.ts` files:

```ts
// SSE
import { streamSSE } from "hono/streaming";
app.get("/events", (c) =>
  streamSSE(c, async (s) => {
    const off = bus.subscribe((e) =>
      s.writeSSE({ event: e.type, data: JSON.stringify(e), id: String(e.seq) }),
    );
    s.onAbort(off);
    while (!s.aborted) {
      await s.writeSSE({ event: "ping", data: "" });
      await s.sleep(25_000);
    } // keep-alive
  }),
);
// Validation
import { zValidator } from "@hono/zod-validator";
app.post(
  "/series",
  zValidator("json", z.object({ url: z.url() }), (r, c) => {
    if (!r.success) return c.json({ error: r.error.issues }, 400);
  }),
  handler,
);
// Drizzle + migrations at startup (0.45: sync migrate for better-sqlite3)
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator"; // migrate(db, { migrationsFolder }): void
const sqlite = new Database(file);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");
const db = drizzle({ client: sqlite, schema });
migrate(db, { migrationsFolder: join(import.meta.dirname, "../drizzle") });
```

- **Migrations:**
  - `drizzle.config.ts` sets `dialect: "sqlite"`, `schema: "./src/infrastructure/db/schema.ts"` and `out: "./drizzle"`.
  - `drizzle-kit generate` runs in dev, and the SQL files are committed.
  - `migrate()` runs at boot and in each test against `:memory:`.
  - The `drizzle/` folder must be copied into the image.
- **Build:** `vp pack` (tsdown) with `pack: { entry: ["src/main.ts"], format: ["esm"] }`. Workspace `@orca/*` packages should be bundled (`noExternal: [/^@orca\//]`) while npm deps stay external. Check that against tsdown's defaults when implementing.
- **Playwright (`StreamDetector`):**
  - `chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] })`, then one `browser.newContext({ userAgent })` per job.
  - Listen with `page.on("request", r => …)`, matching `\.m3u8|\.mpd|\.mp4|video/` by URL and by `resourceType() === "media"` / `xhr`.
  - Capture `await r.allHeaders()` (Referer, Cookie, Origin) and use `page.on("response")` for content-type.
  - Wait until a manifest shows up or a timeout passes, then `context.close()`.
  - Cap browsers with a semaphore (1 by default, 2 at most).
  - IA itself never needs this, because its URLs are direct.
- **ffmpeg progress (verified locally):** `spawn("ffmpeg", ["-hide_banner","-loglevel","error","-nostats","-progress","pipe:1", "-headers", "Referer: …\r\n", "-i", url, "-c","copy","-y", tmp], { signal })`.
  - stdout emits blocks of `key=value` lines that end in `progress=continue|end`. Keys: `frame`, `fps`, `bitrate`, `total_size`, `out_time_us`, `out_time_ms`, `out_time`, `speed`.
  - **`out_time_ms` is actually microseconds**, the same as `out_time_us`. Use `out_time_us`.
  - Percent = `out_time_us / 1e6 / durationSec`. The duration comes from IA's `length` or from `ffprobe`.
  - For IA mp4 files, use the **direct HTTP downloader** instead: `fetch` with `Range: bytes=<partSize>-`, stream to `*.part`, bytes divided by `size` for progress, check md5, then rename. ffmpeg is only for HLS/DASH.

## 4. Jellyfin: naming, `.nfo`, refresh, reusable SDK code

**Naming** (Jellyfin docs): `Show Name (Year)/Season 01/Show Name S01E01.ext`.

- Zero-padded `Season NN`, never `S01`.
- Specials go in `Season 00`.
- Optional provider tag on the folder: `Show Name (1962) [imdbid-tt…]`.
- Images sit next to the media: `poster.jpg` or `folder.jpg` in the series folder, `S01E01-thumb.jpg` beside the episode.
- Sanitize `<>:"/\|?*`.

**NFO** (checked in `MediaBrowser.XbmcMetadata` savers and parsers on GitHub):

- `tvshow.nfo` sits in the series folder with root `<tvshow>`.
- The episode file is `Path.ChangeExtension(episode, ".nfo")` with root `<episodedetails>`.
- Dates are `yyyy-MM-dd`, the default `ReleaseDateFormat`.
- `<uniqueid type="X">` accepts any provider name; unknown ones are stored as is.
- `<lockdata>true</lockdata>` stops online fetchers from overwriting the data. Use it, or TVDB may mismatch the show.

```xml
<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<tvshow>
  <title>The Beverly Hillbillies</title><originaltitle>…</originaltitle>
  <year>1962</year><premiered>1962-09-26</premiered>
  <plot>…</plot><genre>Comedy</genre>
  <uniqueid type="internetarchive" default="true">bevhill-s01e01-36</uniqueid>
  <lockdata>true</lockdata>
</tvshow>

<episodedetails>
  <title>Getting Settled</title><showtitle>The Beverly Hillbillies</showtitle>
  <season>1</season><episode>2</episode>
  <aired>1962-10-03</aired><plot>…</plot>
  <uniqueid type="internetarchive">bevhill-s01e01-36/s01e02-Getting-Settled.mp4</uniqueid>
  <lockdata>true</lockdata>
</episodedetails>
```

- Leave out `aired`/`premiered` when unknown. Don't invent dates.
- The library must have the Nfo metadata reader enabled. Bifröst can set that in the library options.

**Refresh** (`@jellyfin/sdk` 1.0.0 `library-api` plus the server source):

- **Targeted, preferred:** `getLibraryApi(api).postUpdatedMedia({ mediaUpdateInfoDto: { Updates: [{ Path: "/media/tv/Show (1962)", UpdateType: "Created" }] } })`, which is `POST /Library/Media/Updated` (`[Authorize]`).
  - `Path` must be **the path as Jellyfin sees it** (its container path). Use a config mapping `JELLYFIN_MEDIA_ROOT` in addition to H&M's own `MEDIA_ROOT`; both are required, with the same value when the two containers mount the folder at the same path.
- **One library:**
  1. `getLibraryStructureApi(api).getVirtualFolders()` and pick the `VirtualFolderInfo.ItemId` for the TV library. You can match `Locations` against the media root.
  2. `getLibraryApi(api).refreshItem({ itemId, metadataRefreshMode: "Default", imageRefreshMode: "Default" })`, which is `POST /Items/{id}/Refresh` and queues the refresh at High priority. The SDK and the server have **no `recursive` parameter**: refreshing a folder validates its children.
- **Every library:** `getLibraryApi(api).refreshLibrary()`, which is `POST /Library/Refresh` and needs `RequiresElevation`. Keep it as a last resort.
- **Credentials:** background jobs use a **Jellyfin API key**. Bifröst creates it and passes it as `JELLYFIN_API_KEY`. Jobs never use a user token.

**What `packages/jellyfin` can reuse from `src/jellyfin`:**

- Reusable server-side: `server-url.ts` (`normalizeServerUrl`), and from `sign-in.ts` the functions `connectToServer`, `signIn`, `sessionFrom`, `classifyServerError` and `SignInError`.
  - They're already pure: the SDK instance and axios come in as parameters.
  - `fake-server.ts` (the fake axios adapter) is reusable too.
- **Not** reusable as is:
  - `client.ts` creates a module-level `jellyfin` singleton with `__APP_VERSION__`, `navigator`, `browserStore()`, `uwpHost` and `locale`.
  - Split it: the package exports `createJellyfin({clientInfo, deviceInfo})`, and each app passes its own. For H&M: name "Orca'H&M", a stable deviceId from config or the DB.
  - `resumeSession` (with its timeout axios) and `isUnreachable` can move with it.
- **ESM gotcha, verified with Node 24.22:**
  - The SDK has no `exports` map. `import "@jellyfin/sdk/lib/utils/api/library-api"` **fails** in plain Node (`ERR_MODULE_NOT_FOUND`).
  - `…/library-api.js` and `@jellyfin/sdk/lib/utils/api/index.js` work.
  - The client currently imports without the extension (Vite resolves it). In `packages/jellyfin`, **always add `.js`**. That works in both Vite and Node.
- **Admin check:** `AuthenticationResult.User.Policy.IsAdministrator`. `UserDto.Policy` is a `UserPolicy`.

## 5. Job queue

```sql
jobs(
  id TEXT PRIMARY KEY,               -- uuidv7 (sortable)
  kind TEXT NOT NULL,                -- download_episode | refresh_library | check_series
  status TEXT NOT NULL,              -- queued | running | done | failed | cancelled
  payload TEXT NOT NULL,             -- JSON, Zod-validated per kind
  series_id TEXT, episode_id TEXT,   -- FKs (nullable)
  resource TEXT NOT NULL,            -- browser | download | ffmpeg | none  (limiter key)
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5,
  run_after INTEGER NOT NULL,        -- epoch ms; backoff/scheduling
  lease_owner TEXT, lease_expires_at INTEGER,
  progress REAL, progress_detail TEXT,  -- {bytes,total,speed,eta}
  last_error TEXT, error_kind TEXT,     -- retryable | permanent
  dedupe_key TEXT,
  created_at INTEGER, updated_at INTEGER, started_at INTEGER, finished_at INTEGER
);
CREATE INDEX jobs_ready ON jobs(status, run_after, priority);
CREATE UNIQUE INDEX jobs_dedupe ON jobs(dedupe_key) WHERE status IN ('queued','running');
```

- **Claim:** one transaction:

  ```sql
  UPDATE jobs SET status='running', attempts=attempts+1, lease_owner=?, lease_expires_at=?, started_at=?
  WHERE id=(SELECT id FROM jobs WHERE status='queued' AND run_after<=? AND resource=?
            ORDER BY priority DESC, created_at LIMIT 1)
  RETURNING *
  ```

  better-sqlite3 is synchronous, so a single process can't race with itself.

- **Heartbeat:** a running job extends `lease_expires_at` every 15 s.
- **Recovery at boot:** `UPDATE jobs SET status='queued', lease_owner=NULL, attempts=attempts-1 WHERE status='running'`.
  - A crash doesn't count as an attempt.
  - The downloader resumes from `*.part` through `Range`.
  - Expired leases are recovered the same way, which protects against a hung worker.
- **Retries (F5):** errors are typed in the domain as `RetryableError` (network, 5xx, 429, timeout) and `PermanentError` (404, parse, md5 mismatch after 2 tries, extractor unsupported).
  - On retryable, with `attempts < max`: `status='queued', run_after = now + min(30s·2^(attempts-1), 6h) · (0.5 + random·0.5)`, using `Retry-After` when present.
  - Otherwise `failed`.
  - `POST /jobs/:id/retry` resets `attempts=0` and sets `run_after=now`.
- **Concurrency:** a `Semaphore` per resource, configurable (`browser: 1`, `download: 2`, `ffmpeg: 1`), plus a per-host limit of IA = 1–2.
  - Workers wake on an in-process `EventEmitter` notice when a job is enqueued, and poll every 2 s as a fallback.
- **Cancellation:**
  - `Map<jobId, AbortController>`.
  - Cancel on a queued job sets `cancelled`.
  - Cancel on a running job calls `abort()`.
  - The signal flows into `fetch(url, { signal })`, `spawn(..., { signal })` (kills ffmpeg) and Playwright (`context.close()` on abort).
  - Then mark it `cancelled` and delete the `.part`.
- **Events:** the repository writes go first, then the `JobEvents` bus publishes `job.updated` / `job.progress`, which the SSE endpoint serves.
  - Throttle progress to 1 event per second per job.
  - Each event carries a sequence `id`, so on reconnect the client calls `GET /jobs` and resumes.
- **Pipeline for one `download_episode`:**
  1. Resolve the source. The IA extractor already gives a direct URL; otherwise use `StreamDetector`.
  2. Download through `Downloader`.
  3. Write the file and the nfo through `LibraryWriter` (atomic rename).
  4. Mark the episode `available`.
  5. Enqueue `refresh_library`, with dedupe key `refresh:{seriesId}` and a 60 s debounce through `run_after`. That way 20 episodes trigger 1 refresh.

## 6. HTTP API (F4)

**Auth:** `POST /auth/login {username,password}`:

1. Call `AuthenticateByName` with H&M's clientInfo.
2. If `!User.Policy.IsAdministrator`, return 403.
3. Immediately **revoke that Jellyfin token** (`reportSessionEnded`), so no user token is ever stored.
4. Create `sessions(id = 32 random bytes in base64url, user_id, user_name, created_at, expires_at)`.
5. Set the `hm_session` cookie: `HttpOnly; SameSite=Strict; Path=/`, with `Secure` only behind HTTPS (LAN is http for now).

Every hour, the middleware re-checks that the user is still an admin, using the API key (`GET /Users/{id}`). `POST /auth/logout` and `GET /auth/me` complete the set. Mutating routes also go through `hono/csrf` (Origin check) and `bodyLimit`.

| Route                                                                                 | Purpose                                                                                                                                            |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /extractors`                                                                     | `[{id, name, hosts, example}]`                                                                                                                     |
| `POST /series/preview {url}`                                                          | Runs the extractor and returns `{series, seasons[], episodes[], license, warnings[]}` (inferred numbers, gaps, compilation). **Does not persist.** |
| `POST /series {previewToken \| edited preview, follow?, licenseAck}`                  | Persists the series and episodes, and optionally enqueues every episode.                                                                           |
| `GET /series`, `GET /series/:id`, `PATCH /series/:id` (title, year, follow, interval) |                                                                                                                                                    |
| `GET /series/:id/episodes`                                                            | Status per episode: `missing \| queued \| downloading \| available \| failed`.                                                                     |
| `POST /jobs {episodeIds[]}` / `POST /series/:id/download`                             | Enqueue (deduped).                                                                                                                                 |
| `GET /jobs?status=&limit=&cursor=`                                                    | History.                                                                                                                                           |
| `POST /jobs/:id/retry`, `POST /jobs/:id/cancel`                                       |                                                                                                                                                    |
| `GET /events`                                                                         | SSE: `job.updated`, `job.progress`, `series.updated`, plus a `ping` every 25 s.                                                                    |
| `GET /health`                                                                         | Unauthenticated, for Docker `HEALTHCHECK`.                                                                                                         |

**Monitoring (F5):**

- `series.follow` (boolean), `check_interval_hours` (default 12), `last_checked_at`, `last_remote_marker`.
  - For IA, `last_remote_marker` is `item_last_updated` in shape A, or the scrape `total` plus the newest `addeddate` in shape B.
- A scheduler tick every 5 minutes enqueues `check_series` (dedupe `check:{id}`) for due series.
- The job re-runs the extractor only if the marker changed. It upserts new episodes and enqueues them.

## 7. Dockerfile (built on the host)

```dockerfile
FROM node:24-trixie-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @orca/hm-server build \
 && pnpm --filter @orca/hm-server deploy --prod /out   # verify `pnpm deploy` flags for the repo's pnpm version

FROM node:24-trixie-slim
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out ./
RUN npx -y playwright@1.64.1 install --with-deps --only-shell chromium && chown -R node /ms-playwright
USER node
VOLUME ["/data", "/media"]
# Image layout, not host settings:
ENV DB_FILE=/data/hm.sqlite MEDIA_ROOT=/media/tv HOST=0.0.0.0 PORT=8787
EXPOSE 8787
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["tini","--"]
CMD ["node","dist/main.mjs"]
```

- The image runs as non-root (`node`). Playwright's docs recommend non-root for scraping untrusted sites; running as root disables the Chromium sandbox.
- Compose (added by Bifröst):
  - `ipc: host` or `shm_size: 1gb`, plus `init: true`, both recommended by Playwright.
  - `mem_limit: ~1.5g` (8 GB host).
  - Ports on the **LAN IP only**.
  - Volumes: `hm-data:/data` and the 1 TB disk's TV folder mounted at **the same path inside both containers**, e.g. `/media/tv` in H&M and Jellyfin. That keeps the `Library/Media/Updated` paths identical. If the paths differ, use `JELLYFIN_MEDIA_ROOT`.
  - Env from `.env`: `JELLYFIN_URL`, `JELLYFIN_API_KEY`, `SESSION_SECRET`.
- **Configuration is environment-only, with no environment defaults in code.** Required, validated by Zod at boot (the error lists everything missing): `HOST`, `PORT`, `DB_FILE`, `MEDIA_ROOT`, `JELLYFIN_MEDIA_ROOT`, `JELLYFIN_URL`, `JELLYFIN_API_KEY`. Optional: `CONTACT_EMAIL` (User-Agent contact), `DEVICE_ID` (otherwise a UUID is generated once and stored in the database `settings` table), `WEB_ROOT`, `SECURE_COOKIES`, and the tuning knobs `DOWNLOAD_CONCURRENCY`, `FFMPEG_CONCURRENCY`, `BROWSER_CONCURRENCY`, which keep named-constant defaults. Per-host politeness is declared by each extractor (`limits: { metadataPerSec, downloadsPerHost }`) and only overridden by the optional `DOWNLOADS_PER_HOST` / `METADATA_PER_SEC`. F5 adds, all optional: `HM_GENERIC_DETECTOR=1` (off by default; with it on, `HM_DETECTOR_MAX_CONCURRENT`, `HM_DETECTOR_TIMEOUT_MS` and `HM_DETECTOR_SETTLE_MS` are required, plus optional `HM_DETECTOR_USER_AGENT`, `HM_CHROMIUM_PATH`, `HM_CHROMIUM_NO_SANDBOX`), the server-wide track defaults `DEFAULT_MAX_HEIGHT`, `DEFAULT_AUDIO_LANGS`, `DEFAULT_SUBTITLE_LANGS` (ISO 639-2 codes: `eng`, `spa`, `jpn`) and `SUBTITLES_EXTERNAL`. `apps/hm-server/.env.example` has example values.
- The Orca'JP client (`apps/jp`) takes its suggested servers only from `VITE_JELLYFIN_SERVERS` (comma-separated; `VITE_JELLYFIN_SERVER_URL` still works and is listed first). Unset, it offers only servers already signed in to, plus manual entry.
- Write files as the UID Jellyfin reads with (`PUID`), or set group-readable permissions.

## 8. Testing without network (Vitest under `vp test`)

- **Extractor:** a `HttpClient` port (`getJson(url)`). Tests use a map from URL to fixture file. Cover:
  - Shape A (bevhill): SxxEyy parsing, the e19 gap, capitalised `S01e21`, ogv deduplication.
  - Shape B (One Step Beyond): collection, two scrape pages with a cursor, `"S E13"` giving an inferred season, HTML stripped from descriptions.
  - Format ranking (`The_Beverly_Hillbillies`).
  - The URL normalizer table, and the license classifier (including "PD mark but 1982" raising a warning).
- **Domain and application:** use cases with in-memory fakes for `JobRepository`, `Clock` (manual time, for backoff and leases), `Downloader` (emits scripted progress, can fail or hang until aborted), `LibraryWriter` (in-memory FS, or `memfs`/tmpdir) and `MediaServer` (records calls).
- **Queue:** the real Drizzle repository on `new Database(":memory:")` plus `migrate()` per test. Cover:
  - Claim ordering and the dedupe index.
  - Recovery at boot (running back to queued).
  - Retry with `run_after`.
  - Cancellation of queued and running jobs via `AbortSignal`.
  - The semaphore never exceeding N.
- **Jellyfin adapter:** reuse the fake axios adapter (`fake-server.ts`) for `authenticateUserByName` (admin and non-admin), `postUpdatedMedia` and `getVirtualFolders`.
- **HTTP:** `app.request("/series/preview", { method: "POST", body, headers: { cookie } })` against `createApp(deps)` with fakes:
  - 401 without a session, 403 for a non-admin login, 400 from Zod.
  - SSE: read the first chunks of `res.body` and abort.
- **ffmpeg progress parser:** a pure function over recorded `-progress` output (like the sample above). One opt-in test runs real `ffmpeg` on a `lavfi testsrc`, skipped when ffmpeg is missing.
- **StreamDetector:** opt-in, against a local static page served by Hono that loads an `.m3u8` from the test server. Never runs on the internet in CI.
- **Library naming and NFO:** snapshot tests of `tvshow.nfo` and an episode `.nfo`, plus path sanitization.

---

Sources: [IA Item Metadata API](https://archive.org/developers/md-read.html), [IA Item Search APIs (scrape, cursor)](https://doc-tools.readthedocs.io/en/ia-test-gsod/item-search-apis.html), [Jellyfin NFO docs](https://jellyfin.org/docs/general/server/metadata/nfo/), [Jellyfin TV naming](https://jellyfin.org/docs/general/server/media/shows/), [Jellyfin source (XbmcMetadata savers/parsers, ItemRefreshController, LibraryController)](https://github.com/jellyfin/jellyfin), [Playwright Docker](https://playwright.dev/docs/docker), [Playwright system requirements](https://playwright.dev/docs/intro), [Wayback rate-limiting note (third-party)](https://www.kunalganglani.com/blog/wayback-machine-rate-limiting-mini-wayback.md), plus context7 for Hono, `@hono/zod-validator`, Drizzle and Vite+ `pack`.

## F5 notes

- **Following series.** A `Scheduler` ticks at boot and every 5 minutes, queues one `check_series` job per followed series whose interval ran out (`dedupeKey: check:{id}`), and the job asks the extractor for a cheap `remoteMarker` before reading anything. Internet Archive: `item_last_updated` for an item, `total:newest addeddate` for a collection. The marker is stored only after the episodes were upserted by their stable key (`sourceRef`); an episode the user left out when adding the series is remembered in `known_refs` and never comes back. A check that fails for good still stamps `last_checked_at`, so it is not queued again on every tick. `POST /api/series/:id/check` queues the same job ("check now").
- **Notifications** live only in the panel: a `notifications` table, `notification.created` over SSE, and a `Notifier` port (`PanelNotifier` is the only adapter; ntfy or others can be added to `NotificationService`'s list without touching callers). Kinds: `new_episodes` (one per check), `series_downloaded` (the last queued download of a series finished), `job_failed` (permanent failure or retries spent, never a retry).
- **Generic page detector.** Off unless `HM_GENERIC_DETECTOR=1`. Then `PlaywrightStreamDetector` resolves `page` sources and a `GenericPageExtractor` can be chosen explicitly in the panel (`extractorId` in the preview request; it never matches an address on its own and its license is always unknown, so the server always requires the acknowledgement). The Docker image only contains Chromium when built with `--build-arg WITH_CHROMIUM=1`.
- **Tracks.** HLS/DASH downloads are inspected with ffprobe (`@orca/media-probe`) using the detected headers, `selectStreams` chooses the tracks from the series' preferences over the server defaults, and the container is mkv (several audio tracks or embedded subtitles) or mp4. With `SUBTITLES_EXTERNAL=true` text subtitles become `Show S01E01.spa.srt` files beside the video instead. Languages are ISO 639-2 codes, three letters, as ffprobe reports them.

## What the generic detector can reach

The generic detector and the stream downloaders connect to addresses a web page chose. Two layers keep them away from this machine and its network (loopback, RFC 1918, link-local such as the 169.254.169.254 metadata address, CGNAT 100.64/10, unique-local fc00::/7, `0.0.0.0`, multicast and reserved ranges, Teredo, both NAT64 prefixes, and any IPv4 hidden in an IPv6 form such as `::ffff:127.0.0.1`).

1. **The guarded proxy (the real boundary).** When `HM_GENERIC_DETECTOR=1` the server starts a small forward proxy (plain HTTP and `CONNECT`) on `127.0.0.1` and an ephemeral port, and closes it on shutdown. It resolves each name once (cached for 30 s), refuses it if **any** record is blocked, and connects to **the very IP it checked**, so a name that changes its answer afterwards (DNS rebinding) gains nothing. It never follows a redirect: the client sends the next hop as a new request, which is checked like the first. Chromium is launched behind it (`proxy.bypass: "<-loopback>"`, so loopback also goes through it, with service workers blocked and WebRTC limited to proxied UDP), and ffprobe and ffmpeg fetch through it (`-http_proxy`, plus the `httpproxy` protocol), so Chromium's own redirects, HLS/DASH playlists, segments and keys, and ffmpeg's own redirects are all checked.
2. **The address guard (a second layer).** `AddressGuard` checks the page address (in the extractor and again in the browser), every request and WebSocket through `context.route` / `routeWebSocket` (a `ws:`/`wss:` address is read as the `http:`/`https:` one it travels over), the stream the detector found, the manifest handed to ffprobe and ffmpeg, and every hop of a direct download (`redirect: "manual"`, at most 5 hops, `Cookie` and `Origin` dropped when a hop changes host). `context.route` only ever sees the first URL of a request, which is why it is not the boundary.

What remains:

- **Direct files found on a page** are fetched by Node's `fetch` with the guard, not through the proxy: the name is resolved once for the check and again by the connection, so DNS rebinding is still possible on that path.
- **Headers.** The `Cookie`, `Referer` and `Origin` the browser used for a manifest are sent by ffmpeg with every request of that stream (`-headers` is not per host), so a playlist that lists segments on another public host sends them there too. A direct download drops `Cookie` and `Origin` on a cross-host redirect.
- **The proxy is a loopback service.** Anything else on the machine can use it to reach public addresses (not private ones).
- **Chromium's sandbox** is off when `HM_CHROMIUM_NO_SANDBOX=true` (usual in a container). A browser exploit is outside what the proxy can contain: for a real boundary, still give the container egress rules (a firewall, or a network that cannot reach the LAN).

## Chromium and Playwright

`playwright` is pinned to 1.64.1, which expects the Chromium build it downloads itself. The Docker image installs Debian's `chromium` package instead (`--build-arg WITH_CHROMIUM=1`, `HM_CHROMIUM_PATH=/usr/bin/chromium`), which is a different version: it works while the DevTools protocol stays compatible, and a Debian Chromium update, or a Playwright bump, may break the pairing (symptoms: the browser starts and then every page job fails with a protocol error). When that happens, pin the two together again or use `playwright install chromium`. With `HM_GENERIC_DETECTOR=1` the server checks at boot that the executable exists and refuses to start otherwise. Chromium in a container usually needs `HM_CHROMIUM_NO_SANDBOX=true`, which removes its own sandbox: one more reason for the egress rules above.
