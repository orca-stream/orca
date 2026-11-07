import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
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
import { SignInError, type SignInFailure } from "@orca/jellyfin";
import { CodeBoxes } from "../ui/CodeInput";
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
    // Aborted rather than a reassigned flag and timer (React's immutability rule): each wait clears
    // itself when the address changes or the panel goes, and a late answer is dropped.
    const controller = new AbortController();
    const { signal } = controller;
    function later(run: () => void, ms: number) {
      const cancel = () => clearTimeout(timer);
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", cancel);
        run();
      }, ms);
      signal.addEventListener("abort", cancel, { once: true });
    }

    async function request() {
      setResult({ server, state: { kind: "loading" } });
      try {
        const pending = await startQuickConnect(jellyfin, server);
        if (signal.aborted) return;
        setResult({ server, state: { kind: "ready", request: pending } });
        later(() => void poll(pending), POLL_MS);
      } catch (error) {
        if (signal.aborted) return;
        const reason = error instanceof SignInError ? error.reason : "unknown";
        setResult({ server, state: { kind: "failed", reason } });
      }
    }

    async function poll(pending: QuickConnectRequest) {
      const progress = await checkQuickConnect(pending);
      if (signal.aborted) return;
      if (progress.status === "approved") signedIn(progress.api, progress.session);
      else if (progress.status === "expired") void request();
      else later(() => void poll(pending), POLL_MS);
    }

    later(() => void request(), DEBOUNCE_MS);
    return () => controller.abort();
  }, [server]);

  const state: State =
    server.trim() === ""
      ? { kind: "idle" }
      : result?.server === server
        ? result.state
        : { kind: "loading" };

  return (
    <section aria-labelledby="quick-connect-title" className="grid content-start gap-5">
      <h2 id="quick-connect-title" className="text-xl font-semibold text-white/90">
        {t.quickConnect.title}
      </h2>
      <Body state={state} />
    </section>
  );
}

/** The QR's white card, also its placeholder while the code loads. */
const QR_CARD = "rounded-2xl bg-white p-3 shadow-[0_0_60px_-12px] shadow-white/25";

function Body({ state }: { state: State }) {
  switch (state.kind) {
    case "idle":
      return <p className="text-white/70">{t.quickConnect.needServer}</p>;
    case "loading":
      // The same layout as the code, empty: nothing moves once it arrives.
      return (
        <Layout
          qr={<div aria-hidden="true" className="size-40 animate-pulse rounded-lg bg-black/10" />}
          hint={
            <span className="animate-pulse" role="status">
              {t.quickConnect.loading}
            </span>
          }
          code=""
        />
      );
    case "failed":
      return (
        <p className="rounded-xl bg-white/5 px-4 py-3 text-white/70" role="status">
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

  return (
    <Layout
      qr={link && <QrCode value={link} className="size-40" />}
      hint={link ? t.quickConnect.typeCode : t.quickConnect.codeOnly}
      code={request.code}
    />
  );
}

interface LayoutProps {
  /** The QR, its placeholder, or null when no phone could open the app (just the code then). */
  qr: ReactNode;
  hint: ReactNode;
  code: string;
}

function Layout({ qr, hint, code }: LayoutProps) {
  return (
    <>
      {qr && (
        <div className="flex items-center gap-6">
          <div className={`${QR_CARD} flex-none`}>{qr}</div>
          <ol className="grid gap-3 text-sm text-white/70">
            {t.quickConnect.steps.map((step, index) => (
              <li key={step} className="flex items-center gap-3">
                <span className="grid size-6 flex-none place-items-center rounded-full bg-white/10 text-xs font-semibold text-white">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="min-h-10 text-sm text-white/50">{hint}</p>
      <p className="w-full" aria-label={code ? code.split("").join(" ") : undefined}>
        <CodeBoxes value={code} />
      </p>
    </>
  );
}
