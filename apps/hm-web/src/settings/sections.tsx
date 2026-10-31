import { useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { ApiError } from "@/api/client";
import type { JellyfinConnection } from "@/api/types";
import { PendingButton } from "@/components/pending-button";
import { SwitchField } from "@/components/switch-field";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useT } from "@/i18n/locale";
import type { Messages } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { GLASS_PANEL } from "@/series/bar";
import { useConnectJellyfin } from "./api";
import { extractorNames, type Draft, type DraftErrors, type DraftField } from "./draft";

export interface SectionProps {
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
  errors: DraftErrors;
}

/** One glass panel of the form, with its title and what it is for. */
export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn(GLASS_PANEL, "flex flex-col gap-5 p-6 sm:p-8")}>
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </header>
      {children}
    </section>
  );
}

/** What is folded away unless asked for: the tuning hardly anyone needs. */
function Advanced({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <details className="group flex flex-col gap-4">
      <summary className="cursor-pointer text-sm font-medium text-muted-foreground select-none hover:text-foreground">
        {t.settings.downloads.advanced}
      </summary>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </details>
  );
}

/** A text field of the draft, with the field's problem said under it. */
function DraftText({
  field,
  label,
  draft,
  set,
  errors,
  ...rest
}: SectionProps & {
  field: DraftField;
  label: string;
  type?: string;
  inputMode?: "numeric" | "decimal" | "email" | "url";
  placeholder?: string;
  autoComplete?: string;
}) {
  const t = useT();
  const problem = errors[field];
  return (
    <TextField
      label={label}
      value={draft[field] as string}
      onChange={(event) => set({ [field]: event.target.value } as Partial<Draft>)}
      error={problem ? t.settings.errors[problem] : undefined}
      {...rest}
    />
  );
}

function connectError(error: unknown, t: Messages): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return t.settings.jellyfin.unauthorized;
    if (error.status === 403) return t.settings.jellyfin.forbidden;
    if (error.status === 502) return t.settings.jellyfin.upstream;
  }
  return t.settings.jellyfin.failed;
}

/**
 * The Jellyfin server: its address and an administrator's sign-in, which makes H&M its own key there
 * (nobody copies one by hand). Once connected, its show libraries are offered for the folder.
 */
export function JellyfinSection({
  draft,
  set,
  during,
  code,
  onConnected,
}: Omit<SectionProps, "errors"> & {
  during: "setup" | "settings";
  code?: string;
  /** With the sign-in that made the key, so the setup can sign the person in when it is done. */
  onConnected: (
    connection: JellyfinConnection,
    credentials: { username: string; password: string },
  ) => void;
}) {
  const t = useT();
  const connect = useConnectJellyfin(during);
  const [url, setUrl] = useState(draft.jellyfinUrl);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState(draft.jellyfinUrl === "");
  const [connectedTo, setConnectedTo] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    connect.mutate(
      { url: url.trim(), username, password, ...(code ? { code } : {}) },
      {
        onSuccess: (connection) => {
          const known = connection.libraries.flatMap((library) => library.locations);
          set({
            jellyfinUrl: connection.url,
            apiKey: connection.apiKey,
            ...(known.includes(draft.jellyfinMediaRoot) || known.length === 0
              ? {}
              : { jellyfinMediaRoot: known[0] }),
          });
          setConnectedTo(connection.serverName);
          setEditing(false);
          setPassword("");
          onConnected(connection, { username, password });
        },
      },
    );
  }

  return (
    <Section title={t.settings.jellyfin.title} description={t.settings.jellyfin.description}>
      {!editing ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-sm">
            {connectedTo
              ? t.settings.jellyfin.connected(connectedTo)
              : t.settings.jellyfin.current(draft.jellyfinUrl)}
          </p>
          <Button variant="outline" onClick={() => setEditing(true)}>
            {t.settings.jellyfin.change}
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <TextField
            label={t.settings.jellyfin.url}
            placeholder={t.settings.jellyfin.urlPlaceholder}
            inputMode="url"
            autoComplete="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t.settings.jellyfin.username}
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <TextField
              label={t.settings.jellyfin.password}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {connect.isError && (
            <p role="alert" className="text-sm text-warning">
              {connectError(connect.error, t)}
            </p>
          )}
          <PendingButton
            type="submit"
            className="self-start"
            disabled={url.trim() === "" || username === ""}
            pending={connect.isPending}
          >
            {connect.isPending ? t.settings.jellyfin.connecting : t.settings.jellyfin.connect}
          </PendingButton>
        </form>
      )}
    </Section>
  );
}

