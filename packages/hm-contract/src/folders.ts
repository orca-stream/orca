import { z } from "zod";

/** Which folder of the server's disk to list: its home folder when left out. */
export const FolderQuery = z.object({
  path: z.string().min(1).max(4096).optional(),
});
export type FolderQuery = z.infer<typeof FolderQuery>;

/** One folder of the server's disk and the folders right inside it (never files). */
export const FolderListing = z.object({
  /** Absolute. */
  path: z.string(),
  /** The folder it sits in; null at the top of the disk. */
  parent: z.string().nullable(),
  folders: z.array(z.object({ name: z.string(), path: z.string() })),
});
export type FolderListing = z.infer<typeof FolderListing>;
