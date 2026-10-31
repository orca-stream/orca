import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  Alert02Icon,
  BrowserIcon,
  CheckmarkCircle02Icon,
  CodeIcon,
  ConnectIcon,
  CpuIcon,
  DashboardSpeed01Icon,
  Delete02Icon,
  Download04Icon,
  FileAttachmentIcon,
  Film01Icon,
  Folder01Icon,
  FolderLibraryIcon,
  HourglassIcon,
  Key01Icon,
  Layers01Icon,
  Link01Icon,
  LockPasswordIcon,
  PlayListIcon,
  RepeatIcon,
  Search01Icon,
  Shield01Icon,
  SubtitleIcon,
  Timer02Icon,
  UserIcon,
  Video01Icon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons";
import { ApiError } from "@/api/client";
import type { JellyfinConnection } from "@/api/types";
import { PendingButton } from "@/components/pending-button";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/locale";
import type { Messages } from "@/i18n/messages";
import { BarField } from "@/series/bar";
import { useConnectJellyfin } from "./api";
import { extractorNames, type Draft, type DraftErrors, type DraftField } from "./draft";
import { AdvancedRows, FieldRow, Group, NoteRow, ROWS, SelectRow, ToggleRow } from "./rows";

export interface SectionProps {
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
  errors: DraftErrors;
}

/** A typed setting of the draft, with the field's problem said by its icon. */
function DraftRow({
  field,
  draft,
  set,
  errors,
  ...rest
}: SectionProps & {
  field: DraftField;
  icon: IconSvgElement;
  label: string;
  type?: string;
  inputMode?: "numeric" | "decimal" | "email" | "url";
  placeholder?: string;
  autoComplete?: string;
}) {
  const t = useT();
  const problem = errors[field];
  return (
    <FieldRow
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
  formId,
  onFormState,
  onConnected,
}: Omit<SectionProps, "errors"> & {
  during: "setup" | "settings";
  code?: string;
  /**
   * When the panel's own button connects (the setup's one button), the form's id for it, and how the
   * form stands so the button can say so. Without it, the section has its own Connect button.
   */
  formId?: string;
  onFormState?: (state: { editing: boolean; ready: boolean; pending: boolean }) => void;
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
  const ready = url.trim() !== "" && username !== "";
  useEffect(() => {
    onFormState?.({ editing, ready, pending: connect.isPending });
  }, [onFormState, editing, ready, connect.isPending]);

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
    <Group title={t.settings.jellyfin.title} description={t.settings.jellyfin.description}>
      {!editing ? (
        <NoteRow
          icon={CheckmarkCircle02Icon}
          action={
            <Button variant="outline" className="rounded-full" onClick={() => setEditing(true)}>
              {t.settings.jellyfin.change}
            </Button>
          }
        >
          <p role="status">
            {connectedTo
              ? t.settings.jellyfin.connected(connectedTo)
              : t.settings.jellyfin.current(draft.jellyfinUrl)}
          </p>
        </NoteRow>
      ) : (
        <form id={formId} onSubmit={submit} className={ROWS}>
          <FieldRow
            icon={Link01Icon}
            label={t.settings.jellyfin.url}
            placeholder={t.settings.jellyfin.urlPlaceholder}
            inputMode="url"
            autoComplete="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          {/* The sign-in side by side, each named by its placeholder, as the new series bar does. */}
          <div className="grid sm:grid-cols-2">
            <BarField
              icon={UserIcon}
              label={t.settings.jellyfin.username}
              placeholder={t.settings.jellyfin.username}
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <BarField
              icon={LockPasswordIcon}
              label={t.settings.jellyfin.password}
              placeholder={t.settings.jellyfin.password}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="border-t border-t-(--glass-edge) sm:border-t-0 sm:border-l sm:border-l-(--glass-edge)"
            />
          </div>
          {/* An error, or the section's own button; the setup's button is the panel's. */}
          {(connect.isError || !formId) && (
            <NoteRow
              icon={connect.isError ? Alert02Icon : ConnectIcon}
              tone={connect.isError ? "warning" : undefined}
              action={
                !formId && (
                  <PendingButton
                    type="submit"
                    className="rounded-full"
                    disabled={!ready}
                    pending={connect.isPending}
                  >
                    {connect.isPending
                      ? t.settings.jellyfin.connecting
                      : t.settings.jellyfin.connect}
                  </PendingButton>
                )
              }
            >
              {connect.isError && <p role="alert">{connectError(connect.error, t)}</p>}
            </NoteRow>
          )}
        </form>
      )}
    </Group>
  );
}

