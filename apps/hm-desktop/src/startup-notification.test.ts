import { describe, expect, it } from "vite-plus/test";
import { messageEvents, quoteValue, removeMessage } from "./startup-notification.ts";

describe("startup notification messages", () => {
  it("quotes only the values that need it", () => {
    expect(quoteValue("gnome-shell/orca-hm/123-0-host_TIME42")).toBe(
      "gnome-shell/orca-hm/123-0-host_TIME42",
    );
    expect(quoteValue(`Orca H&M "x" \\ y`)).toBe(`"Orca H&M \\"x\\" \\\\ y"`);
    expect(removeMessage("a b")).toBe(`remove: ID="a b"`);
  });

  it("splits the message and its NUL into 20-byte ClientMessages, BEGIN first", () => {
    const message = "remove: ID=gnome-shell/orca-hm/1-0-host_TIME9";
    const events = messageEvents(message, 0x0a00003, { begin: 501, more: 502 });
    // 46 bytes and the NUL: three events.
    expect(events).toHaveLength(3);
    for (const [i, event] of events.entries()) {
      expect(event).toHaveLength(32);
      expect(event[0]).toBe(33); // ClientMessage
      expect(event[1]).toBe(8); // format
      expect(event.readUInt32LE(4)).toBe(0x0a00003);
      expect(event.readUInt32LE(8)).toBe(i === 0 ? 501 : 502);
    }
    const data = Buffer.concat(events.map((event) => event.subarray(12, 32)));
    expect(data.subarray(0, message.length + 1).toString("utf8")).toBe(`${message}\0`);
  });
});
