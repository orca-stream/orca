import {
  ExtractorError,
  LATEST_SAFE_YEAR,
  type ExtractedEpisode,
  type ExtractedLicense,
  type Extraction,
  type ExtractionWarning,
  type HttpClient,
  type SiteExtractor,
} from "@orca/extractor-core";
import { titleFromFileName, titleFromText } from "./episode-number.ts";
import { videoGroups, type VideoGroup } from "./files.ts";
import { classifyLicense } from "./license.ts";
import { numberEpisodes, type NumberEntry } from "./numbering.ts";
import {
  isCollection,
  itemSchema,
  scrapeSchema,
  type IaItem,
  type IaScrapeItem,
} from "./schema.ts";
import { cleanSeriesTitle, firstYear, stripHtml, tidyUppercase } from "./text.ts";
import { canHandleUrl, parseIaUrl } from "./url.ts";

const SCRAPE_FIELDS = "identifier,title,description,date,year,licenseurl,addeddate";
const LATEST_FIELDS = "identifier,addeddate";
const MAX_SCRAPE_PAGES = 100;
/// A video this many times longer than the typical episode is several episodes in one file.
const COMPILATION_FACTOR = 3;

export interface InternetArchiveOptions {
  http: HttpClient;
}

/** One episode candidate found in an item, before it gets a season and an episode number. */
interface Found {
  sourceRef: string;
  itemId: string;
  group: VideoGroup;
  texts: string[];
  title: string;
  plot?: string;
  airDate?: string;
}

