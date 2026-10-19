import * as z from "zod";

export const ExtractorDto = z.object({
  id: z.string(),
  name: z.string(),
  hosts: z.array(z.string()),
  example: z.string(),
  /** Never matched from an address: the panel offers it as a choice. */
  explicit: z.boolean(),
});
export type ExtractorDto = z.infer<typeof ExtractorDto>;
