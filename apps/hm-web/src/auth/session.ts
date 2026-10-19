import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useApi } from "../api/context";
import { ApiError, type ApiClient } from "../api/client";
import type { LoginBody, Me } from "../api/types";

export const ME_KEY = ["auth", "me"] as const;

/** The signed-in admin, or null when there is no session. Any other failure is a real error. */
async function fetchMe(api: ApiClient): Promise<Me | null> {
  try {
    return await api.get<Me>("/auth/me", { expectUnauthorized: true });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function useMe() {
  const api = useApi();
  return useQuery({ queryKey: ME_KEY, queryFn: () => fetchMe(api), staleTime: 60_000 });
}

/** What the API client does when any call finds the session gone: the gate then sends them to sign in. */
export function dropSession(queryClient: QueryClient) {
  queryClient.setQueryData(ME_KEY, null);
}

export function useLogin() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: LoginBody) => {
      await api.post("/auth/login", body, { expectUnauthorized: true });
      api.resetUnauthorized();
      return queryClient.fetchQuery({
        queryKey: ME_KEY,
        queryFn: () => fetchMe(api),
        staleTime: 0,
      });
    },
  });
}

export function useLogout() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  return useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSettled: () => {
      // Nothing cached for one session should be on screen for the next.
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });
}
