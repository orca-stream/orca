import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n/locale";
import { AvatarForbiddenError, removeAvatar, uploadAvatar } from "../jellyfin/avatar";
import { resumeSession, SessionExpiredError } from "../jellyfin/client";
import type { Session } from "../jellyfin/session";
import { FocusButton } from "../navigation/Focusable";
import { useBackKey } from "../navigation/use-back-key";
import { BackIcon, PencilIcon, TrashIcon } from "../ui/icons";
import { Avatar } from "./Avatar";
import { photoToAvatar, pictureToAvatar } from "./avatar-image";
import { IconRow } from "./IconRow";
import { AVATAR_LIBRARY } from "./avatar-library";

interface Props {
  session: Session;
  /** The profile with its new avatar, to store on this device. */
  onChange: (session: Session) => void;
  /** Asks to remove the profile from this device; the gate confirms it. */
  onRemove: () => void;
  onBack: () => void;
}

const PILL =
  "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 font-semibold outline-none transition-colors";
const SECONDARY = `${PILL} bg-white/15 hover:bg-white/25 focused:bg-white focused:text-black disabled:opacity-40`;

type Status = { kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string };

function errorMessage(error: unknown, session: Session): string {
  if (error instanceof AvatarForbiddenError) return t.profiles.forbidden;
  if (error instanceof SessionExpiredError) return t.login.expired(session.userName);
  return t.errors.unknown;
}

/**
 * Netflix's "edit profile": the avatar is stored on the Jellyfin server, so changing it here changes
 * it on every device the user signs in from.
 */
export function ProfileEditor({ session, onChange, onRemove, onBack }: Props) {
  const [picking, setPicking] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const fileInput = useRef<HTMLInputElement>(null);
  const { ref, focusKey, focusSelf } = useFocusable({
    focusKey: "PROFILE_EDITOR",
    preferredChildFocusKey: "EDITOR_CHANGE_ICON",
  });
  const saving = status.kind === "saving";

  useEffect(() => {
    if (!picking) focusSelf();
  }, [focusSelf, picking]);
  useBackKey(onBack, { enabled: !picking });

  async function save(change: () => Promise<Session>) {
    setPicking(false);
    setStatus({ kind: "saving" });
    try {
      onChange(await change());
      setStatus({ kind: "saved" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error, session) });
    }
  }

  const connection = () => resumeSession(session);

  if (picking) {
    return (
      <IconPicker
        session={session}
        onBack={() => setPicking(false)}
        onPick={(url) =>
          void save(async () => uploadAvatar(connection(), session, await pictureToAvatar(url)))
        }
      />
    );
  }

  return (
    <FocusContext.Provider value={focusKey}>
      <main
        ref={ref}
        className="relative grid min-h-dvh place-content-center justify-items-center gap-6 bg-[radial-gradient(ellipse_at_50%_0%,#4a0d14_0%,#2a070b_45%,#0d0203_100%)] px-4 py-24 text-center"
      >
        <FocusButton
          className="absolute top-[calc(1.5rem+env(safe-area-inset-top))] left-4 grid size-11 place-items-center rounded-full outline-none hover:bg-white/10 focused:bg-white focused:text-black sm:left-16"
          aria-label={t.profiles.back}
          onPress={onBack}
        >
          <BackIcon className="size-6" />
        </FocusButton>

        <h1 className="text-3xl font-bold sm:text-4xl">{t.profiles.editTitle}</h1>

        <div className="relative">
          <Avatar
            session={session}
            className={`size-32 rounded-xl text-5xl sm:size-40 sm:text-6xl ${saving ? "opacity-40" : ""}`}
          />
          <span className="absolute -right-2 -bottom-2 grid size-10 place-items-center rounded-full bg-black/80 ring-2 ring-white/30">
            <PencilIcon className="size-5" />
          </span>
        </div>
        <p className="text-xl font-semibold">{session.userName}</p>

        <p role="status" className="min-h-6 text-sm text-white/70">
          {status.kind === "saving" && t.profiles.saving}
          {status.kind === "saved" && t.profiles.synced}
          {status.kind === "error" && <span className="text-red-400">{status.message}</span>}
        </p>

        <div className="grid w-full max-w-xs gap-3">
          <FocusButton
            focusKey="EDITOR_CHANGE_ICON"
            className={`${PILL} bg-white text-black hover:bg-white/85 focused:ring-4 focused:ring-white/50 disabled:opacity-40`}
            disabled={saving}
            onPress={() => setPicking(true)}
          >
            {t.profiles.changeIcon}
          </FocusButton>
          <FocusButton
            className={SECONDARY}
            disabled={saving}
            onPress={() => fileInput.current?.click()}
          >
            {t.profiles.uploadPhoto}
          </FocusButton>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const photo = event.target.files?.[0];
              event.target.value = "";
              if (photo) {
                void save(async () =>
                  uploadAvatar(connection(), session, await photoToAvatar(photo)),
                );
              }
            }}
          />
          {session.imageTag && (
            <FocusButton
              className={SECONDARY}
              disabled={saving}
              onPress={() => void save(() => removeAvatar(connection(), session))}
            >
              {t.profiles.removeImage}
            </FocusButton>
          )}
          <FocusButton
            className={`${PILL} mt-4 text-red-400 hover:bg-red-600/20 focused:bg-red-600 focused:text-white disabled:opacity-40`}
            disabled={saving}
            onPress={onRemove}
          >
            <TrashIcon className="size-5" />
            {t.profiles.removeFromDevice}
          </FocusButton>
        </div>
      </main>
    </FocusContext.Provider>
  );
}

