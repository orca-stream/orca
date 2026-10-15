import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useEffect, useState, type FormEvent } from "react";
import { t } from "../i18n/locale";
import { jellyfin } from "../jellyfin/client";
import { normalizeServerUrl } from "../jellyfin/server-url";
import { probeServer, serverKind, type ServerKind, type ServerProbe } from "../jellyfin/servers";
import { FocusButton, FocusInput } from "../navigation/Focusable";
import { GlobeIcon, HomeIcon, LaptopIcon, PlusIcon } from "../ui/icons";

interface Props {
  /** Addresses to offer, already normalized; see `serverChoices`. */
  servers: string[];
  onPick: (serverUrl: string) => void;
  onCancel?: () => void;
}

const KIND_ICON: Record<ServerKind, typeof GlobeIcon> = {
  internet: GlobeIcon,
  local: HomeIcon,
  thisDevice: LaptopIcon,
};

/** A globe, a house or a laptop: where the address says the server lives. */
export function ServerKindIcon({ server, className }: { server: string; className?: string }) {
  const Icon = KIND_ICON[serverKind(server)];
  return <Icon className={className} />;
}

const CARD =
  "group flex w-full items-center gap-4 rounded-2xl bg-white/[0.06] p-4 text-left ring-1 ring-white/10 outline-none transition hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-white focused:bg-white/[0.12] focused:ring-2 focused:ring-white";

/**
 * The first step of signing in: which Jellyfin to talk to. Each address is asked for its name as
 * soon as the list shows, so the one that answers from this device stands out.
 */
export function ServerPicker({ servers: offered, onPick, onCancel }: Props) {
  // Fixed while the picker is open: a parent re-rendering mustn't ask every server again.
  const [servers] = useState(offered);
  const [probes, setProbes] = useState<Record<string, ServerProbe>>({});
  const [typing, setTyping] = useState(servers.length === 0);
  const { ref, focusKey, focusSelf } = useFocusable({ focusKey: "SERVER_PICKER" });

  useEffect(() => {
    focusSelf();
  }, [focusSelf]);

  useEffect(() => {
    let cancelled = false;
    for (const server of servers) {
      void probeServer(jellyfin, server).then((probe) => {
        if (!cancelled) setProbes((current) => ({ ...current, [server]: probe }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [servers]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="grid w-full max-w-xl gap-8">
        <div className="grid gap-2 text-center">
          <h1 className="text-3xl font-bold sm:text-4xl">{t.login.chooseServer}</h1>
          <p className="text-white/60">{t.login.chooseServerHint}</p>
        </div>

        <ul className="grid gap-3">
          {servers.map((server) => (
            <li key={server}>
              <ServerCard server={server} probe={probes[server]} onPick={() => onPick(server)} />
            </li>
          ))}
          <li>
            {typing ? (
              <OtherServer onPick={onPick} />
            ) : (
              <FocusButton className={CARD} onPress={() => setTyping(true)}>
                <span className="grid size-12 flex-none place-items-center rounded-xl bg-white/10 text-white/70">
                  <PlusIcon className="size-6" />
                </span>
                <span className="text-lg text-white/80">{t.login.otherServer}</span>
              </FocusButton>
            )}
          </li>
        </ul>

        {onCancel && (
          <FocusButton
            onPress={onCancel}
            className="justify-self-center rounded-full px-6 py-2.5 text-white/70 outline-none hover:bg-white/10 hover:text-white focused:bg-white focused:text-black"
          >
            {t.login.back}
          </FocusButton>
        )}
      </div>
    </FocusContext.Provider>
  );
}

function ServerCard({
  server,
  probe,
  onPick,
}: {
  server: string;
  probe: ServerProbe | undefined;
  onPick: () => void;
}) {
  const kind = serverKind(server);
  const url = new URL(server);
  const online = probe?.status === "online";

  return (
    <FocusButton
      className={`${CARD} ${probe?.status === "offline" ? "opacity-60" : ""}`}
      onPress={onPick}
    >
      <span className="grid size-12 flex-none place-items-center rounded-xl bg-white/10">
        <ServerKindIcon server={server} className="size-6" />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-lg font-semibold">{online ? probe.name : url.host}</span>
        <span className="truncate text-sm text-white/50">
          {online ? `${url.host} · ` : ""}
          {t.login.kind[kind]}
        </span>
      </span>
      <Status probe={probe} />
    </FocusButton>
  );
}

function Status({ probe }: { probe: ServerProbe | undefined }) {
  const [dot, label] = !probe
    ? ["animate-pulse bg-white/40", t.login.checking]
    : probe.status === "online"
      ? ["bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/70", t.login.online]
      : ["bg-white/30", t.login.offline];
  return (
    <span className="flex flex-none items-center gap-2 text-sm text-white/60">
      <span className={`size-2 rounded-full ${dot}`} />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

function OtherServer({ onPick }: { onPick: (serverUrl: string) => void }) {
  const [address, setAddress] = useState("");
  const [invalid, setInvalid] = useState(false);
  const { ref, focusKey, focusSelf } = useFocusable({ focusKey: "SERVER_OTHER" });

  useEffect(() => {
    focusSelf();
  }, [focusSelf]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      onPick(normalizeServerUrl(address));
    } catch {
      setInvalid(true);
    }
  }

  return (
    <FocusContext.Provider value={focusKey}>
      <form
        ref={ref}
        onSubmit={handleSubmit}
        className="grid gap-3 rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10"
      >
        <label className="grid gap-2 text-sm text-white/70">
          {t.login.otherServerHint}
          <FocusInput
            className="rounded-xl border border-white/20 bg-black/40 px-4 py-3 text-base text-white outline-none placeholder:text-white/30 focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/60"
            // Not type="url": the browser would reject a bare "192.168.1.100:8096".
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={address}
            placeholder={t.login.serverHint}
            onChange={(event) => {
              setAddress(event.target.value);
              setInvalid(false);
            }}
          />
        </label>
        {invalid && (
          <p className="text-sm text-red-300" role="alert">
            {t.errors.invalidAddress}
          </p>
        )}
        <FocusButton
          type="submit"
          className="rounded-xl bg-white px-4 py-3 font-semibold text-black outline-none hover:bg-white/90 focus-visible:ring-4 focus-visible:ring-white/60 focused:ring-4 focused:ring-white/60"
        >
          {t.login.useServer}
        </FocusButton>
      </form>
    </FocusContext.Provider>
  );
}
