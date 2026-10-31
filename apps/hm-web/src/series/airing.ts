import type { ShowLookupDto } from "@orca/hm-contract";

/**
 * What is worth saying about a series and whether its show still airs: a followed show that TMDB
 * says has ended or was canceled will bring nothing new, and one still airing that isn't followed
 * will miss what comes. Null when following matches the show, or TMDB doesn't say.
 */
export type AiringHint = "ended" | "canceled" | "airing";

export function airingHint(follow: boolean, status: ShowLookupDto["status"]): AiringHint | null {
  if (follow && (status === "ended" || status === "canceled")) return status;
  if (!follow && status === "airing") return "airing";
  return null;
}
