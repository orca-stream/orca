import type { ExtractorDto } from "@orca/hm-contract";

/**
 * Where an extractor's card and its dock shortcut send you: the add screen with it in mind. Its
 * example shows as a hint, never as a value to erase first (and an explicit extractor comes chosen).
 */
export function extractorHref(extractor: ExtractorDto) {
  return `/series/new?extractor=${encodeURIComponent(extractor.id)}`;
}
