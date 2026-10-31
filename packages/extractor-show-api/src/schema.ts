import * as z from "zod";

/** Every answer comes wrapped like this; `error: true` is the site saying no. */
export const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ error: z.boolean().optional(), message: z.string().nullish(), data });

const id = z.union([z.number().int(), z.string().regex(/^\d+$/)]).transform(Number);
const text = z
  .string()
  .nullish()
  .transform((value) => (value?.trim() ? value.trim() : undefined));

export const ShowData = z.object({
  _id: id,
  slug: z.string(),
  title: text,
  original_title: text,
  overview: text,
  release_date: text,
  images: z.object({ poster: text }).partial().nullish(),
});

export const EpisodeListData = z.object({
  posts: z.array(
    z.object({
      _id: id,
      title: text,
      overview: text,
      season_number: z.coerce.number().int().min(0),
      episode_number: z.coerce.number().int().min(0),
    }),
  ),
  seasons: z.array(z.union([z.string(), z.number()]).transform(String)),
  pagination: z.object({ total: z.coerce.number().int().min(0) }),
});
export type EpisodeListData = z.infer<typeof EpisodeListData>;

export const PlayerData = z.object({
  embeds: z.array(z.object({ url: z.string(), lang: text, server: text, quality: text })),
});
