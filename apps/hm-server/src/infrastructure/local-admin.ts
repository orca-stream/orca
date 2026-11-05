import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import * as z from "zod";
import type { Authenticated, Authenticator } from "../application/ports.ts";
import { AppError } from "../domain/errors.ts";

/*
 * The administrator this server keeps itself, for a panel signed in to without Jellyfin. One account:
 * its name and a scrypt hash of its password, kept in the settings table, never the password.
 */

/** scrypt's cost: 2^15 (OWASP's floor for scrypt), 8, 1 — about 32 MB and a tenth of a second. */
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_BYTES = 64;
const SALT_BYTES = 16;

/** What is stored: the name and `scrypt$N$r$p$salt$hash`, salt and hash in base64url. */
export const LocalAdmin = z.object({
  username: z.string().min(1),
  passwordHash: z.string().startsWith("scrypt$"),
});
export type LocalAdmin = z.infer<typeof LocalAdmin>;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_BYTES, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, SCRYPT);
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/** Whether `password` is the one `stored` was made from; false for anything that is not a hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const options = { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem };
  if (![options.N, options.r, options.p].every(Number.isSafeInteger)) return false;
  const key = await derive(password, Buffer.from(salt, "base64url"), options);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** The session's user id for the local administrator: there is only one, whatever its name. */
export const LOCAL_USER_ID = "local";

/** A hash nothing matches, checked when the name is wrong so a wrong name takes as long as a right one. */
let decoy: Promise<string> | null = null;

/**
 * Signs the server's own administrator in. Reads the account on every attempt, so a new password
 * takes effect without a restart.
 */
export class LocalAdminAuthenticator implements Authenticator {
  private readonly account: () => LocalAdmin | null;

  constructor(account: () => LocalAdmin | null) {
    this.account = account;
  }

  async authenticate(username: string, password: string): Promise<Authenticated> {
    const account = this.account();
    const sameName = account !== null && account.username === username.trim();
    decoy ??= hashPassword(randomBytes(16).toString("hex"));
    const matches = await verifyPassword(password, sameName ? account.passwordHash : await decoy);
    if (!sameName || !matches) {
      throw new AppError("unauthorized", "Wrong username or password");
    }
    return { userId: LOCAL_USER_ID, userName: account.username };
  }

  async isStillAdmin(userId: string): Promise<boolean> {
    return this.account() !== null && userId === LOCAL_USER_ID;
  }
}
