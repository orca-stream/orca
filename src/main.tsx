import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { initBackButton } from "./navigation/back-button";
import { initSpatialNavigation } from "./navigation/spatial";

initSpatialNavigation();
void initBackButton();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