/** Where the episodes go: a folder of one of Jellyfin's show libraries, and how this machine reaches it. */
export function LibrarySection({
  draft,
  set,
  errors,
  libraries,
}: SectionProps & { libraries: JellyfinConnection["libraries"] | null }) {
  const t = useT();
  const locations = (libraries ?? []).flatMap((library) =>
    library.locations.map((location) => ({ library: library.name, location })),
  );
  return (
    <Section title={t.settings.library.title} description={t.settings.library.description}>
      {libraries !== null && locations.length === 0 && (
        <p className="text-sm text-warning">{t.settings.library.noLibraries}</p>
      )}
      {locations.length > 1 && (
        <Field>
          <FieldLabel htmlFor="library-pick">{t.settings.library.pick}</FieldLabel>
          <NativeSelect
            id="library-pick"
            className="w-full"
            value={draft.jellyfinMediaRoot}
            onChange={(event) => set({ jellyfinMediaRoot: event.target.value })}
          >
            {locations.map(({ library, location }) => (
              <NativeSelectOption key={location} value={location}>
                {`${library} — ${location}`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      )}
      <DraftText
        field="jellyfinMediaRoot"
        label={t.settings.library.jellyfinPath}
        draft={draft}
        set={set}
        errors={errors}
      />
      <SwitchField
        label={t.settings.library.sameMachine}
        checked={draft.sameMachine}
        onCheckedChange={(sameMachine) => set({ sameMachine })}
      />
      {!draft.sameMachine && (
        <DraftText
          field="mediaRoot"
          label={t.settings.library.localPath}
          draft={draft}
          set={set}
          errors={errors}
        />
      )}
    </Section>
  );
}

/** TMDB's key and who sites can write to. */
export function ExtrasSection({ draft, set, errors }: SectionProps) {
  const t = useT();
  return (
    <Section title={t.settings.tmdb.title} description={t.settings.tmdb.description}>
      <DraftText
        field="tmdbApiKey"
        label={t.settings.tmdb.key}
        type="password"
        autoComplete="off"
        draft={draft}
        set={set}
        errors={errors}
      />
      {draft.hasTmdbApiKey && (
        <>
          <p className="-mt-2 text-sm text-muted-foreground">{t.settings.tmdb.keySet}</p>
          <SwitchField
            label={t.settings.tmdb.remove}
            checked={draft.removeTmdb}
            onCheckedChange={(removeTmdb) => set({ removeTmdb })}
          />
        </>
      )}
      <DraftText
        field="contactEmail"
        label={t.settings.tmdb.contact}
        inputMode="email"
        autoComplete="email"
        draft={draft}
        set={set}
        errors={errors}
      />
    </Section>
  );
}

/**
 * The extractors file: uploaded from disk and downloaded back, so the sites travel as a file of the
 * person's own and never through the code.
 */
export function ExtractorsSection({
  text,
  onText,
  action,
}: {
  text: string;
  onText: (text: string) => void;
  /** The settings screen's own save button. */
  action?: ReactNode;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [invalid, setInvalid] = useState(false);
  const names = extractorNames(text);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const content = await file.text();
    if (extractorNames(content) === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onText(content);
  }

  function download() {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    link.download = "extractors.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <Section title={t.settings.extractors.title} description={t.settings.extractors.description}>
      <p role="status" className="text-sm">
        {names === null || names.length === 0
          ? t.settings.extractors.none
          : t.settings.extractors.sites(names.join(", "))}
      </p>
      {invalid && (
        <p role="alert" className="text-sm text-warning">
          {t.settings.extractors.invalid}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label={t.settings.extractors.upload}
        onChange={(event) => void upload(event)}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => input.current?.click()}>
          {t.settings.extractors.upload}
        </Button>
        {names !== null && names.length > 0 && (
          <>
            <Button variant="outline" onClick={download}>
              {t.settings.extractors.download}
            </Button>
            <Button variant="ghost" onClick={() => onText("")}>
              {t.settings.extractors.clear}
            </Button>
          </>
        )}
        {action}
      </div>
    </Section>
  );
}

/** How downloads run: the common choices first, the tuning folded away. */
export function DownloadsSection(props: SectionProps) {
  const t = useT();
  const { draft, set } = props;
  return (
    <Section title={t.settings.downloads.title}>
      <SwitchField
        label={t.settings.downloads.sequential}
        checked={draft.sequential}
        onCheckedChange={(sequential) => set({ sequential })}
      />
      <DraftText
        {...props}
        field="connections"
        label={t.settings.downloads.connections}
        inputMode="numeric"
      />
      <DraftText
        {...props}
        field="skipPlayers"
        label={t.settings.downloads.skipPlayers}
        placeholder={t.settings.downloads.skipPlaceholder}
      />
      <Advanced>
        <div className="grid gap-4 sm:grid-cols-3 sm:items-end">
          <DraftText
            {...props}
            field="concurrency"
            label={t.settings.downloads.concurrency}
            inputMode="numeric"
          />
          <DraftText
            {...props}
            field="ffmpegConcurrency"
            label={t.settings.downloads.ffmpeg}
            inputMode="numeric"
          />
          <DraftText
            {...props}
            field="browserConcurrency"
            label={t.settings.downloads.browserJobs}
            inputMode="numeric"
          />
        </div>
        <DraftText
          {...props}
          field="downloadsPerHost"
          label={t.settings.downloads.perHost}
          inputMode="numeric"
        />
        <DraftText
          {...props}
          field="metadataPerSec"
          label={t.settings.downloads.metadataPerSec}
          inputMode="decimal"
        />
        <DraftText
          {...props}
          field="probeTimeoutSec"
          label={t.settings.downloads.probeTimeout}
          inputMode="numeric"
        />
      </Advanced>
    </Section>
  );
}

/** What tracks a series without its own choice keeps. */
export function TracksSection(props: SectionProps) {
  const t = useT();
  const { draft, set } = props;
  return (
    <Section title={t.settings.tracks.title}>
      <DraftText
        {...props}
        field="maxHeight"
        label={t.settings.tracks.maxHeight}
        inputMode="numeric"
        placeholder="1080"
      />
      <DraftText
        {...props}
        field="audioLangs"
        label={t.settings.tracks.audio}
        placeholder="spa, eng"
      />
      <Field>
        <FieldLabel htmlFor="subtitle-mode">{t.settings.tracks.subtitles}</FieldLabel>
        <NativeSelect
          id="subtitle-mode"
          value={draft.subtitleMode}
          onChange={(event) => set({ subtitleMode: event.target.value as Draft["subtitleMode"] })}
        >
          {(["all", "none", "some"] as const).map((mode) => (
            <NativeSelectOption key={mode} value={mode}>
              {t.settings.tracks.subtitleModes[mode]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      {draft.subtitleMode === "some" && (
        <DraftText
          {...props}
          field="subtitleLangs"
          label={t.settings.tracks.subtitleLangs}
          placeholder="spa, eng"
        />
      )}
      <SwitchField
        label={t.settings.tracks.external}
        checked={draft.externalSubtitles}
        onCheckedChange={(externalSubtitles) => set({ externalSubtitles })}
      />
    </Section>
  );
}

/** The headless browser; switched on for good while the extractors describe sites. */
export function BrowserSection(props: SectionProps & { neededBySites: boolean }) {
  const t = useT();
  const { draft, set, neededBySites } = props;
  const on = draft.browserOn || neededBySites;
  return (
    <Section title={t.settings.browser.title} description={t.settings.browser.description}>
      <Field>
        <SwitchField
          label={t.settings.browser.on}
          checked={on}
          disabled={neededBySites}
          onCheckedChange={(browserOn) => set({ browserOn })}
        />
        {neededBySites && <FieldDescription>{t.settings.browser.neededBySites}</FieldDescription>}
      </Field>
      {on && (
        <>
          <SwitchField
            label={t.settings.browser.generic}
            checked={draft.genericDetector}
            onCheckedChange={(genericDetector) => set({ genericDetector })}
          />
          <Advanced>
            <div className="grid gap-4 sm:grid-cols-3 sm:items-end">
              <DraftText
                {...props}
                field="maxConcurrent"
                label={t.settings.browser.maxConcurrent}
                inputMode="numeric"
              />
              <DraftText
                {...props}
                field="timeoutSec"
                label={t.settings.browser.timeout}
                inputMode="numeric"
              />
              <DraftText
                {...props}
                field="settleSec"
                label={t.settings.browser.settle}
                inputMode="decimal"
              />
            </div>
            <DraftText {...props} field="userAgent" label={t.settings.browser.userAgent} />
            <DraftText {...props} field="chromiumPath" label={t.settings.browser.chromium} />
            <SwitchField
              label={t.settings.browser.noSandbox}
              checked={draft.noSandbox}
              onCheckedChange={(noSandbox) => set({ noSandbox })}
            />
          </Advanced>
        </>
      )}
    </Section>
  );
}

/** The server's own objections, by where they are, for what the form could not check itself. */
export function ServerIssues({ error }: { error: unknown }) {
  const t = useT();
  if (!(error instanceof ApiError)) return null;
  return (
    <div role="alert" className="text-sm text-warning">
      {error.issues && error.issues.length > 0 ? (
        <>
          <p>{t.settings.errors.server}</p>
          <ul className="mt-1 list-disc pl-5">
            {error.issues.map((issue) => (
              <li key={issue.path}>
                <code>{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>{error.message}</p>
      )}
    </div>
  );
}
