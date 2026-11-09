// A local mirror of the GitHub release files electron-builder downloads (Electron itself and its
// SHASUMS256.txt, NSIS, 7-Zip, its icons…), fetched through GitHub's API instead of the
// `releases/download` URLs. Those URLs have failed for hours with 504s while the API served the very
// same files (2026-11-08), and electron-builder neither retries nor skips the checksum file. The
// Release workflow starts it and points electron-builder at it:
//
//   ELECTRON_MIRROR=http://127.0.0.1:<port>/electron/electron/
//   ELECTRON_BUILDER_BINARIES_MIRROR=http://127.0.0.1:<port>/electron-userland/electron-builder-binaries/
//   ELECTRON_BUILDER_BINARIES_ALLOW_HTTP=true
//
// A request for /<owner>/<repo>/<tag>/<file> answers with that release asset. Only those two
// repositories are served. Checksums are still verified by electron-builder, as with GitHub.
//
// Usage: node scripts/release-mirror.ts <port>   (GH_TOKEN or GITHUB_TOKEN for the API)
import { createServer } from "node:http";
import { Readable } from "node:stream";

const REPOSITORIES = new Set(["electron/electron", "electron-userland/electron-builder-binaries"]);
const API = "https://api.github.com";
const ATTEMPTS = 4;

const port = Number(process.argv[2]);
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
if (!Number.isInteger(port) || port <= 0) throw new Error("Usage: release-mirror.ts <port>");

function headers(accept: string): Record<string, string> {
  return {
    accept,
    "user-agent": "orca-release-mirror",
    "x-github-api-version": "2022-11-28",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/** Fetches, trying again a few times on a network error or a 5xx. */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let last: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.status < 500) return response;
      last = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function assetUrl(repo: string, tag: string, file: string): Promise<string | undefined> {
  const response = await fetchWithRetry(
    `${API}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
    { headers: headers("application/vnd.github+json") },
  );
  if (!response.ok) return undefined;
  const release = (await response.json()) as { assets?: { name: string; url: string }[] };
  return release.assets?.find((asset) => asset.name === file)?.url;
}

createServer((request, response) => {
  void (async () => {
    const [owner, repo, tag, file, ...rest] = decodeURIComponent(
      new URL(request.url ?? "/", "http://mirror").pathname,
    )
      .split("/")
      .filter(Boolean);
    const name = `${owner}/${repo}`;
    if (!tag || !file || rest.length > 0 || !REPOSITORIES.has(name)) {
      response.writeHead(404).end();
      return;
    }
    const url = await assetUrl(name, tag, file);
    if (!url) {
      console.log(`404 ${name} ${tag} ${file}`);
      response.writeHead(404).end();
      return;
    }
    const asset = await fetchWithRetry(url, { headers: headers("application/octet-stream") });
    if (!asset.ok || !asset.body) throw new Error(`${asset.status} for ${name} ${tag} ${file}`);
    const length = asset.headers.get("content-length");
    response.writeHead(200, length ? { "content-length": length } : {});
    if (request.method === "HEAD") {
      await asset.body.cancel();
      response.end();
    } else {
      Readable.fromWeb(asset.body as import("node:stream/web").ReadableStream).pipe(response);
    }
    console.log(`200 ${name} ${tag} ${file}`);
  })().catch((error: unknown) => {
    console.error(`Mirror failed for ${request.url}: ${String(error)}`);
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
}).listen(port, "127.0.0.1", () => console.log(`Release mirror on http://127.0.0.1:${port}/`));
