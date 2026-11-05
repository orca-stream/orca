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
  Download04Icon,
  FileAttachmentIcon,
  Film01Icon,
  Folder01Icon,
  FolderLibraryIcon,
  HourglassIcon,
  Key01Icon,
  Link01Icon,
  LockPasswordIcon,
  Shield01Icon,
  SubtitleIcon,
  Timer02Icon,
  UserIcon,
  Video01Icon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons";
import { LANGUAGE_CODE_PATTERN, SETTING_LIMITS } from "@orca/hm-contract/rules";
import { ApiError } from "@/api/client";
import type { JellyfinConnection } from "@/api/types";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/locale";
import type { Messages } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { BarField } from "@/series/bar";
import { COMMON_HEIGHTS, COMMON_LANGUAGES } from "@/series/settings-form";
import { useConnectJellyfin, useSaveLocalAdmin } from "./api";
import type { ExtractorsFileProblem } from "@orca/hm-contract/extractors-file";
import {
  adminFromDraft,
  emptyAdmin,
  extractorNames,
  type AdminDraft,
  type AdminErrors,
  type Draft,
  type DraftErrors,
  type DraftField,
} from "./draft";
import {
  AdvancedRows,
  ChipsRow,
  ConfirmTrash,
  FieldRow,
  Group,
  NoteRow,
  NumberRow,
  PanelButton,
  PRIMARY_BUTTON,
  ROWS,
  SelectRow,
  ToggleRow,
} from "./rows";

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
  hint?: string;
  action?: ReactNode;
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

/** A number of the draft, stepped within the schema's limits. */
function DraftNumber({
  field,
  draft,
  set,
  errors,
  ...rest
}: SectionProps & {
  field: DraftField;
  icon: IconSvgElement;
  label: string;
  min: number;
  max?: number;
  step?: number;
  placeholder?: string;
  hint?: string;
}) {
  const t = useT();
  const problem = errors[field];
  return (
    <NumberRow
      value={draft[field] as string}
      onChange={(value) => set({ [field]: value } as Partial<Draft>)}
      error={problem ? t.settings.errors[problem] : undefined}
      decrease={t.settings.fields.less}
      increase={t.settings.fields.more}
      {...rest}
    />
  );
}

/** The values of a comma-separated field of the draft. */
const valuesOf = (text: string) =>
  text
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== "");

/** A host as typed, or taken from a whole address pasted in. */
function hostOf(text: string): string | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "") return null;
  let host = trimmed;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(trimmed)) host = new URL(trimmed).hostname;
  } catch {
    return null;
  }
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

const languageOf = (text: string): string | null => {
  const code = text.trim().toLowerCase();
  return LANGUAGE_CODE_PATTERN.test(code) ? code : null;
};

/**
 * A track's languages: a list says "all" (or "none") or "only these", and only these opens the chips
 * right under it, in the same row, the usual languages offered as they are typed.
 */
function LanguagesRow<Mode extends string>({
  field,
  draft,
  set,
  errors,
  icon,
  label,
  hint,
  mode,
  modes,
  onMode,
}: SectionProps & {
  field: "audioLangs" | "subtitleLangs";
  icon: IconSvgElement;
  label: string;
  hint: string;
  mode: Mode;
  /** Each choice and its name; "some" is the one that opens the chips. */
  modes: { value: Mode; label: string }[];
  onMode: (mode: Mode) => void;
}) {
  const t = useT();
  const problem = errors[field];
  const select = (
    <SelectRow
      icon={icon}
      label={label}
      hint={hint}
      error={problem ? t.settings.errors[problem] : undefined}
      value={mode}
      onChange={(next) => onMode(next as Mode)}
      options={modes}
    />
  );
  if (mode !== "some") return select;
  return (
    <ChipsRow
      head={select}
      inputLabel={`${label}: ${modes.find((each) => each.value === mode)?.label ?? ""}`}
      icon={icon}
      label={label}
      values={valuesOf(draft[field])}
      onChange={(values) =>
        set({ [field]: values.slice(0, SETTING_LIMITS.languages).join(", ") } as Partial<Draft>)
      }
      normalize={languageOf}
      suggestions={COMMON_LANGUAGES}
      labelOf={(code) => t.series.detail.languages[code] ?? code}
      placeholder={t.settings.fields.languagesPlaceholder}
      add={t.settings.fields.add}
      remove={t.settings.fields.remove}
    />
  );
}

