import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { desktopBridge } from "./desktop/bridge";
import { locale } from "./i18n/locale";

document.documentElement.lang = locale;
// Inside the desktop app the panel draws the window's title bar and makes room for it (index.css).
if (desktopBridge()) document.documentElement.classList.add("desktop");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
