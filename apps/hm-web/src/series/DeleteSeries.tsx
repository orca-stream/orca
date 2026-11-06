import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import type { SeriesDto } from "@orca/hm-contract";
import { keys } from "@/api/keys";
import { useMutations } from "@/api/mutations";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { SwitchField } from "@/components/switch-field";
import { useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import { BAR_POPUP } from "./bar";

/**
 * The trash over the series' banner. Clicked, it asks in a glass card under it, with a switch for
 * its files (off: they stay for Jellyfin). Once deleted, back to the list.
 */
export function DeleteSeries({ series, className }: { series: SeriesDto; className: string }) {
  const t = useT();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { deleteSeries } = useMutations();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState(false);
  const pending = deleteSeries.isPending;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) {
          setFiles(false);
          deleteSeries.reset();
        }
      }}
    >
      <PopoverTrigger
        aria-label={t.series.deleteSeries}
        title={t.series.deleteSeries}
        className={cn(
          className,
          "hover:bg-destructive hover:text-white data-popup-open:bg-destructive data-popup-open:text-white",
        )}
      >
        <HugeiconsIcon icon={Delete02Icon} className="size-5" />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        className={cn(BAR_POPUP, "w-[min(22rem,var(--available-width))] gap-4 p-4")}
      >
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t.series.deleteSeriesTitle(series.title)}</p>
          <p className="text-sm text-muted-foreground">{t.series.deleteSeriesHint}</p>
        </div>
        <div className="flex flex-col gap-1">
          <SwitchField
            checked={files}
            onCheckedChange={setFiles}
            label={t.series.deleteSeriesFiles}
            disabled={pending}
          />
          <p className={cn("text-sm", files ? "text-destructive" : "text-muted-foreground")}>
            {files ? t.series.deleteSeriesFilesOn : t.series.deleteSeriesFilesOff}
          </p>
        </div>
        {deleteSeries.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t.series.deleteSeriesFailed}
          </p>
        )}
        {/* Sibling buttons, 8px apart. */}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => setOpen(false)}
            className="h-10 rounded-full px-4 text-sm font-medium transition-colors hover:bg-white/70 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={() =>
              deleteSeries.mutate(
                { seriesId: series.id, files },
                {
                  onSuccess: () => {
                    navigate("/series");
                    // Off its screen now, so nothing refetches what is gone.
                    queryClient.removeQueries({ queryKey: keys.seriesDetail(series.id) });
                    queryClient.removeQueries({ queryKey: keys.episodes(series.id) });
                  },
                },
              )
            }
            className="relative flex h-10 items-center justify-center gap-2 rounded-full bg-destructive px-4 text-sm font-medium text-white transition-colors hover:bg-destructive/85 focus-visible:ring-3 focus-visible:ring-destructive/40 focus-visible:outline-none disabled:pointer-events-none"
          >
            <span className={cn("inline-flex items-center gap-2", pending && "invisible")}>
              <HugeiconsIcon icon={Delete02Icon} className="size-4" />
              {t.series.deleteSeriesConfirm}
            </span>
            {pending && <Spinner aria-hidden="true" className="absolute size-4" />}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
