import { useT } from "@/i18n/locale";
import { ErrorsPanel } from "./ErrorsPanel";
import { HistoryPanel } from "./HistoryPanel";
import { QueuePanel } from "./QueuePanel";

export function DashboardScreen() {
  const t = useT();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10">
      <h1 className="text-2xl font-semibold">{t.dashboard.title}</h1>
      <QueuePanel />
      <ErrorsPanel />
      <HistoryPanel />
    </div>
  );
}
