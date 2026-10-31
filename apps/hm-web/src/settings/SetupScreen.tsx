import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { ApiError } from "@/api/client";
import { useApi } from "@/api/context";
import type { JellyfinConnection, Settings } from "@/api/types";
import logotype from "@/assets/logotype.svg";
import { useLogin } from "@/auth/session";
import { PendingButton } from "@/components/pending-button";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/locale";
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
  Section,
  ServerIssues,
  TracksSection,
} from "./sections";

type Step = "code" | "jellyfin" | "extras" | "downloads";

/** Which step each field is asked in, to go back to the first one that is wrong. */
const STEP_OF: Partial<Record<DraftField, Step>> = {
  jellyfinUrl: "jellyfin",
  jellyfinMediaRoot: "jellyfin",
  mediaRoot: "jellyfin",
  tmdbApiKey: "extras",
  contactEmail: "extras",
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
    <Section title={t.setup.code.title} description={t.setup.code.description}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <TextField
          label={t.setup.code.label}
          autoComplete="off"
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value)}
          error={state === "wrong" ? t.setup.code.wrong : undefined}
        />
        <PendingButton
          type="submit"
          className="self-start"
          disabled={code.trim() === ""}
          pending={state === "checking"}
        >
          {t.setup.next}
        </PendingButton>
      </form>
    </Section>
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

  return (
    <main className="isolate mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:py-16">
      <Backdrop />
      <header className="flex flex-col gap-3">
        <img src={logotype} alt={t.brand} className="h-6 w-auto self-start" />
        <h1 className="text-2xl font-semibold tracking-tight">{t.setup.title}</h1>
        <p className="text-muted-foreground">{t.setup.intro}</p>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t.setup.step(index + 1, steps.length)}
        </p>
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
            onConnected={(connection, signIn) => {
              setLibraries(connection.libraries);
              setCredentials(signIn);
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
        <div className="flex flex-col gap-1">
          <p role="alert" className="text-sm text-warning">
            {t.setup.failed}
          </p>
          <ServerIssues error={finish.error instanceof ApiError ? finish.error : null} />
        </div>
      )}
      {step !== "code" && (
        <nav className="flex items-center justify-between gap-3">
          {index > 0 && steps[index - 1] !== "code" ? (
            <Button variant="ghost" onClick={() => setStep(steps[index - 1]!)}>
              {t.setup.back}
            </Button>
          ) : (
            <span />
          )}
          {step === "downloads" ? (
            <PendingButton onClick={submit} pending={finish.isPending || login.isPending}>
              {finish.isSuccess
                ? t.setup.done
                : finish.isPending
                  ? t.setup.finishing
                  : t.setup.finish}
            </PendingButton>
          ) : (
            <Button onClick={goNext} disabled={step === "jellyfin" && !canLeaveJellyfin}>
              {t.setup.next}
            </Button>
          )}
        </nav>
      )}
    </main>
  );
}
