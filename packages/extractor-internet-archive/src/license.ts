import type { ExtractedLicense, LicenseKind } from "@orca/extractor-core";

/** Maps an archive.org `licenseurl` to a kind. The field is set by the uploader, so it proves nothing. */
export function classifyLicense(url: string | undefined): Pick<ExtractedLicense, "kind" | "url"> {
  const kind = kindOf(url);
  return url === undefined ? { kind } : { kind, url };
}

function kindOf(url: string | undefined): LicenseKind {
  if (!url) return "unknown";
  const path = url.toLowerCase();
  if (path.includes("creativecommons.org/publicdomain/zero")) return "cc0";
  if (
    path.includes("creativecommons.org/publicdomain/mark") ||
    path.includes("creativecommons.org/licenses/publicdomain")
  ) {
    return "public-domain";
  }
  const cc = /creativecommons\.org\/licenses\/([a-z-]+)\//.exec(path)?.[1];
  if (cc === "by") return "cc-by";
  if (cc === "by-sa") return "cc-by-sa";
  if (cc) return "cc-other";
  return "unknown";
}
