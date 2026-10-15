import { Jellyfin } from "@jellyfin/sdk";
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { describe, expect, it } from "vite-plus/test";
import { signIn, SignInError, type SignInFailure } from "./sign-in";

const jellyfin = new Jellyfin({
  clientInfo: { name: "orca", version: "test" },
  deviceInfo: { name: "Test", id: "device-1" },
});

type Route = (config: InternalAxiosRequestConfig) => { status: number; data: unknown } | "offline";

/** An axios instance whose adapter answers from `route` instead of the network. */
function fakeServer(route: Route) {
  const requests: InternalAxiosRequestConfig[] = [];
  const instance = axios.create({
    adapter: async (config) => {
      requests.push(config);
      const answer = route(config);
      if (answer === "offline") {
        throw new AxiosError("Network Error", AxiosError.ERR_NETWORK, config);
      }
      const response: AxiosResponse = {
        data: answer.data,
        status: answer.status,
        statusText: String(answer.status),
        headers: {},
        config,
      };
      if (answer.status >= 400) {
        throw new AxiosError("Request failed", AxiosError.ERR_BAD_REQUEST, config, null, response);
      }
      return response;
    },
  });
  return { instance, requests };
}

const PUBLIC_INFO = { Id: "srv-1", Version: "12.2.0", ServerName: "Casa" };
const AUTH_RESULT = { AccessToken: "token-1", User: { Id: "user-1", Name: "Sam" } };

function healthyServer(
  auth: { status: number; data: unknown } = { status: 200, data: AUTH_RESULT },
) {
  return fakeServer((config) => {
    if (config.url?.endsWith("/System/Info/Public")) return { status: 200, data: PUBLIC_INFO };
    if (config.url?.endsWith("/Users/AuthenticateByName")) return auth;
    return { status: 404, data: "" };
  });
}

async function failure(promise: Promise<unknown>): Promise<SignInFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SignInError) return error.reason;
    throw error;
  }
  throw new Error("expected sign-in to fail");
}

const request = { server: "https://jf.example.com/web/#/home", username: "sam", password: "pw" };

describe("signIn", () => {
  it("signs in and returns a session against the normalized address", async () => {
    const { instance, requests } = healthyServer();
    const { api, session } = await signIn(jellyfin, request, instance);

    expect(session).toEqual({
      serverUrl: "https://jf.example.com",
      serverName: "Casa",
      accessToken: "token-1",
      userId: "user-1",
      userName: "Sam",
    });
    expect(api.accessToken).toBe("token-1");
    expect(requests.map((config) => config.url)).toEqual([
      "https://jf.example.com/System/Info/Public",
      "https://jf.example.com/Users/AuthenticateByName",
    ]);
    expect(JSON.parse(String(requests[1]?.data))).toEqual({ Username: "sam", Pw: "pw" });
  });

  it("rejects an address that can't be parsed before any request", async () => {
    const { instance, requests } = healthyServer();
    expect(await failure(signIn(jellyfin, { ...request, server: "  " }, instance))).toBe(
      "invalidAddress",
    );
    expect(requests).toHaveLength(0);
  });

  it("reports an unreachable server", async () => {
    const { instance } = fakeServer(() => "offline");
    expect(await failure(signIn(jellyfin, request, instance))).toBe("unreachable");
  });

  it("reports a server that isn't Jellyfin", async () => {
    const html = fakeServer(() => ({ status: 200, data: "<!doctype html>" }));
    expect(await failure(signIn(jellyfin, request, html.instance))).toBe("notJellyfin");

    const missing = fakeServer(() => ({ status: 404, data: "" }));
    expect(await failure(signIn(jellyfin, request, missing.instance))).toBe("notJellyfin");
  });

  it("reports wrong credentials", async () => {
    const { instance } = healthyServer({ status: 401, data: "" });
    expect(await failure(signIn(jellyfin, request, instance))).toBe("invalidCredentials");
  });

  it("treats an auth answer without a token as unknown", async () => {
    const { instance } = healthyServer({ status: 200, data: { User: { Id: "user-1" } } });
    expect(await failure(signIn(jellyfin, request, instance))).toBe("unknown");
  });
});
