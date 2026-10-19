import { describe, expect, it } from "vite-plus/test";
import { clientIpFromSshClient, ipInCidr, isNetworkCidr } from "../src/domain/net.ts";

describe("isNetworkCidr", () => {
  it("accepts real network addresses", () => {
    for (const c of [
      "192.168.1.0/24",
      "10.0.0.0/8",
      "172.16.0.0/12",
      "0.0.0.0/0",
      "192.168.1.7/32",
    ]) {
      expect(isNetworkCidr(c), c).toBe(true);
    }
  });
  it("rejects bad octets, bad prefixes, host bits and missing prefixes", () => {
    for (const c of [
      "999.1.1.1/24",
      "192.168.1.0/40",
      "192.168.1.5/24",
      "192.168.1.0",
      "192.168.1.0/",
      "a.b.c.d/8",
      "192.168.1.0/024x",
    ]) {
      expect(isNetworkCidr(c), c).toBe(false);
    }
  });
});

describe("ipInCidr", () => {
  it("checks membership", () => {
    expect(ipInCidr("192.168.1.50", "192.168.1.0/24")).toBe(true);
    expect(ipInCidr("192.168.2.50", "192.168.1.0/24")).toBe(false);
    expect(ipInCidr("10.1.2.3", "0.0.0.0/0")).toBe(true);
  });
});

describe("clientIpFromSshClient", () => {
  it("takes the first field of $SSH_CLIENT and only IPv4", () => {
    expect(clientIpFromSshClient("192.168.1.50 51234 22\n")).toBe("192.168.1.50");
    expect(clientIpFromSshClient("")).toBeUndefined();
    expect(clientIpFromSshClient("fe80::1 51234 22")).toBeUndefined();
  });
});