/** The bar's inputs drop to a smaller size on wide screens; the sign-in keeps the rows' text size. */
const SAME_TEXT = "md:[&_input]:text-base";

function connectError(error: unknown, t: Messages): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return t.settings.jellyfin.unauthorized;
    if (error.status === 403) return t.settings.jellyfin.forbidden;
    if (error.status === 502) return t.settings.jellyfin.upstream;
  }
  return t.settings.jellyfin.failed;
}

/** The server's own administrator: a name and a password typed twice. */
export function AdminRows({
  admin,
  onAdmin,
  errors,
  newPassword = false,
}: {
  admin: AdminDraft;
  onAdmin: (admin: AdminDraft) => void;
  errors: AdminErrors;
  /** Changing the password of one there is already: the name is kept unless typed over. */
  newPassword?: boolean;
}) {
  const t = useT();
  const error = (field: keyof AdminDraft) => {
    const problem = errors[field];
    return problem ? t.settings.errors[problem] : undefined;
  };
  return (
    <>
      <FieldRow
        icon={UserIcon}
        label={t.settings.access.username}
        autoComplete="username"
        value={admin.username}
        onChange={(event) => onAdmin({ ...admin, username: event.target.value })}
        error={error("username")}
      />
      <FieldRow
        icon={LockPasswordIcon}
        label={newPassword ? t.settings.access.newPassword : t.settings.access.password}
        type="password"
        autoComplete="new-password"
        value={admin.password}
        onChange={(event) => onAdmin({ ...admin, password: event.target.value })}
        error={error("password")}
      />
      <FieldRow
        icon={LockPasswordIcon}
        label={t.settings.access.confirm}
        type="password"
        autoComplete="new-password"
        value={admin.confirm}
        onChange={(event) => onAdmin({ ...admin, confirm: event.target.value })}
        error={error("confirm")}
      />
    </>
  );
}

/**
 * In the settings: the administrator there is, and the way to change its password, or the form that
 * creates it. Saved on its own, at once: a password is never left in the settings' draft.
 */
function LocalAdminRows({ current }: { current: { username: string } | null }) {
  const t = useT();
  const save = useSaveLocalAdmin();
  const [editing, setEditing] = useState(current === null);
  const [admin, setAdmin] = useState<AdminDraft>(() => emptyAdmin(current?.username));
  const [errors, setErrors] = useState<AdminErrors>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = adminFromDraft(admin);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    save.mutate(result.admin, {
      onSuccess: () => {
        setAdmin(emptyAdmin(result.admin.username));
        setEditing(false);
      },
    });
  }

  if (!editing && current) {
    return (
      <NoteRow
        icon={CheckmarkCircle02Icon}
        action={
          <Button variant="outline" className={PRIMARY_BUTTON} onClick={() => setEditing(true)}>
            {t.settings.access.change}
          </Button>
        }
      >
        <p role="status">
          {save.isSuccess ? t.settings.access.saved : t.settings.access.current(current.username)}
        </p>
      </NoteRow>
    );
  }
  return (
    <form onSubmit={submit} className={ROWS}>
      <AdminRows admin={admin} onAdmin={setAdmin} errors={errors} newPassword={current !== null} />
      <NoteRow
        icon={save.isError ? Alert02Icon : Shield01Icon}
        tone={save.isError ? "warning" : undefined}
        action={
          <>
            {current && (
              <Button
                variant="outline"
                className={PRIMARY_BUTTON}
                disabled={save.isPending}
                onClick={() => {
                  setAdmin(emptyAdmin(current.username));
                  setErrors({});
                  save.reset();
                  setEditing(false);
                }}
              >
                {t.common.cancel}
              </Button>
            )}
            <PanelButton type="submit" pending={save.isPending}>
              {current ? t.settings.access.save : t.settings.access.create}
            </PanelButton>
          </>
        }
      >
        {save.isError && (
          <>
            <p role="alert">{t.settings.access.saveFailed}</p>
            <ServerIssues error={save.error} />
          </>
        )}
      </NoteRow>
    </form>
  );
}

/**
 * Who signs in to the panel: Jellyfin's administrators, or the one this server keeps. The setup holds
 * that administrator until it is done (`admin`); the settings save it on their own (`localAdmin`).
 */
