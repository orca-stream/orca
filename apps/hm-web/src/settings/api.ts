import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/api/context";
import { keys } from "@/api/keys";
import { dropSession } from "@/auth/session";
import type {
  FolderListing,
  JellyfinConnection,
  LocalAdminBody,
  Settings,
  SettingsUpdate,
  SettingsView,
  SetupStatus,
} from "@/api/types";

export interface ConnectInput {
  url: string;
  username: string;
  password: string;
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

/**
 * Saves the first settings. The panel leaves the setup only through `useSetupDone`, once the person
 * is signed in: leaving at once would ask who is signed in before the sign-in, and send them to it.
 */
export function useFinishSetup() {
  const api = useApi();
  return useMutation({
    mutationFn: (body: { settings: Settings; extractors?: string; admin?: LocalAdminBody }) =>
      api.post("/setup", body),
  });
}

/** Swaps the setup for the panel, with what the server was set up with. */
export function useSetupDone() {
  const queryClient = useQueryClient();
  return (settings: Settings) =>
    queryClient.setQueryData<SetupStatus>(keys.setup, {
      configured: true,
      signIn: settings.signIn,
      jellyfin: settings.jellyfin !== undefined,
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
      const before = queryClient.getQueryData<SettingsView>(keys.settings)?.signIn;
      queryClient.setQueryData(keys.settings, view);
      queryClient.setQueryData<SetupStatus>(keys.setup, {
        configured: true,
        signIn: view.signIn,
        jellyfin: view.jellyfin !== undefined,
      });
      // Someone else signs in now: the server ended every session, this one included.
      if (before !== undefined && before !== view.signIn) dropSession(queryClient);
      // The extractors and the TMDB guide may have changed with them.
      void queryClient.invalidateQueries({ queryKey: keys.extractors });
      void queryClient.invalidateQueries({ queryKey: ["lookup"] });
    },
  });
}

/** Makes, or changes, the server's own administrator. */
export function useSaveLocalAdmin() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LocalAdminBody) => api.put("/settings/admin", body),
    onSuccess: (_, body) =>
      queryClient.setQueryData<SettingsView>(keys.settings, (view) =>
        view ? { ...view, localAdmin: { username: body.username } } : view,
      ),
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

/**
 * The folders inside one folder of the server's disk (its home folder when `path` is null), to pick
 * the series folder from. Asked through the setup until the server is set up, then from Settings.
 */
export function useFolders(during: "setup" | "settings", path: string | null, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: keys.folders(path),
    queryFn: ({ signal }) =>
      api.get<FolderListing>(
        `${during === "setup" ? "/setup/folders" : "/settings/folders"}${
          path === null ? "" : `?path=${encodeURIComponent(path)}`
        }`,
        { signal },
      ),
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** Makes a new folder inside the one being shown, through the same door the folders are asked by. */
export function useMakeFolder(during: "setup" | "settings") {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { parent: string; name: string }) =>
      api.post<{ path: string }>(during === "setup" ? "/setup/folders" : "/settings/folders", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["folders"] }),
  });
}
