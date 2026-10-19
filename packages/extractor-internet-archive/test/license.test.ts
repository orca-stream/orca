import { describe, expect, it } from "vite-plus/test";
import { classifyLicense } from "../src/license.ts";

describe("classifyLicense", () => {
  it.each([
    ["http://creativecommons.org/publicdomain/mark/1.0/", "public-domain"],
    ["http://creativecommons.org/licenses/publicdomain/", "public-domain"],
    ["https://creativecommons.org/publicdomain/zero/1.0/", "cc0"],
    ["https://creativecommons.org/licenses/by/4.0/", "cc-by"],
    ["http://creativecommons.org/licenses/by-sa/3.0/", "cc-by-sa"],
    ["http://creativecommons.org/licenses/by-nc-nd/2.0/", "cc-other"],
    ["http://example.com/my-own-license", "unknown"],
    [undefined, "unknown"],
  ] as const)("%s is %s", (url, kind) => {
    expect(classifyLicense(url).kind).toBe(kind);
  });

  it("keeps the url it classified", () => {
    expect(classifyLicense("https://creativecommons.org/publicdomain/zero/1.0/").url).toBe(
      "https://creativecommons.org/publicdomain/zero/1.0/",
    );
  });
});
