import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/api/context";
import { keys } from "@/api/keys";
import type {
  JellyfinConnection,
  Settings,
  SettingsUpdate,
  SettingsView,
  SetupStatus,
} from "@/api/types";

export interface ConnectInput {
  url: string;
  username: string;
  password: string;
  /** Before the server is set up, from another device. */
  code?: string;
}

/** Whether the server still has to be set up. Asked once; the setup itself says when it is done. */
export function useSetupStatus() {
  const api = useApi();
  return useQuery({
    queryKey: keys.setup,
    queryFn: ({ signal }) => api.get<SetupStatus>("/setup", { signal }),
    staleTime: Infinity,
  });
}

/** Signs in to Jellyfin as an administrator; the server makes itself a key there. */
export function useConnectJellyfin(during: "setup" | "settings") {
  const api = useApi();
  return useMutation({
    mutationFn: (input: ConnectInput) =>
      api.post<JellyfinConnection>(
        during === "setup" ? "/setup/jellyfin" : "/settings/jellyfin",
        input,
        {
          expectUnauthorized: true,
        },
      ),
  });
}

export function useFinishSetup() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { settings: Settings; extractors?: string; code?: string }) =>
      api.post("/setup", body),
    onSuccess: () =>
      queryClient.setQueryData<SetupStatus>(keys.setup, {
        configured: true,
        needsCode: false,
      }),
  });
}

export function useSettings() {
  const api = useApi();
  return useQuery({
    queryKey: keys.settings,
    queryFn: ({ signal }) => api.get<SettingsView>("/settings", { signal }),
  });
}

export function useSaveSettings() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: SettingsUpdate) => api.put<SettingsView>("/settings", update),
    onSuccess: (view) => {
      queryClient.setQueryData(keys.settings, view);
      // The extractors and the TMDB guide may have changed with them.
      void queryClient.invalidateQueries({ queryKey: keys.extractors });
      void queryClient.invalidateQueries({ queryKey: ["lookup"] });
    },
  });
}

/** The extractors file's text, as the server keeps it. */
export function useExtractorsFile() {
  const api = useApi();
  return useQuery({
    queryKey: keys.extractorsFile,
    // The client reads it as JSON; laid out again, it reads the way the file is written.
    queryFn: async ({ signal }) =>
      `${JSON.stringify(await api.get<unknown>("/settings/extractors", { signal }), null, 2)}\n`,
  });
}

export function useSaveExtractors() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api.put("/settings/extractors", { text }),
    onSuccess: (_, text) => {
      queryClient.setQueryData(keys.extractorsFile, text.trim() === "" ? "{}\n" : text);
      void queryClient.invalidateQueries({ queryKey: keys.extractors });
    },
  });
}
