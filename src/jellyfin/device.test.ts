import { describe, expect, it } from "vite-plus/test";
import { detectDeviceName } from "./device";

const webView = (model: string) =>
  `Mozilla/5.0 (Linux; Android 16; ${model} Build/BT2A.260319.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/143.0.7499.24 Mobile Safari/537.36`;

describe("detectDeviceName", () => {
  it("takes the Xbox/Windows app's word for it, whatever its WebView2 says", () => {
    const edge =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0";
    expect(detectDeviceName(edge, "xbox")).toBe("Xbox");
    expect(detectDeviceName(edge, "windows")).toBe("Windows");
    expect(detectDeviceName(edge)).toBe("Web browser");
  });

  it("names the Android app on a phone", () => {
    expect(detectDeviceName(webView("Pixel 8"))).toBe("Android");
  });

  it("names the Android app on Android TV and Google TV", () => {
    expect(detectDeviceName(webView("sdk_google_atv64_amati_x86_64"))).toBe("Android TV");
    expect(detectDeviceName(webView("Chromecast"))).toBe("Android TV");
    expect(detectDeviceName(webView("Google TV Streamer"))).toBe("Android TV");
    expect(detectDeviceName(webView("BRAVIA 4K VH2"))).toBe("Android TV");
  });

  it("keeps Chrome on Android a web browser", () => {
    const chrome =
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36";
    expect(detectDeviceName(chrome)).toBe("Web browser");
  });

  it("names the TV and console builds", () => {
    expect(detectDeviceName("Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36")).toBe(
      "LG webOS TV",
    );
    expect(detectDeviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One)")).toBe(
      "Xbox",
    );
  });
});
