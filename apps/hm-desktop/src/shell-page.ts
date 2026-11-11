// The app's own pages, for before the panel answers or when it never will. They look like the
// panel (its backdrop, its round 40px buttons) and keep a title bar: the window has no frame of its
// own, so without one it could be neither moved nor closed.
import { BrowserIcon, Cancel01Icon, MinusSignIcon, Video01Icon } from "@hugeicons/core-free-icons";

type IconNode = readonly (readonly [string, Readonly<Record<string, string | number>>])[];

/** A Hugeicons icon as inline SVG, 20px like every icon of the panel. */
function svg(icon: IconNode): string {
  const parts = icon.map(([tag, attributes]) => {
    const attrs = Object.entries(attributes)
      .filter(([name]) => name !== "key")
      .map(
        ([name, value]) =>
          `${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${String(value)}"`,
      )
      .join(" ");
    return `<${tag} ${attrs}/>`;
  });
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">${parts.join("")}</svg>`;
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

export interface ShellPageOptions {
  message: string;
  detail?: string;
  /** Shows the panel's spinner: the page is waiting, not reporting a failure. */
  busy?: boolean;
  /** The window's buttons; null where the system draws its own (macOS). */
  labels: WindowLabels | null;
}

/** What the window's own buttons say. */
export interface WindowLabels {
  minimize: string;
  close: string;
}

/** The looks every page of the app shares: the panel's backdrop and the title bar's buttons. */
const BASE_STYLE = `:root{color-scheme:light}
html,body{margin:0;height:100%;font:16px system-ui,sans-serif;color:#0b1220;background:#eef2f9;overflow:hidden}
.blob{position:fixed;border-radius:50%;filter:blur(64px);pointer-events:none}
.bar{position:fixed;inset:0 0 auto 0;height:56px;display:flex;align-items:center;justify-content:flex-end;
  gap:8px;padding:0 8px;-webkit-app-region:drag;z-index:1}
.bar button{-webkit-app-region:no-drag;width:40px;height:40px;border:0;border-radius:50%;display:grid;
  place-items:center;background:transparent;color:#5b6475;cursor:pointer}
.bar button:hover{background:rgb(255 255 255/.7);color:#0b1220}
.bar button.close:hover{background:#e5484d;color:#fff}
main{height:100%;display:grid;place-content:center;gap:16px;text-align:center;padding:16px;box-sizing:border-box}
p{margin:0}small{color:#5b6475;user-select:text}
.spin{width:32px;height:32px;margin:auto;border:3px solid rgb(0 102 255/.2);border-top-color:#06f;
  border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}`;

function page(labels: ShellPageOptions["labels"], body: string, style = "", script = ""): string {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Orca'H&amp;M</title>
<style>${BASE_STYLE}${style}</style></head><body>
<div class="blob" style="top:-160px;left:-128px;width:576px;height:576px;background:rgb(0 102 255/.25)"></div>
<div class="blob" style="top:25%;right:-160px;width:512px;height:512px;background:rgb(103 232 249/.35)"></div>
<div class="blob" style="bottom:-192px;left:33%;width:640px;height:640px;background:rgb(196 181 253/.3)"></div>
<div class="bar">${
    labels
      ? `
  <button aria-label="${escape(labels.minimize)}" onclick="orcaDesktop.minimize()">${svg(MinusSignIcon)}</button>
  <button class="close" aria-label="${escape(labels.close)}" onclick="orcaDesktop.close()">${svg(Cancel01Icon)}</button>
`
      : ""
  }</div>
${body}${script ? `<script>${script}</script>` : ""}
</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function shellPage({
  message,
  detail = "",
  busy = false,
  labels,
}: ShellPageOptions): string {
  return page(
    labels,
    `<main>${busy ? '<div class="spin" role="progressbar"></div>' : ""}<p>${escape(message)}</p><small>${escape(detail)}</small></main>`,
  );
}

/** One tool on the setup page, its words already in the person's language. */
export interface SetupRow {
  /** Which tool: picks its icon. */
  tool: "chromium" | "ffmpeg";
  label: string;
  /** "12.3 of 65.8 MB", "Installing…", "Ready". */
  status: string;
  /** 0–100; null while there is nothing to measure (unpacking), which animates the bar. */
  percent: number | null;
  state: "busy" | "ready" | "failed";
}

export interface SetupView {
  title: string;
  detail: string;
  rows: SetupRow[];
  /** Set once something failed: what to tell, and the retry button's label. */
  failure?: { message: string; detail: string; retry: string };
}

/** Where the setup page's "Retry" navigates; the main process catches it and never loads it. */
export const RETRY_URL = "orca-hm:retry";

const SETUP_STYLE = `
.card{width:min(480px,calc(100vw - 32px));box-sizing:border-box;padding:16px;display:grid;gap:16px;text-align:left;
  border-radius:36px;border:1px solid rgb(255 255 255/.7);background:rgb(255 255 255/.55);
  box-shadow:inset 0 1px 0 0 rgb(255 255 255/.8),0 16px 48px -20px rgb(40 52 90/.22);backdrop-filter:blur(24px) saturate(1.6)}
.head{display:grid;gap:4px}.head p{font-weight:600}
.row{display:grid;gap:16px;padding:16px;border-radius:19px;border:1px solid rgb(255 255 255/.7);
  background:rgb(255 255 255/.6);box-shadow:0 12px 32px -16px rgb(40 52 90/.22)}
.line{display:flex;align-items:center;gap:16px;font-size:14px}
.line svg{flex:none;color:#5b6475}.name{flex:1;font-weight:500}
.status{color:#5b6475;font-variant-numeric:tabular-nums}
.track{height:4px;border-radius:999px;background:rgb(11 18 32/.1);overflow:hidden}
.fill{height:100%;background:#06f;border-radius:999px;transition:width .2s}
.row.indeterminate .fill{width:40%!important;animation:slide 1.2s ease-in-out infinite}
.row.failed .fill{background:#e5484d}
@keyframes slide{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
.failure{display:grid;gap:16px}.failure small{display:block;overflow-wrap:anywhere}
.retry{height:56px;border:0;border-radius:999px;padding:0 24px;font:inherit;background:#06f;color:#fff;cursor:pointer}
.retry:hover{background:rgb(0 102 255/.85)}`;

// Draws a SetupView; the main process calls window.orcaSetup again with every change.
// Each tool's card shows the panel's icon for it: the browser, and video for ffmpeg.
const TOOL_ICONS = { chromium: svg(BrowserIcon), ffmpeg: svg(Video01Icon) };

const SETUP_SCRIPT = `
const icons = ${JSON.stringify(TOOL_ICONS)};
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
window.orcaSetup = (view) => {
  const card = el("section", "card");
  const head = el("div", "head");
  head.append(el("p", "", view.title), el("small", "", view.detail));
  card.append(head);
  for (const row of view.rows) {
    const box = el("div", "row" + (row.percent === null && row.state === "busy" ? " indeterminate" : "") + (row.state === "failed" ? " failed" : ""));
    const line = el("div", "line");
    const icon = document.createElement("span");
    icon.innerHTML = icons[row.tool] ?? "";
    line.append(icon.firstChild ?? icon, el("span", "name", row.label), el("span", "status", row.status));
    const track = el("div", "track");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", row.label);
    if (row.percent !== null) track.setAttribute("aria-valuenow", String(Math.round(row.percent)));
    const fill = el("div", "fill");
    fill.style.width = (row.state === "ready" ? 100 : row.percent ?? 0) + "%";
    track.append(fill);
    box.append(line, track);
    card.append(box);
  }
  if (view.failure) {
    const failure = el("div", "failure");
    const words = el("div", "head");
    words.append(el("p", "", view.failure.message), el("small", "", view.failure.detail));
    const retry = el("button", "retry", view.failure.retry);
    retry.onclick = () => { location.href = ${JSON.stringify(RETRY_URL)}; };
    failure.append(words, retry);
    card.append(failure);
  }
  document.querySelector("main").replaceChildren(card);
};`;

/** The first start's page: each tool's download, and a retry when one fails. */
export function setupPage(view: SetupView, labels: ShellPageOptions["labels"]): string {
  return page(
    labels,
    "<main></main>",
    SETUP_STYLE,
    `${SETUP_SCRIPT}\nwindow.orcaSetup(${JSON.stringify(view).replace(/</g, "\\u003c")});`,
  );
}
