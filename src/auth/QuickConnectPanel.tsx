import { useEffect, useEffectEvent, useState } from "react";
import { t } from "../i18n/locale";
import { jellyfin, type Connection } from "../jellyfin/client";
import { detectDeviceName } from "../jellyfin/device";
import {
  checkQuickConnect,
  phoneReachableAppUrl,
  quickConnectUrl,
  startQuickConnect,
  type QuickConnectRequest,
} from "../jellyfin/quick-connect";
import type { Session } from "../jellyfin/session";
import { SignInError, type SignInFailure } from "../jellyfin/sign-in";
import { QrCode } from "../ui/QrCode";

/** How often the TV asks whether the phone approved: quick enough to feel instant. */
const POLL_MS = 2000;
/** Waits for typing to pause before asking a half-typed address for a code. */
const DEBOUNCE_MS = 600;

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; request: QuickConnectRequest }
  | { kind: "failed"; reason: SignInFailure };

interface Props {
  /** The address in the sign-in form, as typed. */
  server: string;
  onSignedIn: (connection: Connection, session: Session) => void;
}

/**
 * Netflix's "sign in with your phone": a QR the phone opens to approve this device through
 * Jellyfin's Quick Connect, and the code for typing it in by hand. Signs in on its own once approved.
 */
export function QuickConnectPanel({ server, onSignedIn }: Props) {
  // Tagged with the address it belongs to: a newly typed one shows as loading until it answers.
  const [result, setResult] = useState<{ server: string; state: State } | null>(null);
  const signedIn = useEffectEvent(onSignedIn);

  useEffect(() => {
    if (server.trim() === "") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function request() {
      setResult({ server, state: { kind: "loading" } });
      try {
        const pending = await startQuickConnect(jellyfin, server);
        if (cancelled) return;
        setResult({ server, state: { kind: "ready", request: pending } });
        timer = setTimeout(() => void poll(pending), POLL_MS);
      } catch (error) {
        if (cancelled) return;
        const reason = error instanceof SignInError ? error.reason : "unknown";
        setResult({ server, state: { kind: "failed", reason } });
      }
    }

    async function poll(pending: QuickConnectRequest) {
      const progress = await checkQuickConnect(pending);
      if (cancelled) return;
      if (progress.status === "approved") signedIn(progress.api, progress.session);
      else if (progress.status === "expired") void request();
      else timer = setTimeout(() => void poll(pending), POLL_MS);
    }

    timer = setTimeout(() => void request(), DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [server]);

  const state: State =
    server.trim() === ""
      ? { kind: "idle" }
      : result?.server === server
        ? result.state
        : { kind: "loading" };

  return (
    <section
      aria-labelledby="quick-connect-title"
      className="grid content-start justify-items-center gap-4 text-center"
    >
      <h2 id="quick-connect-title" className="text-2xl font-semibold">
        {t.quickConnect.title}
      </h2>
      <Body state={state} />
    </section>
  );
}

function Body({ state }: { state: State }) {
  switch (state.kind) {
    case "idle":
      return <p className="max-w-xs text-white/70">{t.quickConnect.needServer}</p>;
    case "loading":
      return (
        <>
          <div aria-hidden="true" className="size-56 animate-pulse rounded-xl bg-white/10" />
          <p className="text-white/70" role="status">
            {t.quickConnect.loading}
          </p>
        </>
      );
    case "failed":
      return (
        <p className="max-w-xs text-white/70" role="status">
          {t.errors[state.reason]}
        </p>
      );
    case "ready":
      return <Ready request={state.request} />;
  }
}

function Ready({ request }: { request: QuickConnectRequest }) {
  const appUrl = phoneReachableAppUrl(new URL(location.href), import.meta.env.VITE_PUBLIC_URL);
  const link =
    appUrl &&
    quickConnectUrl(appUrl, {
      code: request.code,
      server: request.server.serverUrl,
      serverId: request.server.serverId,
      device: detectDeviceName(navigator.userAgent),
    });
  // Read in two halves, like Netflix's TV codes: "922 779".
  const code = `${request.code.slice(0, 3)} ${request.code.slice(3)}`;

  return (
    <>
      {link && (
        <>
          <QrCode value={link} className="size-56 rounded-xl" />
          <p className="max-w-xs text-white/70">{t.quickConnect.scan}</p>
        </>
      )}
      <p className="max-w-xs text-sm text-white/60">
        {link ? t.quickConnect.typeCode : t.quickConnect.codeOnly}
      </p>
      <p
        className="font-mono text-4xl font-semibold tracking-[0.2em] tabular-nums"
        aria-label={request.code.split("").join(" ")}
      >
        {code}
      </p>
    </>
  );
}
