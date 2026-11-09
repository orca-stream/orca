/** True when `host` is one of `hosts` or a subdomain of one. */
export const ownsHost = (hosts: readonly string[], host: string): boolean =>
  hosts.some((own) => host === own || host.endsWith(`.${own}`));

/** The input as a web address (http or https), or null. */
export function parseUrl(input: string): URL | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** The address without query, fragment or trailing slash: the same place always reads the same. */
export function normalizeUrl(url: URL): URL {
  const clean = new URL(url.href);
  clean.search = "";
  clean.hash = "";
  clean.pathname = clean.pathname.replace(/\/+$/, "") || "/";
  return clean;
}

/** The input as a web address on one of `hosts`, or null. */
export function ownedUrl(hosts: readonly string[], input: string): URL | null {
  const url = parseUrl(input);
  return url && ownsHost(hosts, url.hostname.toLowerCase()) ? url : null;
}
