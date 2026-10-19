import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useApi } from "../api/context";
import { queries } from "../api/queries";
import { useT } from "../i18n/locale";
import { EmptyState, Spinner, Table, TBody, Td, Th, THead, Tr } from "../ui";

export function ExtractorsScreen() {
  const t = useT();
  const api = useApi();
  const extractors = useQuery(queries.extractors(api));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.extractors.title}</h1>
        <p className="mt-1 text-sm text-white/60">{t.extractors.subtitle}</p>
      </div>
      {extractors.isPending && <Spinner className="size-6" />}
      {extractors.isError && (
        <p role="alert" className="text-sm text-amber-300">
          {t.dashboard.loadFailed}
        </p>
      )}
      {extractors.isSuccess && extractors.data.length === 0 && (
        <EmptyState title={t.extractors.empty} />
      )}
      {extractors.isSuccess && extractors.data.length > 0 && (
        <Table>
          <THead>
            <Tr>
              <Th>{t.extractors.name}</Th>
              <Th>{t.extractors.hosts}</Th>
              <Th>{t.extractors.example}</Th>
              <Th>
                <span className="sr-only">{t.extractors.tryIt}</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {extractors.data.map((extractor) => (
              <Tr key={extractor.id}>
                <Td className="font-medium">{extractor.name}</Td>
                <Td className="text-white/70">{extractor.hosts.join(", ")}</Td>
                <Td className="max-w-xs truncate text-white/60">{extractor.example}</Td>
                <Td className="text-right">
                  <Link
                    href={`/series/new?url=${encodeURIComponent(extractor.example)}`}
                    className="inline-flex h-9 items-center rounded-md bg-surface-raised px-3 text-sm hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
                  >
                    {t.extractors.tryIt}
                  </Link>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
