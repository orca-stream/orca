import * as z from "zod";

/** archive.org returns most fields as a string or an array of strings, and numbers as strings. */
const stringList = z
  .union([z.string(), z.array(z.union([z.string(), z.number()]))])
  .nullish()
  .transform((value): string[] => {
    if (value === null || value === undefined) return [];
    return (Array.isArray(value) ? value : [value]).map(String);
  });

const numeric = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value): number | undefined => {
    if (value === null || value === undefined || value === "") return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  });

const text = z
  .union([z.string(), z.array(z.string())])
  .nullish()
  .transform((value): string | undefined => {
    const first = Array.isArray(value) ? value[0] : value;
    return first === null || first === undefined || first.trim() === "" ? undefined : first;
  });

const file = z.object({
  name: z.string(),
  source: text,
  format: text,
  original: text,
  length: numeric,
  size: numeric,
  height: numeric,
  md5: text,
  title: text,
});

const metadata = z.object({
  identifier: z.string(),
  title: text,
  mediatype: text,
  description: stringList,
  date: text,
  year: stringList,
  licenseurl: text,
  subject: stringList,
});

export const itemSchema = z.object({
  metadata,
  files: z.array(file).default([]),
  is_collection: z.union([z.boolean(), z.string()]).nullish(),
  item_last_updated: numeric,
});

const scrapeItem = z.object({
  identifier: z.string(),
  title: text,
  description: stringList,
  date: text,
  year: stringList,
  licenseurl: text,
  addeddate: text,
});

export const scrapeSchema = z.object({
  items: z.array(scrapeItem).default([]),
  total: numeric,
  cursor: text,
});

export type IaFile = z.infer<typeof file>;
export type IaItem = z.infer<typeof itemSchema>;
export type IaScrapeItem = z.infer<typeof scrapeItem>;
export type IaScrapePage = z.infer<typeof scrapeSchema>;

export function isCollection(item: IaItem): boolean {
  return (
    item.metadata.mediatype === "collection" ||
    item.is_collection === true ||
    item.is_collection === "true"
  );
}