/**
 * Where the episodes go: a folder of one of Jellyfin's show libraries. H&M writes to it as Jellyfin
 * reads it (the same machine); a different local path, kept from before, is left as it is.
 */
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
    <Group title={t.settings.library.title} description={t.settings.library.description}>
      {libraries !== null && locations.length === 0 && (
        <NoteRow icon={Alert02Icon} tone="warning">
          {t.settings.library.noLibraries}
        </NoteRow>
      )}
      {locations.length > 1 && (
        <SelectRow
          icon={FolderLibraryIcon}
          label={t.settings.library.pick}
          value={draft.jellyfinMediaRoot}
          onChange={(jellyfinMediaRoot) => set({ jellyfinMediaRoot })}
          options={locations.map(({ library, location }) => ({
            value: location,
            label: `${library} — ${location}`,
          }))}
        />
      )}
      <DraftRow
        field="jellyfinMediaRoot"
        icon={Folder01Icon}
        label={t.settings.library.jellyfinPath}
        placeholder={t.settings.library.jellyfinPathPlaceholder}
        draft={draft}
        set={set}
        errors={errors}
      />
    </Group>
  );
}

/** TMDB's key: kept on the server once saved, so the form only takes a new one. */
export function ExtrasSection({ draft, set, errors }: SectionProps) {
  const t = useT();
  return (
    <Group title={t.settings.tmdb.title} description={t.settings.tmdb.description}>
      <DraftRow
        field="tmdbApiKey"
        icon={Key01Icon}
        label={t.settings.tmdb.key}
        placeholder={draft.hasTmdbApiKey ? t.settings.tmdb.keySet : t.settings.tmdb.keyPlaceholder}
        type="password"
        autoComplete="off"
        draft={draft}
        set={set}
        errors={errors}
      />
      {draft.hasTmdbApiKey && (
        <ToggleRow
          icon={Delete02Icon}
          label={t.settings.tmdb.remove}
          checked={draft.removeTmdb}
          onChange={(removeTmdb) => set({ removeTmdb })}
        />
      )}
    </Group>
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

  const some = names !== null && names.length > 0;
  return (
    <Group title={t.settings.extractors.title} description={t.settings.extractors.description}>
      <NoteRow
        icon={FileAttachmentIcon}
        action={
          <>
            <input
              ref={input}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label={t.settings.extractors.upload}
              onChange={(event) => void upload(event)}
            />
            {some && (
              <>
                <Button variant="ghost" className="rounded-full" onClick={() => onText("")}>
                  {t.settings.extractors.clear}
                </Button>
                <Button variant="outline" className="rounded-full" onClick={download}>
                  {t.settings.extractors.download}
                </Button>
              </>
            )}
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => input.current?.click()}
            >
              {t.settings.extractors.upload}
            </Button>
            {action}
          </>
        }
      >
        <p role="status">
          {some ? t.settings.extractors.sites(names.join(", ")) : t.settings.extractors.none}
        </p>
      </NoteRow>
      {invalid && (
        <NoteRow icon={Alert02Icon} tone="warning">
          <p role="alert">{t.settings.extractors.invalid}</p>
        </NoteRow>
      )}
    </Group>
  );
}

/** How downloads run: the common choices first, the tuning folded away. */
export function DownloadsSection(props: SectionProps) {
  const t = useT();
  const { draft, set } = props;
  return (
    <Group title={t.settings.downloads.title}>
      <ToggleRow
        icon={PlayListIcon}
        label={t.settings.downloads.sequential}
        checked={draft.sequential}
        onChange={(sequential) => set({ sequential })}
      />
      <DraftRow
        {...props}
        field="connections"
        icon={ConnectIcon}
        label={t.settings.downloads.connections}
        inputMode="numeric"
      />
      <DraftRow
        {...props}
        field="skipPlayers"
        icon={Shield01Icon}
        label={t.settings.downloads.skipPlayers}
        placeholder={t.settings.downloads.skipPlaceholder}
      />
      <AdvancedRows label={t.settings.downloads.advanced}>
        <DraftRow
          {...props}
          field="concurrency"
          icon={Download04Icon}
          label={t.settings.downloads.concurrency}
          inputMode="numeric"
        />
        <DraftRow
          {...props}
          field="ffmpegConcurrency"
          icon={CpuIcon}
          label={t.settings.downloads.ffmpeg}
          inputMode="numeric"
        />
        <DraftRow
          {...props}
          field="browserConcurrency"
          icon={BrowserIcon}
          label={t.settings.downloads.browserJobs}
          inputMode="numeric"
        />
        <DraftRow
          {...props}
          field="downloadsPerHost"
          icon={Layers01Icon}
          label={t.settings.downloads.perHost}
          placeholder={t.settings.downloads.byExtractor}
          inputMode="numeric"
        />
        <DraftRow
          {...props}
          field="metadataPerSec"
          icon={DashboardSpeed01Icon}
          label={t.settings.downloads.metadataPerSec}
          placeholder={t.settings.downloads.byExtractor}
          inputMode="decimal"
        />
        <DraftRow
          {...props}
          field="probeTimeoutSec"
          icon={Search01Icon}
          label={t.settings.downloads.probeTimeout}
          inputMode="numeric"
        />
      </AdvancedRows>
    </Group>
  );
}

