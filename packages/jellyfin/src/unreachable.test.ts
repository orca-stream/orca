import { describe, expect, it } from "vite-plus/test";
import { AxiosError, AxiosHeaders } from "axios";
import { isUnreachable } from "./unreachable.ts";

describe("isUnreachable", () => {
  const config = { headers: new AxiosHeaders() };

  it("is true when the server never answered", () => {
    expect(isUnreachable(new AxiosError("timeout", "ECONNABORTED", config))).toBe(true);
    expect(isUnreachable(new AxiosError("Network Error", "ERR_NETWORK", config))).toBe(true);
  });

  it("is false when the server answered, even with an error", () => {
    const response = { status: 500, statusText: "", headers: {}, config, data: "" };
    expect(isUnreachable(new AxiosError("boom", "ERR_BAD_RESPONSE", config, null, response))).toBe(
      false,
    );
    expect(isUnreachable(new Error("not axios"))).toBe(false);
  });
});
