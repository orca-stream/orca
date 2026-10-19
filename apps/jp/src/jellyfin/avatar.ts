import { getImageApi } from "@jellyfin/sdk/lib/utils/api/image-api";
import { isAxiosError } from "axios";
import { refreshSession, SessionExpiredError, type Connection } from "./client";
import type { Session } from "./session";

/** The server keeps users from changing their own avatar (the admin turned preferences off). */
export class AvatarForbiddenError extends Error {
  constructor(options?: ErrorOptions) {
    super("The server doesn't let this user change their avatar", options);
    this.name = "AvatarForbiddenError";
  }
}

function translate(error: unknown): unknown {
  if (!isAxiosError(error)) return error;
  if (error.response?.status === 401) return new SessionExpiredError({ cause: error });
  if (error.response?.status === 403) return new AvatarForbiddenError({ cause: error });
  return error;
}

/** Base64 in chunks: spreading a whole photo into `String.fromCharCode` overflows the stack. */
export async function toBase64(image: Blob): Promise<string> {
  const bytes = new Uint8Array(await image.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

/**
 * Stores the image as the user's avatar on the server, so every device that signs in as them shows
 * it, and returns the session with the new image tag.
 */
export async function uploadAvatar(
  connection: Connection,
  session: Session,
  image: Blob,
): Promise<Session> {
  try {
    await getImageApi(connection).postUserImage(
      // The server reads the body as base64 text, not raw bytes, whatever the SDK's `File` type says.
      { userId: session.userId, body: (await toBase64(image)) as unknown as File },
      // The SDK sends `image/*`, from which the server can't pick a file extension.
      { headers: { "Content-Type": image.type } },
    );
  } catch (error) {
    throw translate(error);
  }
  return refreshSession(connection, session);
}

/** Deletes the user's avatar on the server; every device falls back to the initial. */
export async function removeAvatar(connection: Connection, session: Session): Promise<Session> {
  try {
    await getImageApi(connection).deleteUserImage({ userId: session.userId });
  } catch (error) {
    throw translate(error);
  }
  const { imageTag: _removed, ...rest } = session;
  return rest;
}