export function createInternetArchiveExtractor({ http }: InternetArchiveOptions): SiteExtractor {
  async function loadItem(id: string, signal?: AbortSignal): Promise<IaItem> {
    const raw = await http.getJson(`https://archive.org/metadata/${encodeURIComponent(id)}`, {
      ...(signal ? { signal } : {}),
    });
    if (typeof raw === "object" && raw !== null && Object.keys(raw).length === 0) {
      throw new ExtractorError("not-found", `archive.org has nothing under “${id}”`);
    }
    const parsed = itemSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ExtractorError(
        "invalid-response",
        `Unexpected answer for “${id}” from archive.org`,
        {
          cause: parsed.error,
        },
      );
    }
    return parsed.data;
  }

  async function listCollection(id: string, signal?: AbortSignal) {
    const items: IaScrapeItem[] = [];
    let total: number | undefined;
    let cursor: string | undefined;
    for (let page = 0; page < MAX_SCRAPE_PAGES; page++) {
      const query =
        `q=collection%3A${encodeURIComponent(id)}&fields=${SCRAPE_FIELDS}&count=100` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
      const raw = await http.getJson(`https://archive.org/services/search/v1/scrape?${query}`, {
        ...(signal ? { signal } : {}),
      });
      const parsed = scrapeSchema.safeParse(raw);
      if (!parsed.success) {
        throw new ExtractorError(
          "invalid-response",
          `Unexpected listing of “${id}” from archive.org`,
          {
            cause: parsed.error,
          },
        );
      }
      items.push(...parsed.data.items);
      total ??= parsed.data.total;
      cursor = parsed.data.cursor;
      if (!cursor) break;
    }
    return { items, total: total ?? items.length };
  }

  /** The count of a collection plus the newest `addeddate`: an item added or removed changes it. */
  const collectionMarker = (total: number, newest: string | undefined) =>
    `${total}:${newest ?? ""}`;

  const newestOf = (dates: (string | undefined)[]) =>
    dates
      .filter((date): date is string => Boolean(date))
      .sort()
      .at(-1);

  async function remoteMarker(input: string, options?: { signal?: AbortSignal }): Promise<string> {
    const target = parseIaUrl(input);
    const signal = options?.signal;
    const root = await loadItem(target.id, signal);
    if (!isCollection(root)) {
      return root.item_last_updated === undefined
        ? `files:${root.files.length}`
        : String(root.item_last_updated);
    }
    const raw = await http.getJson(
      `https://archive.org/services/search/v1/scrape?q=collection%3A${encodeURIComponent(target.id)}` +
        `&fields=${LATEST_FIELDS}&count=100&sorts=addeddate%20desc`,
      { ...(signal ? { signal } : {}) },
    );
    const parsed = scrapeSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ExtractorError(
        "invalid-response",
        `Unexpected listing of “${target.id}” from archive.org`,
        { cause: parsed.error },
      );
    }
    return collectionMarker(
      parsed.data.total ?? parsed.data.items.length,
      newestOf(parsed.data.items.map((item) => item.addeddate)),
    );
  }

  async function extract(input: string, options?: { signal?: AbortSignal }): Promise<Extraction> {
    const target = parseIaUrl(input);
    const signal = options?.signal;
    const root = await loadItem(target.id, signal);
    const warnings: ExtractionWarning[] = [];
    const found: Found[] = [];

    const description = stripHtml(root.metadata.description.join("\n\n"));
    const sourceUrl = `https://archive.org/details/${target.id}`;
    let licenseUrl = root.metadata.licenseurl;
    let remoteMarker: string | undefined;
    let seriesTitle = cleanSeriesTitle(root.metadata.title ?? target.id);
    let year = firstYear(root.metadata.year, root.metadata.date);

    if (isCollection(root)) {
      const { items, total } = await listCollection(target.id, signal);
      remoteMarker = collectionMarker(total, newestOf(items.map((item) => item.addeddate)));
      licenseUrl ??= mostCommon(items.map((item) => item.licenseurl));
      for (const scraped of items) {
        let item: IaItem;
        try {
          item = await loadItem(scraped.identifier, signal);
        } catch (error) {
          if (error instanceof ExtractorError && error.code === "not-found") {
            warnings.push({
              code: "no-video",
              message: `“${scraped.identifier}” could not be read and was skipped`,
            });
            continue;
          }
          throw error;
        }
        const groups = videoGroups(item.files);
        const [group, ...others] = [...groups].sort(
          (a, b) => (b.durationSec ?? 0) - (a.durationSec ?? 0),
        );
        if (!group) {
          warnings.push({
            code: "no-video",
            message: `“${scraped.identifier}” has no video and was skipped`,
          });
          continue;
        }
        const sourceRef = `${scraped.identifier}/${group.best.name}`;
        if (others.length > 0) {
          warnings.push({
            code: "multiple-videos",
            message: `“${scraped.identifier}” has several videos: the longest was used`,
            sourceRefs: [sourceRef],
          });
        }
        const itemTitle = item.metadata.title ?? scraped.title ?? scraped.identifier;
        const date = item.metadata.date ?? scraped.date;
        const plot =
          stripHtml(item.metadata.description.join("\n\n")) ??
          stripHtml(scraped.description.join("\n\n"));
        found.push({
          sourceRef,
          itemId: scraped.identifier,
          group,
          texts: [
            group.key,
            group.best.name,
            group.best.title,
            itemTitle,
            scraped.identifier,
          ].filter((text): text is string => Boolean(text)),
          title: episodeTitle(itemTitle, seriesTitle, group),
          ...(plot ? { plot } : {}),
          ...(date && /^\d{4}-\d{2}-\d{2}/.test(date) ? { airDate: date.slice(0, 10) } : {}),
        });
      }
    } else {
      remoteMarker =
        root.item_last_updated === undefined
          ? `files:${root.files.length}`
          : String(root.item_last_updated);
      for (const group of [...videoGroups(root.files)].sort((a, b) =>
        a.key.localeCompare(b.key, "en", { numeric: true, sensitivity: "base" }),
      )) {
        const original = group.candidates.find((file) => file.name === group.key);
        const fileTitle = original?.title ?? group.best.title;
        found.push({
          sourceRef: `${target.id}/${group.best.name}`,
          itemId: target.id,
          group,
          texts: [group.key, group.best.name, fileTitle].filter((text): text is string =>
            Boolean(text),
          ),
          title: tidyUppercase(
            (fileTitle ? titleFromText(fileTitle) : "") || titleFromFileName(group.key),
          ),
        });
      }
    }

    if (found.length === 0) {
      throw new ExtractorError("no-episodes", `No video files found in “${target.id}”`);
    }

    const entries: NumberEntry[] = found.map((f) => ({ key: f.sourceRef, texts: f.texts }));
    const numbering = numberEpisodes(entries);
    warnings.push(...numbering.warnings);

    const byRef = new Map(found.map((f) => [f.sourceRef, f]));
    const episodes: ExtractedEpisode[] = numbering.numbers.map((number) => {
      const f = byRef.get(number.key) as Found;
      const file = f.group.best;
      return {
        season: number.season,
        episode: number.episode,
        title: f.title || `Episode ${number.episode}`,
        ...(f.plot ? { plot: f.plot } : {}),
        ...(f.airDate ? { airDate: f.airDate } : {}),
        inferred: number.inferred,
        sourceRef: f.sourceRef,
        media: {
          kind: "direct",
          url: downloadUrl(f.itemId, file.name),
          fileName: file.name,
          ...(file.size !== undefined ? { sizeBytes: file.size } : {}),
          ...(file.md5 ? { md5: file.md5 } : {}),
          ...(f.group.durationSec !== undefined ? { durationSec: f.group.durationSec } : {}),
          ...(file.format ? { format: file.format } : {}),
          ...(file.height ? { height: file.height } : {}),
        },
      };
    });

    warnings.push(...compilations(found));

    const license = licenseFor(licenseUrl, year, warnings);
    if (year === undefined) {
      warnings.push({
        code: "year-missing",
        message: "No year in the item: fill it in before adding, it names the folder",
      });
    }

    const selected = target.file
      ? found.find((f) => f.group.candidates.some((file) => file.name === target.file))
      : undefined;

    seriesTitle = seriesTitle.trim();
    const seasons = [...new Set(episodes.map((e) => e.season))].map((number) => ({
      number,
      episodeCount: episodes.filter((e) => e.season === number).length,
    }));
    return {
      series: {
        externalId: target.id,
        sourceUrl,
        title: seriesTitle,
        ...(year !== undefined ? { year } : {}),
        ...(description ? { plot: description } : {}),
        posterUrl: `https://archive.org/services/img/${encodeURIComponent(target.id)}`,
        ...(remoteMarker ? { remoteMarker } : {}),
      },
      seasons,
      episodes,
      license,
      warnings,
      ...(selected ? { selectedSourceRef: selected.sourceRef } : {}),
    };
  }

  return {
    id: "internet-archive",
    name: "Internet Archive",
    hosts: ["archive.org"],
    example: "https://archive.org/details/bevhill-s01e01-36",
    // archive.org asks API clients to stay polite: one request a second, one file at a time.
    limits: { metadataPerSec: 1, downloadsPerHost: 1, connectionsPerDownload: 1 },
    canHandle: canHandleUrl,
    extract,
    remoteMarker,
  };
}

