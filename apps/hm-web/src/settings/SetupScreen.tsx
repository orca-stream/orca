import { useState } from "react";
import { ArrowRight01Icon, ConnectIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useLocation } from "wouter";
import { ApiError } from "@/api/client";
import type { JellyfinConnection, Settings } from "@/api/types";
import logotype from "@/assets/logotype.svg";
import { useLogin } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/locale";
import { Backdrop } from "@/shell/Shell";
import { useFinishSetup, useSetupDone } from "./api";
import {
  adminFromDraft,
  emptyAdmin,
  extractorNames,
  settingsFromDraft,
  suggestedDraft,
  type AdminDraft,
  type AdminErrors,
  type Draft,
  type DraftErrors,
  type DraftField,
} from "./draft";
import {
  AccessSection,
  LanguageSection,
  BrowserSection,
  DownloadsSection,
  ExtractorsSection,
  ExtrasSection,
  JellyfinSection,
  LibrarySection,
  ServerIssues,
  TracksSection,
} from "./sections";
import { FooterRow, Panel, PanelButton, PRIMARY_BUTTON } from "./rows";

type Step = "access" | "jellyfin" | "extras" | "downloads";

/** The sign-in's form, submitted by the step's one button. */
const JELLYFIN_FORM = "setup-jellyfin";

/** Which step each field is asked in, to go back to the first one that is wrong. */
const STEP_OF: Partial<Record<DraftField, Step>> = {
  signIn: "access",
  jellyfinUrl: "jellyfin",
  jellyfinMediaRoot: "jellyfin",
  mediaRoot: "jellyfin",
  tmdbApiKey: "extras",
};

/**
 * The first run: the server has no settings yet, so every screen is this one. A few steps (who signs
 * in, Jellyfin and its folder, the extras, the downloads) and the person is signed in: as the
 * administrator made here, or with the Jellyfin account that set Jellyfin up.
 */
