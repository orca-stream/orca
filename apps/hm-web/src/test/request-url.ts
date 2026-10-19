/** The address a fetch call was given, in whichever of the three forms it came. */
export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}