export function AccessSection({
  draft,
  set,
  errors,
  setup,
  saved,
}: SectionProps & {
  setup?: { admin: AdminDraft; onAdmin: (admin: AdminDraft) => void; errors: AdminErrors };
  saved?: { signIn: Draft["signIn"]; localAdmin: { username: string } | null };
}) {
  const t = useT();
  const problem = errors.signIn;
  return (
    <Group title={t.settings.access.title} description={t.settings.access.description}>
      <SelectRow
        icon={Shield01Icon}
        label={t.settings.access.mode}
        value={draft.signIn}
        onChange={(signIn) => set({ signIn: signIn as Draft["signIn"] })}
        options={[
          { value: "jellyfin", label: t.settings.access.jellyfin },
          { value: "local", label: t.settings.access.local },
        ]}
        error={problem ? t.settings.errors[problem] : undefined}
      />
      {saved && saved.signIn !== draft.signIn && (
        <NoteRow icon={Alert02Icon} tone="warning">
          {t.settings.access.switchNote}
        </NoteRow>
      )}
      {draft.signIn === "local" &&
        (setup ? (
          <AdminRows admin={setup.admin} onAdmin={setup.onAdmin} errors={setup.errors} />
        ) : saved ? (
          <LocalAdminRows current={saved.localAdmin} />
        ) : null)}
    </Group>
  );
}

/**
 * The Jellyfin server: its address and an administrator's sign-in, which makes H&M its own key there
 * (nobody copies one by hand). Once connected, its show libraries are offered for the folder.
 */
