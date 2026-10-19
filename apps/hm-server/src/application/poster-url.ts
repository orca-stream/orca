/**
 * The poster address an extractor named, if it is safe for this server to fetch for the panel: https,
 * no credentials, no custom port, and on one of the extractor's own hosts (or a subdomain of one).
 * Anything else is treated as "no poster", so a poster route can never be turned against other hosts.
 */
export function trustedPosterUrl(
  posterUrl: string | undefined,
  extractorHosts: readonly string[],
): string | null {
  if (!posterUrl) return null;
  let url: URL;
  try {
    url = new URL(posterUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const trusted = extractorHosts.some((own) => {
    const base = own.toLowerCase();
    return host === base || host.endsWith(`.${base}`);
  });
  return trusted ? url.href : null;
}
