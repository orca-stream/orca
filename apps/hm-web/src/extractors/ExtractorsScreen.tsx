import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useApi } from "@/api/context";
import { queries } from "@/api/queries";
import { EmptyState } from "@/components/empty-state";
import { Loading } from "@/components/loading";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useT } from "@/i18n/locale";

export function ExtractorsScreen() {
  const t = useT();
  const api = useApi();
  const extractors = useQuery(queries.extractors(api));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.extractors.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.extractors.subtitle}</p>
      </div>
      {extractors.isPending && <Loading />}
      {extractors.isError && (
        <p role="alert" className="text-sm text-warning">
          {t.dashboard.loadFailed}
        </p>
      )}
      {extractors.isSuccess && extractors.data.length === 0 && (
        <EmptyState title={t.extractors.empty} />
      )}
      {extractors.isSuccess && extractors.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.extractors.name}</TableHead>
              <TableHead>{t.extractors.hosts}</TableHead>
              <TableHead>{t.extractors.example}</TableHead>
              <TableHead>
                <span className="sr-only">{t.extractors.tryIt}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {extractors.data.map((extractor) => (
              <TableRow key={extractor.id}>
                <TableCell className="font-medium">{extractor.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {extractor.explicit ? t.extractors.explicitOnly : extractor.hosts.join(", ")}
                </TableCell>
                <TableCell className="max-w-xs truncate text-muted-foreground">
                  {extractor.example}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/series/new?url=${encodeURIComponent(extractor.example)}${
                      extractor.explicit ? `&extractor=${encodeURIComponent(extractor.id)}` : ""
                    }`}
                    className={buttonVariants({ variant: "outline" })}
                  >
                    {t.extractors.tryIt}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
