import * as z from "zod";
import { JobDto, ProgressDetail } from "./jobs.ts";

export const HmEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("job.updated"), seq: z.number().int(), job: JobDto }),
  z.object({
    type: z.literal("job.progress"),
    seq: z.number().int(),
    jobId: z.string(),
    progress: z.number().nullable(),
    detail: ProgressDetail.nullable(),
  }),
  z.object({ type: z.literal("series.updated"), seq: z.number().int(), seriesId: z.string() }),
]);
export type HmEvent = z.infer<typeof HmEvent>;
