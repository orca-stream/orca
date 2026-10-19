import * as z from "zod";

export const ExtractorDto = z.object({
  id: z.string(),
  name: z.string(),
  hosts: z.array(z.string()),
  example: z.string(),
});
export type ExtractorDto = z.infer<typeof ExtractorDto>;
