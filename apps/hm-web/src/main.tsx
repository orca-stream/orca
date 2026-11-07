import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { desktopBridge } from "./desktop/bridge";
import { ignoreLockKeys } from "./desktop/lock-keys";
import { locale } from "./i18n/locale";

document.documentElement.lang = locale;
// Inside the desktop app the panel draws the window's title bar and makes room for it (index.css),
// and a stuck Scroll Lock under XWayland must not close every popup (lock-keys.ts).
if (desktopBridge()) {
  document.documentElement.classList.add("desktop");
  ignoreLockKeys();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
