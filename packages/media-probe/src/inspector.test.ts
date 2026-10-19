import { describe, expect, it } from "vite-plus/test";
import { fixture } from "../test/fixtures.ts";
import { FfprobeInspector, MediaProbeError, buildFfprobeArgs } from "./index.ts";

describe("buildFfprobeArgs", () => {
  it("asks for programs and streams as JSON and limits the protocols", () => {
    const args = buildFfprobeArgs("https://cdn.test/master.m3u8", {}, "http,https,tcp,tls,crypto");
    expect(args).toEqual([
      "-v",
      "error",
      "-protocol_whitelist",
      "http,https,tcp,tls,crypto",
      "-show_programs",
      "-show_streams",
      "-of",
      "json",
      "https://cdn.test/master.m3u8",
    ]);
  });

  it("sends the headers as one CRLF-terminated block, before the input", () => {
    const args = buildFfprobeArgs(
      "https://cdn.test/a.m3u8",
      { Referer: "https://site.test/", Cookie: "sid=1" },
      "http,https",
    );
    const at = args.indexOf("-headers");
    expect(args[at + 1]).toBe("Referer: https://site.test/\r\nCookie: sid=1\r\n");
    expect(at).toBeLessThan(args.indexOf("https://cdn.test/a.m3u8"));
  });

  it("goes through an HTTP proxy when given one, which needs the httpproxy protocol too", () => {
    const args = buildFfprobeArgs(
      "https://cdn.test/a.m3u8",
      {},
      "http,https,tcp,tls,crypto",
      "http://127.0.0.1:4040",
    );
    const at = args.indexOf("-http_proxy");
    expect(args[at + 1]).toBe("http://127.0.0.1:4040");
    expect(at).toBeLessThan(args.indexOf("https://cdn.test/a.m3u8"));
    const whitelist = args[args.indexOf("-protocol_whitelist") + 1]!.split(",");
    expect(whitelist).toContain("httpproxy");
    expect(whitelist).toContain("http");
  });

  it("does not add the proxy protocol when there is no proxy", () => {
    const args = buildFfprobeArgs("https://x.test/a", {}, "http,https");
    expect(args).not.toContain("-http_proxy");
    expect(args[args.indexOf("-protocol_whitelist") + 1]).toBe("http,https");
  });

  it("refuses header values that would inject another header", () => {
    expect(() => buildFfprobeArgs("https://x.test/a", { Cookie: "a\r\nX: y" }, "http")).toThrow(
      MediaProbeError,
    );
  });
});

describe("FfprobeInspector with a proxy", () => {
  it("runs ffprobe through the proxy it was given", async () => {
    let seen: string[] = [];
    const inspector = new FfprobeInspector({
      httpProxy: "http://127.0.0.1:4040",
      run: (args) => {
        seen = args;
        return Promise.resolve({ stdout: JSON.stringify(fixture("mp4-single-audio")) });
      },
    });
    await inspector.inspect("https://cdn.test/a.mp4", { signal: new AbortController().signal });
    expect(seen[seen.indexOf("-http_proxy") + 1]).toBe("http://127.0.0.1:4040");
    expect(seen[seen.indexOf("-protocol_whitelist") + 1]).toContain("httpproxy");
  });
});

describe("FfprobeInspector", () => {
  const options = { protocolWhitelist: "http,https,tcp,tls,crypto" };

  it("parses what ffprobe printed", async () => {
    const json = JSON.stringify(fixture("mp4-single-audio"));
    let seen: string[] = [];
    const inspector = new FfprobeInspector({
      ...options,
      run: (args) => {
        seen = args;
        return Promise.resolve({ stdout: json });
      },
    });
    const probe = await inspector.inspect("https://cdn.test/a.mp4", {
      signal: new AbortController().signal,
      headers: { Cookie: "sid=1" },
    });
    expect(probe.streams).toHaveLength(2);
    expect(seen).toContain("-headers");
  });

  it("turns invalid JSON into a MediaProbeError", async () => {
    const inspector = new FfprobeInspector({
      ...options,
      run: () => Promise.resolve({ stdout: "not json" }),
    });
    await expect(
      inspector.inspect("https://cdn.test/a.mp4", { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ name: "MediaProbeError", reason: "parse" });
  });

  it("passes failures of the process through", async () => {
    const inspector = new FfprobeInspector({
      ...options,
      run: () => Promise.reject(new MediaProbeError("exit", "ffprobe exited with 1")),
    });
    await expect(
      inspector.inspect("https://cdn.test/a.mp4", { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ reason: "exit" });
  });

  it("does not start when already aborted", async () => {
    let ran = false;
    const inspector = new FfprobeInspector({
      ...options,
      run: () => {
        ran = true;
        return Promise.resolve({ stdout: "{}" });
      },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      inspector.inspect("https://cdn.test/a.mp4", { signal: controller.signal }),
    ).rejects.toMatchObject({ reason: "aborted" });
    expect(ran).toBe(false);
  });
});
