import { useState } from "react";
import { Alert02Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import type { JellyfinConnection, SettingsView } from "@/api/types";
import { Loading } from "@/components/loading";
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
import { FooterRow, NoteRow, Panel, PanelButton } from "./rows";

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
        during="settings"
        action={
          changed && (
            <PanelButton
              pending={save.isPending}
              onClick={() => save.mutate(shown, { onSuccess: () => setText(null) })}
            >
              {t.settings.save}
            </PanelButton>
          )
        }
      />
      {save.isSuccess && !changed && (
        <NoteRow icon={CheckmarkCircle02Icon}>
          <p role="status">{t.settings.extractors.saved}</p>
        </NoteRow>
      )}
      {save.isError && (
        <NoteRow icon={Alert02Icon} tone="warning">
          <ServerIssues error={save.error} />
        </NoteRow>
      )}
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
      <FooterRow className="sticky bottom-0 z-10 justify-end rounded-b-[35px] bg-(--glass-strong) supports-backdrop-filter:backdrop-blur-[24px]">
        <div className="mr-auto min-w-0 text-sm">
          {save.isError ? (
            <>
              <p className="text-warning">{t.settings.saveFailed}</p>
              <ServerIssues error={save.error} />
            </>
          ) : (
            save.isSuccess && <p role="status">{t.settings.saved}</p>
          )}
        </div>
        <PanelButton onClick={submit} pending={save.isPending}>
          {t.settings.save}
        </PanelButton>
      </FooterRow>
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-10">
      <Panel className="overflow-visible">
        <header className="p-6">
          <h1 className="text-2xl font-semibold tracking-tight">{t.settings.title}</h1>
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
          <>
            <Extractors />
            <Form view={settings.data} />
          </>
        ) : (
          <div className="flex justify-center border-t border-t-(--glass-edge) py-10">
            <Loading className="size-8" />
          </div>
        )}
      </Panel>
    </div>
  );
}