interface PickerProps {
  session: Session;
  onPick: (url: string) => void;
  onBack: () => void;
}

/** Netflix's "choose a profile icon": a row per library folder, built-in faces last. */
function IconPicker({ session, onPick, onBack }: PickerProps) {
  const { ref, focusKey, focusSelf } = useFocusable({ focusKey: "ICON_PICKER" });
  useBackKey(onBack);

  useEffect(() => {
    focusSelf();
  }, [focusSelf]);

  return (
    <FocusContext.Provider value={focusKey}>
      <main ref={ref} className="min-h-dvh bg-neutral-950 pb-16">
        {/* Not sticky: the arrows measure where things sit in the page, and a header stuck over the
            rows would sit among them, so Up from a row would land on Back. It scrolls away, as on
            Netflix's TV app, and comes back with the first row. */}
        <header className="grid grid-cols-[auto_1fr_auto] items-center gap-4 px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-4 sm:px-16">
          <FocusButton
            className="grid size-11 place-items-center rounded-full outline-none hover:bg-white/10 focused:bg-white focused:text-black"
            aria-label={t.profiles.back}
            onPress={onBack}
          >
            <BackIcon className="size-6" />
          </FocusButton>
          <div className="grid justify-items-center gap-1 text-center">
            <h1 className="text-xl font-bold sm:text-2xl">{t.profiles.pickTitle}</h1>
            <p className="flex items-center gap-2 text-white/70">
              {t.profiles.pickFor(session.userName)}
              <Avatar session={session} className="size-7 rounded-full text-sm" />
            </p>
          </div>
          <span className="size-11" />
        </header>

        <div className="grid gap-8 px-4 pt-8 sm:px-16">
          {AVATAR_LIBRARY.map((category, row) => (
            <section key={category.title ?? ""} className="grid scroll-mt-4 scroll-mb-16 gap-3">
              <h2 className="text-lg font-bold sm:text-2xl">
                {category.title ?? t.profiles.builtInIcons}
              </h2>
              <IconRow>
                {category.icons.map((icon, index) => (
                  <li key={icon.id} className="flex-none">
                    <FocusButton
                      className="block rounded-md outline-none transition-transform hover:scale-105 focused:scale-105 focused:ring-4 focused:ring-white"
                      aria-label={t.profiles.pickLabel(
                        category.title ?? t.profiles.builtInIcons,
                        index + 1,
                      )}
                      onFocused={(node) => revealIcon(node, row === 0)}
                      onPress={() => onPick(icon.url)}
                    >
                      <img
                        src={icon.url}
                        alt=""
                        loading="lazy"
                        draggable={false}
                        className="size-20 rounded-md object-cover sm:size-32"
                      />
                    </FocusButton>
                  </li>
                ))}
              </IconRow>
            </section>
          ))}
        </div>
      </main>
    </FocusContext.Provider>
  );
}

/**
 * Brings a focused icon into view with its whole row and the row's title, leaving room below it (a
 * TV may crop the screen's edges). The first row brings the header back too.
 */
function revealIcon(node: HTMLElement, firstRow: boolean): void {
  node.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (firstRow) window.scrollTo({ top: 0 });
  else node.closest("section")?.scrollIntoView({ block: "nearest" });
}