export function JellyfinSection({
  draft,
  set,
  during,
  formId,
  onFormState,
  onConnected,
}: Omit<SectionProps, "errors"> & {
  during: "setup" | "settings";
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
  // Changing a server that works can be called off; the first one cannot.
  const cancellable = draft.jellyfinUrl !== "";

  function cancel() {
    setUrl(draft.jellyfinUrl);
    setUsername("");
    setPassword("");
    connect.reset();
    setEditing(false);
  }
  const [connectedTo, setConnectedTo] = useState<string | null>(null);
  const ready = url.trim() !== "" && username !== "";
  useEffect(() => {
    onFormState?.({ editing, ready, pending: connect.isPending });
  }, [onFormState, editing, ready, connect.isPending]);

  function submit(event: FormEvent) {
    event.preventDefault();
    connect.mutate(
      { url: url.trim(), username, password },
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

  // Signing in with Jellyfin needs one: the switch stays on, and says why.
  const required = draft.signIn === "jellyfin";
  const on = draft.jellyfinOn || required;
  return (
    <Group title={t.settings.jellyfin.title} description={t.settings.jellyfin.description}>
      <ToggleRow
        icon={Film01Icon}
        label={t.settings.jellyfin.use}
        checked={on}
        disabled={required}
        onChange={(jellyfinOn) => set({ jellyfinOn })}
        {...(required ? { note: t.settings.jellyfin.neededToSignIn } : {})}
      />
      {!on ? null : !editing ? (
        <NoteRow
          icon={CheckmarkCircle02Icon}
          action={
            <Button variant="outline" className={PRIMARY_BUTTON} onClick={() => setEditing(true)}>
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
          {/* Like the new series bar's address: the whole row, named by its icon and example. */}
          <BarField
            icon={Link01Icon}
            className={SAME_TEXT}
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
              className={SAME_TEXT}
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
              className={cn(
                SAME_TEXT,
                "border-t border-t-(--glass-edge) sm:border-t-0 sm:border-l sm:border-l-(--glass-edge)",
              )}
            />
          </div>
          {/* An error, or the section's own button; the setup's button is the panel's. */}
          {(connect.isError || !formId) && (
            <NoteRow
              icon={connect.isError ? Alert02Icon : ConnectIcon}
              tone={connect.isError ? "warning" : undefined}
              action={
                !formId && (
                  <>
                    {cancellable && (
                      <Button
                        variant="outline"
                        className={PRIMARY_BUTTON}
                        disabled={connect.isPending}
                        onClick={cancel}
                      >
                        {t.common.cancel}
                      </Button>
                    )}
                    <PanelButton type="submit" disabled={!ready} pending={connect.isPending}>
                      {t.settings.jellyfin.connect}
                    </PanelButton>
                  </>
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
  if (!(draft.jellyfinOn || draft.signIn === "jellyfin")) {
    // No Jellyfin: the folder is only this server's, typed as it sees it.
    return (
      <Group title={t.settings.library.title} description={t.settings.library.descriptionAlone}>
        <DraftRow
          field="mediaRoot"
          icon={Folder01Icon}
          label={t.settings.library.jellyfinPath}
          placeholder={t.settings.library.pathPlaceholder}
          hint={t.settings.hints.mediaRoot}
          draft={draft}
          set={set}
          errors={errors}
        />
      </Group>
    );
  }
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
          hint={t.settings.hints.library}
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
        hint={t.settings.hints.jellyfinPath}
        draft={draft}
        set={set}
        errors={errors}
      />
    </Group>
  );
}

/**
 * TMDB's key: kept on the server once saved, so the form only takes a new one. The saved one is
 * removed from the row's trash (in the settings), at once, once asked twice.
 */
export function ExtrasSection({
  draft,
  set,
  errors,
  onRemoveKey,
  removing = false,
}: SectionProps & { onRemoveKey?: () => void; removing?: boolean }) {
  const t = useT();
  return (
    <Group title={t.settings.tmdb.title} description={t.settings.tmdb.description}>
      <DraftRow
        field="tmdbApiKey"
        icon={Key01Icon}
        label={t.settings.tmdb.key}
        hint={t.settings.hints.tmdbKey}
        placeholder={draft.hasTmdbApiKey ? t.settings.tmdb.keySet : t.settings.tmdb.keyPlaceholder}
        type="password"
        autoComplete="off"
        draft={draft}
        set={set}
        errors={errors}
        action={
          draft.hasTmdbApiKey &&
          onRemoveKey && (
            <ConfirmTrash
              label={t.settings.tmdb.remove}
              confirm={t.settings.tmdb.removeConfirm}
              cancel={t.common.cancel}
              pending={removing}
              onConfirm={onRemoveKey}
            />
          )
        }
      />
    </Group>
  );
}

/**
 * The extractors file: picked from disk and checked against the server's own schema before it is
 * taken, so a wrong file says why at once.
 */
export function ExtractorsSection({
  text,
  onText,
}: {
  text: string;
  onText: (text: string) => void;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<ExtractorsFileProblem | null>(null);
  const names = extractorNames(text);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const content = await file.text();
    // The schema brings Zod along, so it is only fetched when a file is picked.
    const { checkExtractorsFile } = await import("@orca/hm-contract/extractors-file");
    const checked = checkExtractorsFile(content);
    if (!checked.ok) {
      setProblem(checked.problem);
      return;
    }
    setProblem(null);
    onText(content);
  }

  const some = names !== null && names.length > 0;
  return (
    <Group title={t.settings.extractors.title}>
      <NoteRow
        icon={FileAttachmentIcon}
        hint={t.settings.hints.extractors}
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
            <Button
              variant="outline"
              className={PRIMARY_BUTTON}
              onClick={() => input.current?.click()}
            >
              {some ? t.settings.extractors.another : t.settings.extractors.upload}
            </Button>
          </>
        }
      >
        <p role="status">
          {some ? t.settings.extractors.sites(names.join(", ")) : t.settings.extractors.title}
        </p>
      </NoteRow>
      {problem && (
        <NoteRow icon={Alert02Icon} tone="warning">
          <div role="alert">
            {problem.kind === "json" ? (
              <p>{t.settings.extractors.notJson}</p>
            ) : (
              <>
                <p>{t.settings.extractors.invalid}</p>
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {problem.issues.slice(0, MAX_ISSUES_SHOWN).map((issue) => (
                    <li key={`${issue.path}:${issue.message}`}>
                      <code>{issue.path}</code>: {issue.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </NoteRow>
      )}
    </Group>
  );
}

/** A wrong file can have many problems; the first few say enough. */
const MAX_ISSUES_SHOWN = 6;

/**
 * How downloads run, in three choices. One episode at a time is the careful way (its players in
 * order); more run side by side, each on the least busy server. The rest is the server's to tune.
 */
export function DownloadsSection(props: SectionProps) {
  const t = useT();
  const { draft, set, errors } = props;
  return (
    <Group title={t.settings.downloads.title}>
      <DraftNumber
        {...props}
        field="concurrency"
        icon={Download04Icon}
        label={t.settings.downloads.concurrency}
        hint={t.settings.hints.concurrency}
        min={1}
        max={SETTING_LIMITS.jobs}
      />
      <DraftNumber
        {...props}
        field="connections"
        icon={ConnectIcon}
        label={t.settings.downloads.connections}
        hint={t.settings.hints.connections}
        min={1}
        max={SETTING_LIMITS.connections}
      />
      <ChipsRow
        icon={Shield01Icon}
        label={t.settings.downloads.skipPlayers}
        hint={t.settings.hints.skipPlayers}
        values={valuesOf(draft.skipPlayers)}
        onChange={(hosts) =>
          set({ skipPlayers: hosts.slice(0, SETTING_LIMITS.skipPlayers).join(", ") })
        }
        normalize={hostOf}
        placeholder={t.settings.downloads.skipPlaceholder}
        error={errors.skipPlayers ? t.settings.errors[errors.skipPlayers] : undefined}
        add={t.settings.fields.add}
        remove={t.settings.fields.remove}
      />
    </Group>
  );
}

/** What tracks a series without its own choice keeps. */
export function TracksSection(props: SectionProps) {
  const t = useT();
  const { draft, set } = props;
  return (
    <Group title={t.settings.tracks.title}>
      <SelectRow
        icon={Video01Icon}
        label={t.settings.tracks.maxHeight}
        hint={t.settings.hints.maxHeight}
        value={draft.maxHeight}
        onChange={(maxHeight) => set({ maxHeight })}
        options={[
          { value: "", label: t.settings.tracks.maxHeightPlaceholder },
          ...heightsWith(draft.maxHeight).map((height) => ({
            value: String(height),
            label: t.series.detail.heightOption(height),
          })),
        ]}
      />
      <LanguagesRow
        {...props}
        field="audioLangs"
        icon={VolumeHighIcon}
        label={t.settings.tracks.audio}
        hint={t.settings.hints.audio}
        mode={draft.audioMode}
        modes={(["all", "some"] as const).map((mode) => ({
          value: mode,
          label: t.settings.tracks.audioModes[mode],
        }))}
        onMode={(audioMode) => set({ audioMode })}
      />
      <LanguagesRow
        {...props}
        field="subtitleLangs"
        icon={SubtitleIcon}
        label={t.settings.tracks.subtitles}
        hint={t.settings.hints.subtitles}
        mode={draft.subtitleMode}
        modes={(["all", "none", "some"] as const).map((mode) => ({
          value: mode,
          label: t.settings.tracks.subtitleModes[mode],
        }))}
        onMode={(subtitleMode) => set({ subtitleMode })}
      />
      {draft.subtitleMode !== "none" && (
        <ToggleRow
          icon={Film01Icon}
          label={t.settings.tracks.external}
          hint={t.settings.hints.external}
          checked={draft.externalSubtitles}
          onChange={(externalSubtitles) => set({ externalSubtitles })}
        />
      )}
    </Group>
  );
}

/** The usual heights, and one set another way (the environment of old) in its place among them. */
function heightsWith(current: string): number[] {
  const height = Number(current);
  return current !== "" && !(COMMON_HEIGHTS as readonly number[]).includes(height)
    ? [...COMMON_HEIGHTS, height].sort((a, b) => b - a)
    : [...COMMON_HEIGHTS];
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
    <Group title={t.settings.browser.title}>
      <ToggleRow
        icon={BrowserIcon}
        label={t.settings.browser.on}
        hint={t.settings.hints.browser}
        {...(neededBySites ? { note: t.settings.browser.neededBySites } : {})}
        checked={on}
        disabled={neededBySites}
        onChange={(browserOn) => set({ browserOn })}
      />
      {on && (
        <AdvancedRows label={t.settings.downloads.advanced}>
          <DraftNumber
            {...props}
            field="timeoutSec"
            icon={Timer02Icon}
            label={t.settings.browser.timeout}
            hint={t.settings.hints.timeout}
            min={1}
            step={5}
          />
          <DraftNumber
            {...props}
            field="settleSec"
            icon={HourglassIcon}
            label={t.settings.browser.settle}
            hint={t.settings.hints.settle}
            min={0}
            step={0.5}
          />
          <DraftRow
            {...props}
            field="userAgent"
            icon={CodeIcon}
            label={t.settings.browser.userAgent}
            hint={t.settings.hints.userAgent}
            placeholder={t.settings.browser.userAgentPlaceholder}
          />
          <DraftRow
            {...props}
            field="chromiumPath"
            icon={Folder01Icon}
            label={t.settings.browser.chromium}
            hint={t.settings.hints.chromium}
            placeholder={t.settings.browser.chromiumPlaceholder}
          />
        </AdvancedRows>
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