function downloadUrl(itemId: string, fileName: string): string {
  const path = fileName.split("/").map(encodeURIComponent).join("/");
  return `https://archive.org/download/${encodeURIComponent(itemId)}/${path}`;
}

/** The text after the code in the item title; the file name when the title has no code. */
function episodeTitle(itemTitle: string, seriesTitle: string, group: VideoGroup): string {
  let title = titleFromText(itemTitle);
  if (title.toLowerCase().startsWith(seriesTitle.toLowerCase())) {
    title = title.slice(seriesTitle.length).replace(/^[\s:._-]+/, "");
  }
  return tidyUppercase(title || titleFromFileName(group.key));
}

function mostCommon(values: (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function compilations(found: Found[]): ExtractionWarning[] {
  const lengths = found
    .map((f) => f.group.durationSec)
    .filter((length): length is number => length !== undefined)
    .sort((a, b) => a - b);
  if (lengths.length < 3) return [];
  const median = lengths[Math.floor(lengths.length / 2)] as number;
  return found
    .filter((f) => (f.group.durationSec ?? 0) > median * COMPILATION_FACTOR)
    .map((f) => ({
      code: "compilation" as const,
      message: `“${f.group.best.name}” runs ${Math.round((f.group.durationSec ?? 0) / 60)} minutes: it looks like several episodes in one file, which is not split`,
      sourceRefs: [f.sourceRef],
    }));
}

function licenseFor(
  url: string | undefined,
  year: number | undefined,
  warnings: ExtractionWarning[],
): ExtractedLicense {
  const { kind, url: classified } = classifyLicense(url);
  if (kind === "unknown") {
    warnings.push({
      code: "license-unknown",
      message: "The license is missing or not recognized",
    });
  } else if (year !== undefined && year > LATEST_SAFE_YEAR) {
    warnings.push({
      code: "license-recent",
      message: `Tagged ${kind}, but the show dates from ${year}: uploaders sometimes get this wrong`,
    });
  }
  return { kind, ...(classified ? { url: classified } : {}) };
}
