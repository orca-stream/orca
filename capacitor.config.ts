import type { CapacitorConfig } from "@capacitor/cli";

// The Android app (phone and Android TV) ships the built site from dist/; it never loads a hosted URL.
const config: CapacitorConfig = {
  appId: "io.github.orcastream.orca",
  appName: "Orca'JP",
  webDir: "dist",
  backgroundColor: "#000000",
  server: {
    // Served from http://localhost (still a secure context), so Jellyfin servers on plain http in the
    // LAN (http://192.168.1.100:8096) are not blocked as mixed content, as they would be from https.
    androidScheme: "http",
  },
  plugins: {
    SystemBars: {
      // Pages draw under the status bar, edge to edge as Netflix does, and pad themselves with
      // env(safe-area-inset-*); index.html says viewport-fit=cover, this avoids a first-frame jump.
      initialViewportFitValueHint: "cover",
      // Light icons: every screen is dark.
      style: "DARK",
    },
  },
};

export default config;
