import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { locale } from "./i18n/locale";
import { initBackButton } from "./navigation/back-button";
import { initSpatialNavigation } from "./navigation/spatial";

// index.html ships lang="en"; the page is in whatever language the browser asked for, and a wrong
// lang makes Edge and Chrome offer to translate a page that is already in the reader's language.
document.documentElement.lang = locale;

initSpatialNavigation();
void initBackButton();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
