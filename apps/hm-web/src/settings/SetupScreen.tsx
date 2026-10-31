import { useState, type FormEvent } from "react";
import { Key01Icon } from "@hugeicons/core-free-icons";
import { useLocation } from "wouter";
import { ApiError } from "@/api/client";
import { useApi } from "@/api/context";
import type { JellyfinConnection, Settings } from "@/api/types";
import logotype from "@/assets/logotype.svg";
import { useLogin } from "@/auth/session";
import { PendingButton } from "@/components/pending-button";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import { Backdrop } from "@/shell/Shell";
import { useFinishSetup } from "./api";
import {
  extractorNames,
  settingsFromDraft,
  suggestedDraft,
  type Draft,
  type DraftErrors,
  type DraftField,
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
import { FieldRow, FooterRow, Group, Panel, PRIMARY_BUTTON } from "./rows";

type Step = "code" | "jellyfin" | "extras" | "downloads";

/** The sign-in's form, submitted by the step's one button. */
const JELLYFIN_FORM = "setup-jellyfin";

/** Which step each field is asked in, to go back to the first one that is wrong. */
const STEP_OF: Partial<Record<DraftField, Step>> = {
  jellyfinUrl: "jellyfin",
  jellyfinMediaRoot: "jellyfin",
  mediaRoot: "jellyfin",
  tmdbApiKey: "extras",
};

/** The code the server printed, asked for only when the panel is opened from another device. */
function CodeStep({ onValid }: { onValid: (code: string) => void }) {
  const t = useT();
  const api = useApi();
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "wrong">("idle");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("checking");
    try {
      await api.post("/setup/code", { code }, { expectUnauthorized: true });
      onValid(code);
    } catch {
      setState("wrong");
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <Group title={t.setup.code.title} description={t.setup.code.description}>
        <FieldRow
          icon={Key01Icon}
          label={t.setup.code.label}
          autoComplete="off"
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value)}
          error={state === "wrong" ? t.setup.code.wrong : undefined}
        />
      </Group>
      <FooterRow className="justify-end">
        <PendingButton
          type="submit"
          className={PRIMARY_BUTTON}
          disabled={code.trim() === ""}
          pending={state === "checking"}
        >
          {t.setup.next}
        </PendingButton>
      </FooterRow>
    </form>
  );
}

/**
 * The first run: the server has no settings yet, so every screen is this one. A few steps (the code
 * when away from the server's machine, Jellyfin and its folder, the extras, the downloads) and the
 * person is signed in with the administrator account that set Jellyfin up.
 */
