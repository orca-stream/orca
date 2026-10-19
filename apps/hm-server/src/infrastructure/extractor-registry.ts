import type { SiteExtractor } from "@orca/extractor-core";
import type { ExtractorRegistry } from "../application/ports.ts";

export class StaticExtractorRegistry implements ExtractorRegistry {
  private readonly extractors: SiteExtractor[];

  constructor(extractors: SiteExtractor[]) {
    this.extractors = extractors;
  }

  list(): SiteExtractor[] {
    return this.extractors;
  }

  get(id: string): SiteExtractor | null {
    return this.extractors.find((extractor) => extractor.id === id) ?? null;
  }

  find(url: string): SiteExtractor | null {
    return this.extractors.find((extractor) => extractor.canHandle(url)) ?? null;
  }
}
