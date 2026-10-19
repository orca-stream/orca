import { describe, expect, it } from "vite-plus/test";
import { PermanentError } from "../src/domain/errors.ts";
import { AddressGuard, isBlockedAddress } from "../src/infrastructure/net/address-guard.ts";

describe("isBlockedAddress", () => {
  it.each([
    // loopback, "this" network, private ranges
    "127.0.0.1",
    "127.255.255.254",
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.145",
    // link-local and cloud metadata
    "169.254.169.254",
    "169.254.0.1",
    // carrier-grade NAT (also Alibaba's metadata at 100.100.100.200)
    "100.64.0.1",
    "100.100.100.200",
    "100.127.255.255",
    // benchmarking, multicast, reserved, broadcast
    "198.18.0.1",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    // IPv6
    "::1",
    "::",
    "fe80::1",
    "febf::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    // IPv4 inside IPv6, in every spelling
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "::ffff:a00:1",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "0:0:0:0:0:ffff:192.168.0.1",
    "[::1]",
    // local-use NAT64 and Teredo tunnels, which can wrap any IPv4 address
    "64:ff9b:1::7f00:1",
    "64:ff9b:1:ffff::1",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "2001::1",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "151.101.1.69",
    "172.15.0.1",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "169.253.0.1",
    "198.17.0.1",
    "198.20.0.1",
    "2606:4700:4700::1111",
    "2001:db8::1",
    "::ffff:8.8.8.8",
    "::ffff:808:808",
    "2001:1::1",
    "2001:4860:4860::8888",
  ])("allows %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it("blocks what is not an address at all, because nothing safe can be said about it", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
    expect(isBlockedAddress("999.1.1.1")).toBe(true);
  });
});

describe("AddressGuard", () => {
  const dns = (table: Record<string, string[]>) => async (host: string) => {
    const addresses = table[host];
    if (!addresses) throw Object.assign(new Error(`ENOTFOUND ${host}`), { code: "ENOTFOUND" });
    return addresses;
  };
  const guard = new AddressGuard({
    resolve: dns({
      "videos.example.com": ["93.184.216.34"],
      "inside.example.com": ["10.0.0.9"],
      "mixed.example.com": ["93.184.216.34", "10.0.0.7"],
      "rebind.example.com": ["127.0.0.1"],
      "v6.example.com": ["2606:4700:4700::1111"],
      localhost: ["127.0.0.1", "::1"],
    }),
  });

  it("lets a public web address through and returns it parsed", async () => {
    const url = await guard.assertUrl("https://videos.example.com/watch/1?a=b");
    expect(url.host).toBe("videos.example.com");
    await expect(guard.assertUrl("http://v6.example.com/x")).resolves.toBeInstanceOf(URL);
  });

  it("refuses anything that is not http or https", async () => {
    for (const bad of [
      "ftp://videos.example.com/x",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,hi",
      "gopher://videos.example.com",
      "ws://videos.example.com",
    ]) {
      await expect(guard.assertUrl(bad)).rejects.toBeInstanceOf(PermanentError);
    }
    await expect(guard.assertUrl("not a url")).rejects.toBeInstanceOf(PermanentError);
  });

  it("refuses a literal private address in every spelling the URL parser normalises", async () => {
    for (const bad of [
      "http://127.0.0.1/",
      "http://2130706433/", // decimal
      "http://0x7f.0.0.1/", // hex
      "http://0177.0.0.1/", // octal
      "http://127.1/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:7f00:1]/",
      "http://169.254.169.254/latest/meta-data/",
      "http://192.168.1.145:8096/",
      "http://0.0.0.0:8787/",
    ]) {
      await expect(guard.assertUrl(bad), bad).rejects.toBeInstanceOf(PermanentError);
    }
  });

  it("refuses a name that resolves to a private address, even if only one answer does", async () => {
    await expect(guard.assertUrl("http://localhost:8787/")).rejects.toThrow(/private|internal/i);
    await expect(guard.assertUrl("http://rebind.example.com/")).rejects.toBeInstanceOf(
      PermanentError,
    );
    await expect(guard.assertUrl("http://mixed.example.com/")).rejects.toBeInstanceOf(
      PermanentError,
    );
  });

  it("explains a name that does not resolve, as something worth another try later", async () => {
    const error = (await guard
      .assertUrl("http://nowhere.example.com/")
      .catch((e: unknown) => e)) as Error;
    expect(error.message).toMatch(/nowhere\.example\.com/);
    expect(error.name).toBe("RetryableError");
  });

  it("names the address in the refusal without echoing credentials", async () => {
    const error = (await guard
      .assertUrl("http://user:secret@127.0.0.1/")
      .catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain("secret");
  });

  it("refuses an address with credentials in it at all", async () => {
    await expect(guard.assertUrl("https://user:pass@videos.example.com/")).rejects.toBeInstanceOf(
      PermanentError,
    );
  });

  it("reads a WebSocket address as the http(s) address it travels over", async () => {
    expect(await guard.isAllowed("wss://videos.example.com/live")).toBe(true);
    expect(await guard.isAllowed("ws://videos.example.com/live")).toBe(true);
    expect(await guard.isAllowed("ws://127.0.0.1:8096/socket")).toBe(false);
    expect(await guard.isAllowed("wss://[::1]/socket")).toBe(false);
    expect(await guard.isAllowed("wss://inside.example.com/x")).toBe(false);
  });

  it("answers the browser's yes/no question without throwing", async () => {
    expect(await guard.isAllowed("https://videos.example.com/a.m3u8")).toBe(true);
    expect(await guard.isAllowed("http://127.0.0.1/")).toBe(false);
    expect(await guard.isAllowed("http://nowhere.example.com/")).toBe(false);
    // Nothing leaves the machine for these, so the page may use them.
    expect(await guard.isAllowed("data:text/plain,hi")).toBe(true);
    expect(await guard.isAllowed("blob:https://videos.example.com/abc")).toBe(true);
    expect(await guard.isAllowed("about:blank")).toBe(true);
  });
});
