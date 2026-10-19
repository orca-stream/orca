/**
 * Parses `ffmpeg -progress pipe:1`: blocks of `key=value` lines, each ending in `progress=continue`
 * or `progress=end`. Output arrives in arbitrary chunks, so it is buffered by line.
 */
export function createProgressParser(onBlock: (block: Record<string, string>) => void) {
  let buffer = "";
  let block: Record<string, string> = {};
  return {
    push(chunk: string): void {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        const equals = line.indexOf("=");
        if (equals <= 0) continue;
        const key = line.slice(0, equals);
        block[key] = line.slice(equals + 1).trim();
        if (key === "progress") {
          const done = block;
          block = {};
          onBlock(done);
        }
      }
    },
  };
}

/**
 * Where ffmpeg is in the output, in seconds. `out_time_ms` is a misnomer: it is microseconds too, so
 * `out_time_us` is the one to read. `N/A` (before the first frame) and the huge negative ffmpeg
 * prints for "unknown" give nothing.
 */
export function outTimeSeconds(block: Record<string, string>): number | undefined {
  const microseconds = Number(block.out_time_us);
  return Number.isFinite(microseconds) && microseconds >= 0 ? microseconds / 1_000_000 : undefined;
}
