export interface SourceTarball {
  /** Local path of the tar file. */
  path: string;
  dispose(): Promise<void>;
}

/** The checkout this program ships from: resolves a ref to a commit and packs that commit's files. */
export interface SourceArchive {
  /** The full commit id `ref` points at. */
  resolve(ref: string): Promise<string>;
  /** A tarball of the commit's tracked files (no working-tree changes, no untracked files). */
  archive(commit: string): Promise<SourceTarball>;
}
