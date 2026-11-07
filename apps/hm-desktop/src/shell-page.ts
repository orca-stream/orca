// The app's own pages, for before the panel answers or when it never will. They look like the
// panel (its backdrop, its round 40px buttons) and keep a title bar: the window has no frame of its
// own, so without one it could be neither moved nor closed.
import { Cancel01Icon, MinusSignIcon } from "@hugeicons/core-free-icons";

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
  labels: { minimize: string; close: string };
}

export function shellPage({
  message,
  detail = "",
  busy = false,
  labels,
}: ShellPageOptions): string {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Orca'H&amp;M</title>
<style>
:root{color-scheme:light}
html,body{margin:0;height:100%;font:16px system-ui,sans-serif;color:#0b1220;background:#eef2f9;overflow:hidden}
.blob{position:fixed;border-radius:50%;filter:blur(64px);pointer-events:none}
.bar{position:fixed;inset:0 0 auto 0;height:56px;display:flex;align-items:center;justify-content:flex-end;
  gap:8px;padding:0 8px;-webkit-app-region:drag}
.bar button{-webkit-app-region:no-drag;width:40px;height:40px;border:0;border-radius:50%;display:grid;
  place-items:center;background:transparent;color:#5b6475;cursor:pointer}
.bar button:hover{background:rgb(255 255 255/.7);color:#0b1220}
.bar button.close:hover{background:#e5484d;color:#fff}
main{height:100%;display:grid;place-content:center;gap:16px;text-align:center;padding:16px;box-sizing:border-box}
p{margin:0}small{color:#5b6475;user-select:text}
.spin{width:32px;height:32px;margin:auto;border:3px solid rgb(0 102 255/.2);border-top-color:#06f;
  border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body>
<div class="blob" style="top:-160px;left:-128px;width:576px;height:576px;background:rgb(0 102 255/.25)"></div>
<div class="blob" style="top:25%;right:-160px;width:512px;height:512px;background:rgb(103 232 249/.35)"></div>
<div class="blob" style="bottom:-192px;left:33%;width:640px;height:640px;background:rgb(196 181 253/.3)"></div>
<div class="bar">
  <button aria-label="${escape(labels.minimize)}" onclick="orcaDesktop.minimize()">${svg(MinusSignIcon)}</button>
  <button class="close" aria-label="${escape(labels.close)}" onclick="orcaDesktop.close()">${svg(Cancel01Icon)}</button>
</div>
<main>${busy ? '<div class="spin" role="progressbar"></div>' : ""}<p>${escape(message)}</p><small>${escape(detail)}</small></main>
</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