/** What tracks a series without its own choice keeps. */
export function TracksSection(props: SectionProps) {
  const t = useT();
  const { draft, set } = props;
  return (
    <Group title={t.settings.tracks.title}>
      <DraftRow
        {...props}
        field="maxHeight"
        icon={Video01Icon}
        label={t.settings.tracks.maxHeight}
        placeholder={t.settings.tracks.maxHeightPlaceholder}
        inputMode="numeric"
      />
      <DraftRow
        {...props}
        field="audioLangs"
        icon={VolumeHighIcon}
        label={t.settings.tracks.audio}
        placeholder={t.settings.tracks.audioPlaceholder}
      />
      <SelectRow
        icon={SubtitleIcon}
        label={t.settings.tracks.subtitles}
        value={draft.subtitleMode}
        onChange={(mode) => set({ subtitleMode: mode as Draft["subtitleMode"] })}
        options={(["all", "none", "some"] as const).map((mode) => ({
          value: mode,
          label: t.settings.tracks.subtitleModes[mode],
        }))}
      />
      {draft.subtitleMode === "some" && (
        <DraftRow
          {...props}
          field="subtitleLangs"
          icon={SubtitleIcon}
          label={t.settings.tracks.subtitleLangs}
          placeholder="spa, eng"
        />
      )}
      <ToggleRow
        icon={Film01Icon}
        label={t.settings.tracks.external}
        checked={draft.externalSubtitles}
        onChange={(externalSubtitles) => set({ externalSubtitles })}
      />
    </Group>
  );
}

/** The headless browser; switched on for good while the extractors describe sites. */
export function BrowserSection({
  neededBySites,
  ...props
}: SectionProps & { neededBySites: boolean }) {
  const t = useT();
  const { draft, set } = props;
  const on = draft.browserOn || neededBySites;
  return (
    <Group title={t.settings.browser.title} description={t.settings.browser.description}>
      <ToggleRow
        icon={BrowserIcon}
        label={t.settings.browser.on}
        {...(neededBySites ? { note: t.settings.browser.neededBySites } : {})}
        checked={on}
        disabled={neededBySites}
        onChange={(browserOn) => set({ browserOn })}
      />
      {on && (
        <>
          <ToggleRow
            icon={RepeatIcon}
            label={t.settings.browser.generic}
            checked={draft.genericDetector}
            onChange={(genericDetector) => set({ genericDetector })}
          />
          <AdvancedRows label={t.settings.downloads.advanced}>
            <DraftRow
              {...props}
              field="maxConcurrent"
              icon={Layers01Icon}
              label={t.settings.browser.maxConcurrent}
              inputMode="numeric"
            />
            <DraftRow
              {...props}
              field="timeoutSec"
              icon={Timer02Icon}
              label={t.settings.browser.timeout}
              inputMode="numeric"
            />
            <DraftRow
              {...props}
              field="settleSec"
              icon={HourglassIcon}
              label={t.settings.browser.settle}
              inputMode="decimal"
            />
            <DraftRow
              {...props}
              field="userAgent"
              icon={CodeIcon}
              label={t.settings.browser.userAgent}
              placeholder={t.settings.browser.userAgentPlaceholder}
            />
            <DraftRow
              {...props}
              field="chromiumPath"
              icon={Folder01Icon}
              label={t.settings.browser.chromium}
              placeholder={t.settings.browser.chromiumPlaceholder}
            />
            <ToggleRow
              icon={Shield01Icon}
              label={t.settings.browser.noSandbox}
              checked={draft.noSandbox}
              onChange={(noSandbox) => set({ noSandbox })}
            />
          </AdvancedRows>
        </>
      )}
    </Group>
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
