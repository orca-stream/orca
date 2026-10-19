/** The part of `ffprobe -show_streams -of json` that stream selection reads. */
export interface ProbeStream {
  index: number;
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  bit_rate?: string;
  disposition?: Record<string, number>;
  tags?: Record<string, string>;
}

export interface ProbeProgram {
  program_id?: number;
  streams?: ProbeStream[];
}

/** `ffprobe -show_programs -show_streams -of json`. HLS lists one program per rendition. */
export interface ProbeResult {
  programs?: ProbeProgram[];
  streams: ProbeStream[];
}

export interface SelectionPrefs {
  /** Largest video height to take. Absent: the tallest rendition. */
  maxHeight?: number;
  /** Audio languages to keep, as ffprobe reports them. Absent: every track. */
  audioLangs?: readonly string[];
  /** Subtitle languages to keep. Absent: every text track; empty: none. */
  subtitleLangs?: readonly string[];
  /** Language of the original audio, when known. It goes first. */
  originalLanguage?: string;
}

export type Container = "mkv" | "mp4";

export interface StreamSelection {
  video: ProbeStream;
  /** Original language first. */
  audio: ProbeStream[];
  /** Text subtitles only. */
  subtitles: ProbeStream[];
  /** `-map` arguments for input 0, video then audio then subtitles. */
  maps: string[];
  /** Per-subtitle `-c:s:N` arguments for the output. Empty when there are no subtitles. */
  subtitleArgs: string[];
  container: Container;
  warnings: string[];
}

export class MediaProbeError extends Error {
  readonly reason: "spawn" | "exit" | "parse" | "timeout" | "aborted" | "invalid" | "no-video";

  constructor(reason: MediaProbeError["reason"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MediaProbeError";
    this.reason = reason;
  }

  /** hm-server maps `true` to its RetryableError, `false` to PermanentError / AbortedError. */
  get retryable(): boolean {
    return this.reason === "spawn" || this.reason === "exit" || this.reason === "timeout";
  }
}
