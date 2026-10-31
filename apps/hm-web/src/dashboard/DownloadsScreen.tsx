import { useT } from "@/i18n/locale";
import { ErrorsPanel } from "./ErrorsPanel";
import { HistoryPanel } from "./HistoryPanel";
import { QueuePanel } from "./QueuePanel";

/** The queue, what failed and what finished: everything the server has been downloading. */
export function DownloadsScreen() {
  const t = useT();
  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-2xl font-semibold">{t.dashboard.title}</h1>
      <QueuePanel />
      <ErrorsPanel />
      <HistoryPanel />
    </div>
  );
}