export function SetupScreen({ needsCode }: { needsCode: boolean }) {
  const t = useT();
  const [, navigate] = useLocation();
  const finish = useFinishSetup();
  const login = useLogin();
  const steps: Step[] = [
    ...(needsCode ? (["code"] as const) : []),
    "jellyfin",
    "extras",
    "downloads",
  ];
  const [step, setStep] = useState<Step>(steps[0]!);
  const [code, setCode] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>(suggestedDraft);
  const [extractors, setExtractors] = useState("");
  const [libraries, setLibraries] = useState<JellyfinConnection["libraries"] | null>(null);
  const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(
    null,
  );
  const [errors, setErrors] = useState<DraftErrors>({});
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const neededBySites = (extractorNames(extractors)?.length ?? 0) > 0;
  const index = steps.indexOf(step);

  function checkDraft(next: Draft): DraftErrors {
    const result = settingsFromDraft({ ...next, browserOn: next.browserOn || neededBySites });
    return result.ok ? {} : result.errors;
  }

  function goNext() {
    const found = checkDraft(draft);
    const here = Object.keys(found).filter(
      (field) => (STEP_OF[field as DraftField] ?? "downloads") === step,
    );
    setErrors(found);
    if (here.length > 0) return;
    setStep(steps[index + 1]!);
  }

  function submit() {
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
      jellyfin: { ...jellyfin, apiKey: draft.apiKey },
      ...(tmdbApiKey ? { tmdbApiKey } : {}),
    };
    finish.mutate(
      {
        settings,
        ...(extractors.trim() ? { extractors } : {}),
        ...(code ? { code } : {}),
      },
      {
        onSuccess: () => {
          if (!credentials) return navigate("/login", { replace: true });
          login.mutate(credentials, {
            onSuccess: () => navigate("/", { replace: true }),
            onError: () => navigate("/login", { replace: true }),
          });
        },
      },
    );
  }

  const canLeaveJellyfin = draft.apiKey !== "";
  // The step's one button connects while the sign-in is open, and goes on once it is not.
  const [jellyfinForm, setJellyfinForm] = useState({ editing: true, ready: false, pending: false });
  const connecting = step === "jellyfin" && jellyfinForm.editing;

  return (
    <main className="isolate mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center px-4 py-10 sm:py-16">
      <Backdrop />
      <Panel>
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 pt-7 pb-6 sm:px-8 sm:pt-8">
          {/* "Set up" and the logotype as one title, read as "Set up ORCA'H&M". */}
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {t.setup.title}
            <img src={logotype} alt={t.brand} className="h-7 w-auto" />
          </h1>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <p
              className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary tabular-nums"
              aria-live="polite"
            >
              {t.setup.step(index + 1, steps.length)}
            </p>
            <div aria-hidden="true" className="flex gap-1.5">
              {steps.map((each, at) => (
                <span
                  key={each}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    at === index
                      ? "w-6 bg-primary"
                      : at < index
                        ? "w-1.5 bg-primary/60"
                        : "w-1.5 bg-primary/20",
                  )}
                />
              ))}
            </div>
          </div>
        </header>

        {step === "code" && (
          <CodeStep
            onValid={(valid) => {
              setCode(valid);
              setStep("jellyfin");
            }}
          />
        )}
        {step === "jellyfin" && (
          <>
            <JellyfinSection
              draft={draft}
              set={set}
              during="setup"
              {...(code ? { code } : {})}
              formId={JELLYFIN_FORM}
              onFormState={setJellyfinForm}
              onConnected={(connection, signIn) => {
                setLibraries(connection.libraries);
                setCredentials(signIn);
                // With a single folder there is nothing to pick: straight on. With several, or none,
                // the folder is shown to pick or type.
                const folders = connection.libraries.flatMap((library) => library.locations);
                if (folders.length === 1) setStep(steps[index + 1]!);
              }}
            />
            {canLeaveJellyfin && (
              <LibrarySection draft={draft} set={set} errors={errors} libraries={libraries} />
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
          <div className="flex flex-col gap-1 border-t border-t-(--glass-edge) px-6 py-4 sm:px-8">
            <p role="alert" className="text-sm text-warning">
              {t.setup.failed}
            </p>
            <ServerIssues error={finish.error instanceof ApiError ? finish.error : null} />
          </div>
        )}
        {step !== "code" && (
          <FooterRow className="justify-between pl-[7px]">
            {index > 0 && steps[index - 1] !== "code" ? (
              <Button
                variant="ghost"
                className={PRIMARY_BUTTON}
                onClick={() => setStep(steps[index - 1]!)}
              >
                {t.setup.back}
              </Button>
            ) : (
              <span />
            )}
            {step === "downloads" ? (
              <PendingButton
                className={PRIMARY_BUTTON}
                onClick={submit}
                pending={finish.isPending || login.isPending}
              >
                {finish.isSuccess
                  ? t.setup.done
                  : finish.isPending
                    ? t.setup.finishing
                    : t.setup.finish}
              </PendingButton>
            ) : connecting ? (
              <PendingButton
                type="submit"
                form={JELLYFIN_FORM}
                className={PRIMARY_BUTTON}
                disabled={!jellyfinForm.ready}
                pending={jellyfinForm.pending}
              >
                {jellyfinForm.pending
                  ? t.settings.jellyfin.connecting
                  : t.settings.jellyfin.connectAndGo}
              </PendingButton>
            ) : (
              <Button
                className={PRIMARY_BUTTON}
                onClick={goNext}
                disabled={step === "jellyfin" && !canLeaveJellyfin}
              >
                {t.setup.next}
              </Button>
            )}
          </FooterRow>
        )}
      </Panel>
    </main>
  );
}
