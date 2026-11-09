import { MIN_SITE_SEARCH_LENGTH } from "@orca/hm-contract/rules";

/** Whether `text` in the address is a name to search the sites by, long enough to ask them. */
export function isSiteSearch(text: string): boolean {
  return text.trim().length >= MIN_SITE_SEARCH_LENGTH;
}

/** The pages to offer: the first, the last, and the ones around `page`; null where some are left out. */
export function pagesAround(page: number, count: number): (number | null)[] {
  const shown = [...new Set([0, page - 1, page, page + 1, count - 1])]
    .filter((index) => index >= 0 && index < count)
    .toSorted((a, b) => a - b);
  return shown.flatMap((index, at) =>
    at > 0 && index - shown[at - 1]! > 1 ? [null, index] : [index],
  );
}

/** A site's word for a result, as people read it (`TV_SHORT` → `TV SHORT`); none for a code word. */
export function readableLabel(label: string | null): string | null {
  if (label === null || /^[a-z_]+$/.test(label)) return null;
  return label.replace(/_/g, " ");
}
