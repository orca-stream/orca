import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ApiProvider } from "../api/ApiProvider";
import { createApiClient } from "../api/client";
import { I18nProvider } from "../i18n/locale";
import type { Locale } from "../i18n/messages";
import { requestUrl } from "./request-url";

export type Handler = (request: Request) => Response | Promise<Response>;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Options {
  /** Answers every request the screen makes; the requests are recorded in `requests`. */
  handler?: Handler;
  path?: string;
  locale?: Locale;
}

/** Renders inside every provider the app has, with an in-memory location and a fake network. */
export function renderApp(ui: ReactElement, { handler, path = "/", locale = "es" }: Options = {}) {
  const requests: Request[] = [];
  const unauthorized: number[] = [];
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const api = createApiClient({
    fetch: async (input, init) => {
      const request = new Request(new URL(requestUrl(input), "http://panel.test"), init);
      requests.push(request.clone());
      return handler ? handler(request) : jsonResponse({ error: "not_found" }, 404);
    },
    onUnauthorized: () => unauthorized.push(Date.now()),
  });
  const location = memoryLocation({ path, record: true });
  const view = render(
    <I18nProvider locale={locale}>
      <QueryClientProvider client={queryClient}>
        <ApiProvider client={api}>
          <Router hook={location.hook} searchHook={location.searchHook}>
            {ui}
          </Router>
        </ApiProvider>
      </QueryClientProvider>
    </I18nProvider>,
  );
  return { ...view, requests, unauthorized, queryClient, api, location };
}
