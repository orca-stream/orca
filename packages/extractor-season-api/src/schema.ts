import * as z from "zod";

const text = z
  .string()
  .nullish()
  .transform((value) => (value?.trim() ? value.trim() : undefined));

const flag = z
  .boolean()
  .nullish()
  .transform((value) => value === true);

/** The API's answer for one season: its details and every episode it lists, with their players. */
export const SeasonData = z.object({
  title: text,
  nativeTitle: text,
  year: z.coerce.number().int().positive().nullish().catch(undefined),
  synopsis: text,
  poster: text,
  episodeList: z.array(
    z.object({
      number: z.coerce.number().int().min(0),
      title: text,
      // Unknown or zero means unknown: never a reason to refuse the season.
      runtimeSeconds: z.coerce.number().positive().nullish().catch(undefined),
      aired: text,
      available: z.object({ sub: flag, dub: flag }).partial().nullish(),
      embed: z.object({ sub: text, dub: text }).partial().nullish(),
    }),
  ),
});
export type SeasonData = z.infer<typeof SeasonData>;
