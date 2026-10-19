import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiProvider } from "./api/ApiProvider";
import { createApiClient } from "./api/client";
import { dropSession } from "./auth/session";

/** One query client and one API client for the app; a 401 anywhere drops the session. */
export function Providers({ children }: { children: ReactNode }) {
  const [{ queryClient, api }] = useState(() => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          // A 4xx will not change by asking again; a restart or a blip might.
          retry: (count, error) =>
            !(
              error instanceof Error &&
              "status" in error &&
              Number(error.status) < 500 &&
              Number(error.status) > 0
            ) && count < 2,
          refetchOnWindowFocus: true,
        },
      },
    });
    const api = createApiClient({ onUnauthorized: () => dropSession(queryClient) });
    return { queryClient, api };
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={api}>{children}</ApiProvider>
    </QueryClientProvider>
  );
}
