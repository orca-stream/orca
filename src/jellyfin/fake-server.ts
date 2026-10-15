import { Jellyfin } from "@jellyfin/sdk";
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";

// Test-only helpers: nothing in the app imports this file, so it never reaches the bundle.

export const testJellyfin = new Jellyfin({
  clientInfo: { name: "orca", version: "test" },
  deviceInfo: { name: "Test", id: "device-1" },
});

export type Route = (
  config: InternalAxiosRequestConfig,
) => { status: number; data: unknown } | "offline";

/** An axios instance whose adapter answers from `route` instead of the network. */
export function fakeServer(route: Route) {
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
