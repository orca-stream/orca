import { useT } from "../i18n/locale";
import { EmptyState } from "../ui";

/** Stands in for a screen that has no content yet. */
export function Placeholder({ title }: { title: string }) {
  const t = useT();
  return (
    <section>
      <h1 className="mb-6 text-2xl font-semibold">{title}</h1>
      <EmptyState title={t.common.noData} />
    </section>
  );
}
