import { readFileSync } from "node:fs";
import { ExtractorError, type HttpClient } from "@orca/extractor-core";

export function fixture<T = Record<string, any>>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as T;
}

const SCRAPE = "https://archive.org/services/search/v1/scrape";
const FIELDS = "identifier,title,description,date,year,licenseurl,addeddate";

export const metadataUrl = (id: string) => `https://archive.org/metadata/${id}`;
export const scrapeUrl = (collection: string, cursor?: string) =>
  `${SCRAPE}?q=collection%3A${collection}&fields=${FIELDS}&count=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;

/** The cheap probe a follow check makes: the newest additions first, only what the marker needs. */
export const latestUrl = (collection: string) =>
  `${SCRAPE}?q=collection%3A${collection}&fields=identifier,addeddate&count=100&sorts=addeddate%20desc`;

/** An HttpClient that answers from a URL → JSON map and remembers what was asked, in order. */
export function fakeHttp(answers: Record<string, unknown>) {
  const requests: string[] = [];
  const http: HttpClient = {
    getJson(url) {
      requests.push(url);
      if (!(url in answers)) {
        return Promise.reject(new ExtractorError("not-found", `No fixture for ${url}`));
      }
      return Promise.resolve(structuredClone(answers[url]));
    },
  };
  return { http, requests };
}

/** The One Step Beyond collection: two scrape pages, five episode items. */
export function oneStepBeyond(): Record<string, unknown> {
  const ids = [
    "S1E10THEVISION",
    "S1E13THENAVIGATOR",
    "S1E16THEBURNINGGIRL_201804",
    "S1E1THEBRIDEPOSSESSED",
    "S2E13FATHERIMAGE",
  ];
  return {
    [metadataUrl("onestepbeyondcomplete")]: fixture("onestepbeyondcomplete.metadata"),
    [scrapeUrl("onestepbeyondcomplete")]: fixture("onestepbeyondcomplete.scrape"),
    [scrapeUrl("onestepbeyondcomplete", "CURSOR-PAGE-2")]: fixture("onestepbeyondcomplete.scrape2"),
    [latestUrl("onestepbeyondcomplete")]: fixture("onestepbeyondcomplete.latest"),
    ...Object.fromEntries(ids.map((id) => [metadataUrl(id), fixture(`${id}.metadata`)])),
  };
}
