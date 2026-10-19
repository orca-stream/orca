import {
  ExtractorError,
  type ExtractedEpisode,
  type Extraction,
  type SiteExtractor,
} from "@orca/extractor-core";

export const FAKE_URL = "https://fake.example/show";

export function fakeEpisode(
  episode: number,
  overrides: Partial<ExtractedEpisode> = {},
): ExtractedEpisode {
  return {
    season: 1,
    episode,
    title: `Fake episode ${episode}`,
    inferred: false,
    sourceRef: `show/e${episode}.mp4`,
    media: {
      kind: "direct",
      url: `https://fake.example/files/e${episode}.mp4`,
      fileName: `e${episode}.mp4`,
      sizeBytes: 1000,
      durationSec: 1500,
      format: "MPEG4",
    },
    ...overrides,
  };
}

/** A site whose series changes when a test says so; counts how often it was asked for what. */
export class FakeExtractor implements SiteExtractor {
  readonly id = "fake";
  readonly name = "Fake";
  readonly hosts = ["fake.example"];
  readonly example = FAKE_URL;

  marker = "m1";
  episodes: ExtractedEpisode[] = [fakeEpisode(1), fakeEpisode(2)];
  failMarker: Error | null = null;
  failExtract: Error | null = null;
  extractCalls = 0;
  markerCalls = 0;
  remoteMarker: SiteExtractor["remoteMarker"] = async () => {
    this.markerCalls++;
    if (this.failMarker) throw this.failMarker;
    return this.marker;
  };

  canHandle(url: string): boolean {
    return url.startsWith("https://fake.example/");
  }

  /** Behaves like an extractor that has no cheap marker. */
  withoutMarker(): this {
    delete this.remoteMarker;
    return this;
  }

  async extract(): Promise<Extraction> {
    this.extractCalls++;
    if (this.failExtract) throw this.failExtract;
    const seasons = [...new Set(this.episodes.map((episode) => episode.season))].map((number) => ({
      number,
      episodeCount: this.episodes.filter((episode) => episode.season === number).length,
    }));
    return {
      series: {
        externalId: "show",
        sourceUrl: FAKE_URL,
        title: "Fake Show",
        year: 1960,
        remoteMarker: this.marker,
      },
      seasons,
      episodes: structuredClone(this.episodes),
      license: { kind: "public-domain", requiresAck: false },
      warnings: [],
    };
  }
}

export const networkError = () => new ExtractorError("network", "fake.example is down");
