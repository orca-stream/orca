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

  it("refuses header values that would inject another header", () => {
    expect(() => buildFfprobeArgs("https://x.test/a", { Cookie: "a\r\nX: y" }, "http")).toThrow(
      MediaProbeError,
    );
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
