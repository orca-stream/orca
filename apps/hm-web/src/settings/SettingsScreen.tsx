import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import logotype from "@/assets/logotype.svg";
import type { JellyfinConnection, SettingsView } from "@/api/types";
import { Loading } from "@/components/loading";
import { Dock, DockAdd, DockPlaces } from "@/components/dock";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import { ISLAND, PILL_BUTTON, PRIMARY } from "@/series/bar";
import { useExtractorsFile, useSaveExtractors, useSaveSettings, useSettings } from "./api";
import {
  draftFromView,
  extractorNames,
  settingsFromDraft,
  type Draft,
  type DraftErrors,
} from "./draft";
import {
  AccessSection,
  BrowserSection,
  DownloadsSection,
  ExtractorsSection,
  ExtrasSection,
  JellyfinSection,
  LibrarySection,
  ServerIssues,
  TracksSection,
} from "./sections";
import { NoteRow, Panel, PanelButton } from "./rows";

/**
 * The extractors, saved on their own as soon as a file is picked: a new file restarts the server's
 * extractors right away. Only a failure stays on screen, with the way to try again.
 */
function Extractors() {
  const t = useT();
  const file = useExtractorsFile();
  const save = useSaveExtractors();
  const [text, setText] = useState<string | null>(null);
  if (!file.isSuccess) return null;
  const shown = text ?? file.data;
  const store = (next: string) => save.mutate(next, { onSuccess: () => setText(null) });
  return (
    <>
      <ExtractorsSection
        text={shown}
        onText={(next) => {
          setText(next);
          store(next);
        }}
      />
      {save.isError && (
        <NoteRow
          icon={Alert02Icon}
          tone="warning"
          action={
            <PanelButton variant="outline" pending={save.isPending} onClick={() => store(shown)}>
              {t.common.retry}
            </PanelButton>
          }
        >
          <ServerIssues error={save.error} />
        </NoteRow>
      )}
    </>
  );
}

/** How long "Saved" stays on the bar before the bar goes. */
const SAVED_SHOWN_MS = 4000;

function Form({ view, extractors }: { view: SettingsView; extractors: ReactNode }) {
  const t = useT();
  const save = useSaveSettings();
  const removeKey = useSaveSettings();
  const file = useExtractorsFile();
  const [draft, setDraft] = useState<Draft>(() => draftFromView(view));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [libraries, setLibraries] = useState<JellyfinConnection["libraries"] | null>(null);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const neededBySites = (extractorNames(file.data ?? "")?.length ?? 0) > 0;
  const saved = useMemo(() => draftFromView(view), [view]);
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);

  // "Saved" says so for a moment, then the bar goes until something changes again.
  const { isSuccess, reset } = save;
  useEffect(() => {
    if (!isSuccess) return;
    const timer = setTimeout(reset, SAVED_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [isSuccess, reset]);

  function submit() {
    const result = settingsFromDraft({ ...draft, browserOn: draft.browserOn || neededBySites });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (draft.signIn === "local" && view.localAdmin === null) {
      setErrors({ signIn: "admin" });
      return;
    }
    setErrors({});
    save.mutate(result.update, {
      // What was saved is what is shown: new keys are kept on the server, not in the form.
      onSuccess: (next) => setDraft(draftFromView(next)),
    });
  }

  /** The TMDB key goes at once, from what is saved; the rest of the form keeps its edits. */
  function removeTmdbKey() {
    const result = settingsFromDraft({ ...saved, removeTmdb: true });
    if (!result.ok) return;
    removeKey.mutate(result.update, {
      onSuccess: () => set({ hasTmdbApiKey: false, tmdbApiKey: "", removeTmdb: false }),
    });
  }

  const showBar = changed || save.isPending || save.isError || save.isSuccess;
  return (
    <>
      <AccessSection
        draft={draft}
        set={set}
        errors={errors}
        saved={{ signIn: view.signIn, localAdmin: view.localAdmin }}
      />
      <JellyfinSection
        draft={draft}
        set={set}
        during="settings"
        onConnected={(connection) => setLibraries(connection.libraries)}
      />
      {extractors}
      <LibrarySection
        draft={draft}
        set={set}
        errors={errors}
        libraries={libraries}
        during="settings"
      />
      <ExtrasSection
        draft={draft}
        set={set}
        errors={errors}
        onRemoveKey={removeTmdbKey}
        removing={removeKey.isPending}
      />
      {removeKey.isError && (
        <NoteRow icon={Alert02Icon} tone="warning">
          <p role="alert">{t.settings.tmdb.removeFailed}</p>
          <ServerIssues error={removeKey.error} />
        </NoteRow>
      )}
      <DownloadsSection draft={draft} set={set} errors={errors} />
      <TracksSection draft={draft} set={set} errors={errors} />
      <BrowserSection draft={draft} set={set} errors={errors} neededBySites={neededBySites} />
      {/* What is unsaved, and the button that saves it, as the series' selection bar: there only
          while there is something to say. */}
      {showBar && (
        <div
          role="toolbar"
          aria-label={t.settings.save}
          className={cn(ISLAND, "bottom-4 mx-4 mb-4")}
        >
          <div className="mr-auto min-w-0 text-sm font-medium">
            {save.isError ? (
              <>
                <p className="text-warning">{t.settings.saveFailed}</p>
                <ServerIssues error={save.error} />
              </>
            ) : changed || save.isPending ? (
              <p>{t.settings.unsaved}</p>
            ) : (
              <p role="status">{t.settings.saved}</p>
            )}
          </div>
          {(changed || save.isPending || save.isError) && (
            <button
              type="button"
              disabled={save.isPending}
              aria-busy={save.isPending || undefined}
              onClick={submit}
              className={cn(PILL_BUTTON, PRIMARY)}
            >
              {save.isPending && <Spinner aria-hidden="true" />}
              {save.isError ? t.common.retry : t.settings.save}
            </button>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Everything the server does, changed in one place: saving restarts what the settings drive, and the
 * server keeps the old ones when the new ones cannot run.
 */
export function SettingsScreen() {
  const t = useT();
  const settings = useSettings();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-10">
      <Panel className="overflow-visible">
        <header className="px-4 py-6">
          {/* "Settings" and the logotype as one title, read as "Settings ORCA'H&M". */}
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {t.settings.title}
            <img src={logotype} alt={t.brand} className="h-7 w-auto" />
          </h1>
        </header>
        {settings.isError ? (
          <NoteRow
            icon={Alert02Icon}
            action={
              <Button className="rounded-full" onClick={() => void settings.refetch()}>
                {t.common.retry}
              </Button>
            }
          >
            <p role="alert">{t.settings.loadFailed}</p>
          </NoteRow>
        ) : settings.isSuccess ? (
          <Form view={settings.data} extractors={<Extractors />} />
        ) : (
          <div className="flex justify-center border-t border-t-(--glass-edge) py-10">
            <Loading className="size-8" />
          </div>
        )}
      </Panel>
      {/* No bar on top: the dock is the way back. */}
      <Dock label={t.dock.label}>
        <DockPlaces here="settings" />
        <DockAdd />
      </Dock>
    </div>
  );
}