export function SetupScreen() {
  const t = useT();
  const [, navigate] = useLocation();
  const finish = useFinishSetup();
  const setupDone = useSetupDone();
  const login = useLogin();
  const steps: Step[] = ["access", "jellyfin", "extras", "downloads"];
  const [step, setStep] = useState<Step>(steps[0]!);
  const [draft, setDraft] = useState<Draft>(suggestedDraft);
  const [extractors, setExtractors] = useState("");
  const [libraries, setLibraries] = useState<JellyfinConnection["libraries"] | null>(null);
  const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(
    null,
  );
  const [errors, setErrors] = useState<DraftErrors>({});
  const [admin, setAdmin] = useState<AdminDraft>(() => emptyAdmin());
  const [adminErrors, setAdminErrors] = useState<AdminErrors>({});
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const neededBySites = (extractorNames(extractors)?.length ?? 0) > 0;
  const index = steps.indexOf(step);

  function checkDraft(next: Draft): DraftErrors {
    const result = settingsFromDraft({ ...next, browserOn: next.browserOn || neededBySites });
    return result.ok ? {} : result.errors;
  }

  /** The administrator to make, when the server keeps its own; null when it is wrong (and says so). */
  function checkAdmin(): { username: string; password: string } | null {
    const result = adminFromDraft(admin);
    setAdminErrors(result.ok ? {} : result.errors);
    return result.ok ? result.admin : null;
  }

  function goNext() {
    if (step === "access" && draft.signIn === "local" && !checkAdmin()) return;
    const found = checkDraft(draft);
    const here = Object.keys(found).filter(
      (field) => (STEP_OF[field as DraftField] ?? "downloads") === step,
    );
    setErrors(found);
    if (here.length > 0) return;
    setStep(steps[index + 1]!);
  }

  function submit() {
    const local = draft.signIn === "local" ? checkAdmin() : null;
    if (draft.signIn === "local" && !local) return setStep("access");
    const result = settingsFromDraft({ ...draft, browserOn: draft.browserOn || neededBySites });
    if (!result.ok) {
      setErrors(result.errors);
      const first = Object.keys(result.errors)[0] as DraftField;
      setStep(STEP_OF[first] ?? "downloads");
      return;
    }
    const { tmdbApiKey, jellyfin, ...rest } = result.update;
    const settings: Settings = {
      ...rest,
      ...(jellyfin ? { jellyfin: { ...jellyfin, apiKey: draft.apiKey } } : {}),
      ...(tmdbApiKey ? { tmdbApiKey } : {}),
    };
    finish.mutate(
      {
        settings,
        ...(extractors.trim() ? { extractors } : {}),
        ...(local ? { admin: local } : {}),
      },
      {
        onSuccess: () => {
          const leave = (path: string) => {
            setupDone(settings);
            navigate(path, { replace: true });
          };
          // Signed in as whoever signs in from now on, before the panel asks who that is.
          const signIn = local ?? credentials;
          if (!signIn) return leave("/login");
          login.mutate(signIn, {
            onSuccess: () => leave("/"),
            onError: () => leave("/login"),
          });
        },
      },
    );
  }

  // Signing in with Jellyfin needs one; otherwise it can be left out.
  const jellyfinOn = draft.jellyfinOn || draft.signIn === "jellyfin";
  const canLeaveJellyfin = !jellyfinOn || draft.apiKey !== "";
  // The step's one button connects while the sign-in is open, and goes on once it is not.
  const [jellyfinForm, setJellyfinForm] = useState({ editing: true, ready: false, pending: false });
  const connecting = step === "jellyfin" && jellyfinOn && jellyfinForm.editing;

  return (
    <main className="isolate mx-auto flex min-h-app w-full max-w-3xl flex-col justify-center px-4 py-10 sm:py-16">
      <Backdrop />
      <Panel>
        <header className="flex flex-wrap items-center justify-between gap-4 px-4 py-6">
          {/* "Set up" and the logotype as one title, read as "Set up ORCA'H&M". */}
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {t.setup.title}
            <img src={logotype} alt={t.brand} className="h-7 w-auto" />
          </h1>
          <p
            className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary tabular-nums"
            aria-live="polite"
          >
            {t.setup.step(index + 1, steps.length)}
          </p>
        </header>

        {step === "access" && <LanguageSection />}
        {step === "access" && (
          <AccessSection
            draft={draft}
            set={set}
            errors={errors}
            setup={{ admin, onAdmin: setAdmin, errors: adminErrors }}
          />
        )}
        {step === "jellyfin" && (
          <>
            <JellyfinSection
              draft={draft}
              set={set}
              during="setup"
              formId={JELLYFIN_FORM}
              onFormState={setJellyfinForm}
              onConnected={(connection, signIn) => {
                setLibraries(connection.libraries);
                setCredentials(signIn);
                // The folder shows up under it, so it is seen before going on.
              }}
            />
            {canLeaveJellyfin && (
              <LibrarySection
                draft={draft}
                set={set}
                errors={errors}
                libraries={libraries}
                during="setup"
              />
            )}
          </>
        )}
        {step === "extras" && (
          <>
            <ExtrasSection draft={draft} set={set} errors={errors} />
            <ExtractorsSection text={extractors} onText={setExtractors} />
          </>
        )}
        {step === "downloads" && (
          <>
            <DownloadsSection draft={draft} set={set} errors={errors} />
            <TracksSection draft={draft} set={set} errors={errors} />
            <BrowserSection draft={draft} set={set} errors={errors} neededBySites={neededBySites} />
          </>
        )}

        {(finish.isError || login.isError) && (
          <div className="flex flex-col gap-1 border-t border-t-(--glass-edge) p-4">
            <p role="alert" className="text-sm text-warning">
              {t.setup.failed}
            </p>
            <ServerIssues error={finish.error instanceof ApiError ? finish.error : null} />
          </div>
        )}
        {/* Back's text, not its round, starts 16px in, as everything else does. */}
        <FooterRow className="justify-between pl-0">
          {index > 0 ? (
            <Button
              variant="ghost"
              className={`${PRIMARY_BUTTON} px-4`}
              onClick={() => setStep(steps[index - 1]!)}
            >
              {t.setup.back}
            </Button>
          ) : (
            <span />
          )}
          {step === "downloads" ? (
            <PanelButton onClick={submit} pending={finish.isPending || login.isPending}>
              {t.setup.finish}
              <HugeiconsIcon icon={Tick02Icon} className="size-5" />
            </PanelButton>
          ) : connecting ? (
            <PanelButton
              type="submit"
              form={JELLYFIN_FORM}
              disabled={!jellyfinForm.ready}
              pending={jellyfinForm.pending}
            >
              <HugeiconsIcon icon={ConnectIcon} className="size-5" />
              {t.settings.jellyfin.connect}
            </PanelButton>
          ) : (
            <PanelButton onClick={goNext} disabled={step === "jellyfin" && !canLeaveJellyfin}>
              {t.setup.next}
              <HugeiconsIcon icon={ArrowRight01Icon} className="size-5" />
            </PanelButton>
          )}
        </FooterRow>
      </Panel>
    </main>
  );
}
