import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { uwpHost } from "./host";
import { locale } from "./i18n/locale";
import { initBackButton } from "./navigation/back-button";
import { initGamepadKeys } from "./navigation/gamepad-keys";
import { initGamepadPolling } from "./navigation/gamepad-poll";
import { initSpatialNavigation } from "./navigation/spatial";

// index.html ships lang="en"; the page is in whatever language the browser asked for, and a wrong
// lang makes Edge and Chrome offer to translate a page that is already in the reader's language.
document.documentElement.lang = locale;
// The console has no pointer to scroll with, so the WebView2's scrollbar is only clutter on the TV.
if (uwpHost?.device === "xbox") document.documentElement.dataset.device = "xbox";

initGamepadKeys();
initGamepadPolling();
initSpatialNavigation();
void initBackButton();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
