// Ends a startup sequence on X11: the "remove" message of the startup-notification spec
// (https://specifications.freedesktop.org/startup-notification-spec/latest/).
//
// Why the app needs it: GNOME's tray (ubuntu-appindicators) starts a startup sequence, busy cursor
// included, for every click on a tray menu item, and hands its id to the app. With XWayland running,
// mutter tracks that sequence through libsn, which ends it only on a "remove" message from an X11
// client (or after 15 seconds). Chromium's tray takes the id and puts it on the next window it shows
// as _NET_STARTUP_ID, but never sends "remove"; so the app reads it there and sends it itself.
import x11 from "x11";

/** Values with spaces, quotes or backslashes go quoted, with quotes and backslashes escaped. */
export function quoteValue(value: string): string {
  if (!/[\s"\\]/.test(value)) return value;
  return `"${value.replace(/["\\]/g, (c) => `\\${c}`)}"`;
}

export function removeMessage(id: string): string {
  return `remove: ID=${quoteValue(id)}`;
}

const CLIENT_MESSAGE = 33;
const CHUNK = 20;

/**
 * The 32-byte ClientMessage events that carry a message: its UTF-8 bytes and a closing NUL, 20 at a
 * time, the first of type _NET_STARTUP_INFO_BEGIN and the rest _NET_STARTUP_INFO.
 */
export function messageEvents(
  message: string,
  window: number,
  atoms: { begin: number; more: number },
): Buffer[] {
  const bytes = Buffer.concat([Buffer.from(message, "utf8"), Buffer.alloc(1)]);
  const events: Buffer[] = [];
  for (let at = 0; at < bytes.length; at += CHUNK) {
    const event = Buffer.alloc(32);
    event[0] = CLIENT_MESSAGE;
    event[1] = 8; // format: bytes
    event.writeUInt32LE(window >>> 0, 4);
    event.writeUInt32LE((at === 0 ? atoms.begin : atoms.more) >>> 0, 8);
    bytes.copy(event, 12, at, Math.min(bytes.length, at + CHUNK));
    events.push(event);
  }
  return events;
}

const PROPERTY_CHANGE_MASK = 0x00400000;
const ANY_PROPERTY_TYPE = 0;
/** The whole exchange is a few round trips on a local socket; past this, give up quietly. */
const TIMEOUT_MS = 2_000;

interface XClient {
  InternAtom(onlyIfExists: boolean, name: string, cb: (err: unknown, atom: number) => void): void;
  GetProperty(
    del: number,
    wid: number,
    name: number,
    type: number,
    offset: number,
    length: number,
    cb: (err: unknown, prop: { data: Buffer }) => void,
  ): void;
  SendEvent(destination: number, propagate: boolean, mask: number, event: Buffer): void;
  close(cb?: () => void): void;
  terminate(): void;
}

interface XDisplay {
  client: XClient;
  screen: { root: number }[];
}

function promisify<T>(call: (cb: (err: unknown, value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) =>
    call((err, value) =>
      err ? reject(err instanceof Error ? err : new Error(JSON.stringify(err))) : resolve(value),
    ),
  );
}

/**
 * Reads the startup id Chromium put on `window` (an X11 window id) and ends that sequence. Resolves
 * with the id it ended, or undefined when there was none; never rejects.
 */
export async function endStartupSequence(window: number): Promise<string | undefined> {
  let display: XDisplay | undefined;
  const work = (async () => {
    display = await promisify<XDisplay>((cb) => x11.createClient(cb));
    const X = display.client;
    const atom = (name: string) => promisify<number>((cb) => X.InternAtom(false, name, cb));
    const [startupId, begin, more] = await Promise.all([
      atom("_NET_STARTUP_ID"),
      atom("_NET_STARTUP_INFO_BEGIN"),
      atom("_NET_STARTUP_INFO"),
    ]);
    const prop = await promisify<{ data: Buffer }>((cb) =>
      X.GetProperty(0, window, startupId, ANY_PROPERTY_TYPE, 0, 1024, cb),
    );
    const id = prop.data.toString("utf8");
    if (!id) return undefined;
    const root = display.screen[0]?.root;
    if (root === undefined) return undefined;
    for (const event of messageEvents(removeMessage(id), window, { begin, more })) {
      X.SendEvent(root, false, PROPERTY_CHANGE_MASK, event);
    }
    // close() flushes what was queued before it hangs up.
    await new Promise<void>((resolve) => X.close(() => resolve()));
    display = undefined;
    return id;
  })();
  const timeout = new Promise<undefined>((resolve) =>
    setTimeout(() => resolve(undefined), TIMEOUT_MS),
  );
  try {
    return await Promise.race([work, timeout]);
  } catch (error) {
    console.error(`Could not end the startup sequence: ${String(error)}`);
    return undefined;
  } finally {
    display?.client.terminate();
  }
}
