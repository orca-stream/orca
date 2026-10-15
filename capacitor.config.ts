import type { CapacitorConfig } from "@capacitor/cli";

// The Android app (phone and Android TV) ships the built site from dist/; it never loads a hosted URL.
const config: CapacitorConfig = {
  appId: "io.github.orcastream.orca",
  appName: "ORCA'JP",
  webDir: "dist",
  backgroundColor: "#000000",
  server: {
    // Served from http://localhost (still a secure context), so Jellyfin servers on plain http in the
    // LAN (http://192.168.1.100:8096) are not blocked as mixed content, as they would be from https.
    androidScheme: "http",
  },
};

export default config;
