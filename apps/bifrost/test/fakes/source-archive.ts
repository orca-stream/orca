import type { SourceArchive, SourceTarball } from "../../src/application/ports/source-archive.ts";

export const COMMIT = "0123456789abcdef0123456789abcdef01234567";

export class FakeSourceArchive implements SourceArchive {
  resolved: string[] = [];
  archived: string[] = [];
  disposed = 0;
  async resolve(ref: string) {
    this.resolved.push(ref);
    return COMMIT;
  }
  async archive(commit: string): Promise<SourceTarball> {
    this.archived.push(commit);
    return {
      path: "/tmp/fake-src.tar",
      dispose: async () => {
        this.disposed++;
      },
    };
  }
}
