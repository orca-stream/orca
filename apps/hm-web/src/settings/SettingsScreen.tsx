import { useState } from "react";
import type { JellyfinConnection, SettingsView } from "@/api/types";
import { Loading } from "@/components/loading";
import { PendingButton } from "@/components/pending-button";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/locale";
import { useExtractorsFile, useSaveExtractors, useSaveSettings, useSettings } from "./api";
import {
  draftFromView,
  extractorNames,
  settingsFromDraft,
  type Draft,
  type DraftErrors,
} from "./draft";
import {
  BrowserSection,
  DownloadsSection,
  ExtractorsSection,
  ExtrasSection,
  JellyfinSection,
  LibrarySection,
  ServerIssues,
  TracksSection,
} from "./sections";

/** The extractors, saved on their own: a new file restarts the server's extractors right away. */
function Extractors() {
  const t = useT();
  const file = useExtractorsFile();
  const save = useSaveExtractors();
  const [text, setText] = useState<string | null>(null);
  if (!file.isSuccess) return null;
  const shown = text ?? file.data;
  const changed = text !== null && text !== file.data;
  return (
    <>
      <ExtractorsSection
        text={shown}
        onText={setText}
        action={
          changed && (
            <PendingButton
              pending={save.isPending}
              onClick={() => save.mutate(shown, { onSuccess: () => setText(null) })}
            >
              {t.settings.save}
            </PendingButton>
          )
        }
      />
      {save.isSuccess && !changed && (
        <p role="status" className="-mt-3 px-2 text-sm text-muted-foreground">
          {t.settings.extractors.saved}
        </p>
      )}
      {save.isError && <ServerIssues error={save.error} />}
    </>
  );
}

function Form({ view }: { view: SettingsView }) {
  const t = useT();
  const save = useSaveSettings();
  const file = useExtractorsFile();
  const [draft, setDraft] = useState<Draft>(() => draftFromView(view));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [libraries, setLibraries] = useState<JellyfinConnection["libraries"] | null>(null);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const neededBySites = (extractorNames(file.data ?? "")?.length ?? 0) > 0;

  function submit() {
    const result = settingsFromDraft({ ...draft, browserOn: draft.browserOn || neededBySites });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    save.mutate(result.update, {
      // What was saved is what is shown: new keys are kept on the server, not in the form.
      onSuccess: (next) => setDraft(draftFromView(next)),
    });
  }

  return (
    <>
      <JellyfinSection
        draft={draft}
        set={set}
        during="settings"
        onConnected={(connection) => setLibraries(connection.libraries)}
      />
      <LibrarySection draft={draft} set={set} errors={errors} libraries={libraries} />
      <ExtrasSection draft={draft} set={set} errors={errors} />
      <DownloadsSection draft={draft} set={set} errors={errors} />
      <TracksSection draft={draft} set={set} errors={errors} />
      <BrowserSection draft={draft} set={set} errors={errors} neededBySites={neededBySites} />
      <div className="sticky bottom-6 z-10 flex flex-col items-end gap-2">
        {save.isError && (
          <div className="self-stretch rounded-2xl bg-white/85 p-4 backdrop-blur">
            <p className="text-sm text-warning">{t.settings.saveFailed}</p>
            <ServerIssues error={save.error} />
          </div>
        )}
        {save.isSuccess && (
          <p role="status" className="rounded-full bg-white/85 px-4 py-1.5 text-sm backdrop-blur">
            {t.settings.saved}
          </p>
        )}
        <PendingButton className="shadow-lg" onClick={submit} pending={save.isPending}>
          {save.isPending ? t.settings.saving : t.settings.save}
        </PendingButton>
      </div>
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 pb-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t.settings.title}</h1>
      {settings.isError ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert">{t.settings.loadFailed}</p>
          <Button onClick={() => void settings.refetch()}>{t.common.retry}</Button>
        </div>
      ) : settings.isSuccess ? (
        <>
          <Form view={settings.data} />
          <Extractors />
        </>
      ) : (
        <Loading className="size-8 self-center" />
      )}
    </div>
  );
}
