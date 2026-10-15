import { readItem, writeItem, type KeyValueStore } from "../storage";

const DEVICE_ID_KEY = "orca.deviceId";

/**
 * A stable id for this install. Jellyfin keys sessions and device settings on it, so it must survive
 * reloads. Built from `getRandomValues` rather than `randomUUID`, which only exists in secure
 * contexts — and the dev server on the LAN and the TV are plain http.
 */
export function getOrCreateDeviceId(store: KeyValueStore): string {
  const existing = readItem(store, DEVICE_ID_KEY);
  if (existing) return existing;

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  writeItem(store, DEVICE_ID_KEY, id);
  return id;
}

/** The name shown in Jellyfin's dashboard under Devices. */
export function detectDeviceName(userAgent: string): string {
  if (/web0s|webos/i.test(userAgent)) return "LG webOS TV";
  if (/xbox/i.test(userAgent)) return "Xbox";
  // The Android app's WebView marks itself with "; wv)"; TVs give themselves away in the model name.
  if (/android/i.test(userAgent) && /; wv\)/.test(userAgent)) {
    return /\btv\b|atv|chromecast|bravia|\baft/i.test(userAgent) ? "Android TV" : "Android";
  }
  return "Web browser";
}
