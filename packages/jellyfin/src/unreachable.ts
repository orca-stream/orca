import { isAxiosError } from "axios";

/** The server never answered: offline, another network, refused, timed out. Not a server error. */
export function isUnreachable(error: unknown): boolean {
  return isAxiosError(error) && !error.response;
}
