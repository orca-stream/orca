import type { ExtractorDto, SeriesDto, ShowLookupDto } from "@orca/hm-contract";
import { Collapsible } from "@base-ui/react/collapsible";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Alert02Icon,
  ArrowDown01Icon,
  Link01Icon,
  SquareLock02Icon,
  SquareUnlock02Icon,
} from "@hugeicons/core-free-icons";
import { Link } from "wouter";
import { useApi } from "@/api/context";
import { useMutations } from "@/api/mutations";
import { queries } from "@/api/queries";
import { Spinner } from "@/components/ui/spinner";
import { ExtractorMark } from "@/extractors/ExtractorMark";
import { useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import { addSourceHref } from "./add-source";
import { finishedStatus } from "./airing";
import { sortBySpan, sourceSpans, type SourceSpan } from "./source-spans";
import { numberRanges } from "./tmdb-match";

type Source = SeriesDto["sources"][number];

/** The round icon buttons at the end of a row, the size of the bar's own. */
const ROUND_BUTTON =
  "flex size-10 shrink-0 items-center justify-center rounded-full bg-white/70 ring-1 ring-black/5 transition-colors hover:bg-white focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

/** Rows one under the other, with the bar's hairline between them. */
const ROWS = "[&>*+*]:border-t [&>*+*]:border-t-(--glass-edge)";

/** A row of the bar: its mark, its two lines, and its buttons at the end, 8px apart as siblings. */
const ROW = "flex min-h-18 min-w-0 items-center gap-2 pr-4";

/**
 * The mark at the start of a row: a 40px circle, the size of the row's own buttons, 16px from the
 * panel's edge and 16px from the text (less the 6px the text brings).
 */
function RowMark({ children }: { children: React.ReactNode }) {
  return <span className="flex shrink-0 pr-2.5 pl-4">{children}</span>;
}

/** The mark of a row whose reader is unknown, or of the header that counts them: a plain link. */
function LinkMark() {
  return (
    <span className="flex size-10 items-center justify-center rounded-full bg-black/5 text-muted-foreground">
      <HugeiconsIcon icon={Link01Icon} className="size-5" aria-hidden="true" />
    </span>
  );
}

/** Close or reopen one source, right where it is listed: a padlock, always the last button. */
function CloseButton({
  seriesId,
  source,
  ended,
}: {
  seriesId: string;
  source: Source;
  /** The show won't air again: an open source is worth closing, so its padlock stands out. */
  ended: "ended" | "canceled" | null;
}) {
  const t = useT();
  const { patchSource } = useMutations();
  const pending = patchSource.isPending && patchSource.variables?.sourceId === source.id;
  const failed = patchSource.isError && patchSource.variables?.sourceId === source.id;
  const icon = source.closed ? SquareUnlock02Icon : SquareLock02Icon;
  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending || undefined}
      title={
        failed
          ? t.series.detail.sourceFailed
          : source.closed
            ? t.series.detail.reopenSourceHint
            : t.series.detail.closeSourceHint
      }
      aria-label={`${source.closed ? t.series.detail.reopenSource : t.series.detail.closeSource}: ${source.sourceUrl}`}
      onClick={() =>
        patchSource.mutate({
          seriesId,
          sourceId: source.id,
          patch: { closed: !source.closed },
        })
      }
      className={cn(
        ROUND_BUTTON,
        ended &&
          !source.closed &&
          "bg-amber-100 text-amber-900 ring-amber-500/40 hover:bg-amber-50",
        failed && "text-warning ring-warning/40",
      )}
    >
      {pending ? (
        <Spinner aria-hidden="true" />
      ) : (
        <HugeiconsIcon icon={icon} className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}

/**
 * One more address for this series: adding a series, with this one already chosen and, when the
 * site tells, the address of what comes next already written.
 */
function AddSourceButton({ href }: { href: string }) {
  const t = useT();
  return (
    <Link
      href={href}
      aria-label={t.series.detail.addSource}
      title={t.series.detail.addSourceHint}
      className={cn(
        ROUND_BUTTON,
        "bg-primary text-primary-foreground shadow-md shadow-primary/30 ring-0 hover:bg-primary/85",
      )}
    >
      <HugeiconsIcon icon={Add01Icon} className="size-5" aria-hidden="true" />
    </Link>
  );
}

/** An address of the series as a row of the bar: who reads it, where it is, how it is numbered. */
function SourceRow({
  seriesId,
  source,
  extractor,
  spans,
  ended,
  children,
}: {
  seriesId: string;
  source: Source;
  extractor: ExtractorDto | null;
  /** TMDB says the show won't air again: an open source is pointed out. */
  ended: "ended" | "canceled" | null;
  /** What it brought, a season at a time; empty before the episodes load or when it has none. */
  spans: SourceSpan[];
  /** More buttons, before the padlock that always ends the row. */
  children?: React.ReactNode;
}) {
  const t = useT();
  // Which season and which episodes it holds; until those are known, how it numbers them.
  const holds =
    spans.length > 0
      ? spans
          .map((span) =>
            t.series.detail.sourceSpan(span.season, span.from, span.to, numberRanges(span.gaps)),
          )
          .join(" · ")
      : t.series.sourceNumbering(source.season, source.episodeOffset);
  return (
    <div
      className={cn(
        ROW,
        "transition-colors has-[a.source:hover]:bg-white/30 has-[a.source:focus-visible]:bg-white/45",
      )}
    >
      <a
        href={source.sourceUrl}
        target="_blank"
        rel="noreferrer noopener"
        title={t.series.detail.openSource}
        className="source group/source flex min-w-0 flex-1 items-center self-stretch py-3 pr-2 focus-visible:outline-none"
      >
        <RowMark>
          {extractor ? (
            <ExtractorMark
              extractor={extractor}
              className={cn("size-10 rounded-full", source.closed && "opacity-45 grayscale")}
              iconClassName="size-5"
            />
          ) : (
            <LinkMark />
          )}
        </RowMark>
        <span className="flex min-w-0 flex-1 flex-col pl-1.5 leading-snug">
          <span
            className={cn(
              "truncate text-lg underline-offset-3 group-hover/source:underline",
              source.closed && "text-muted-foreground",
            )}
          >
            {/* Without the scheme: what tells two addresses apart is at their end. */}
            {source.sourceUrl.replace(/^https?:\/\//, "")}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            {source.closed && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-black/5 px-2 py-px text-xs font-medium">
                <HugeiconsIcon icon={SquareLock02Icon} className="size-3" aria-hidden="true" />
                {t.series.detail.sourceClosed}
              </span>
            )}
            {ended && !source.closed && (
              <span
                title={t.series.detail.sourceStillOpenHint(ended)}
                className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-px text-xs font-medium text-amber-900 ring-1 ring-amber-500/30"
              >
                <HugeiconsIcon icon={Alert02Icon} className="size-3" aria-hidden="true" />
                {t.series.detail.sourceStillOpen}
              </span>
            )}
            <span className="truncate">{holds}</span>
          </span>
        </span>
      </a>
      {children}
      <CloseButton seriesId={seriesId} source={source} ended={ended} />
    </div>
  );
}

/**
 * The series' addresses. A lone one is a row of its own; two or more fold under a header that counts
 * them, and unfolding lists them all, each with the padlock that closes it (a finished season) so
 * checks stop reading it. The padlocks and the header's arrow share the last column.
 */
export function SeriesSources({
  series,
  showStatus = null,
}: {
  series: SeriesDto;
  showStatus?: ShowLookupDto["status"];
}) {
  const t = useT();
  const ended = finishedStatus(showStatus);
  const api = useApi();
  const extractors = useQuery(queries.extractors(api));
  // The same list the episode grid reads, so this costs no request of its own.
  const episodes = useQuery(queries.episodes(api, series.id));
  const [open, setOpen] = useState(false);
  const extractorOf = (source: Source) =>
    extractors.data?.find((extractor) => extractor.id === source.extractorId) ?? null;
  const spansOf = (source: Source) => sourceSpans(episodes.data ?? [], source.id);

  const sorted = sortBySpan(series.sources, episodes.data ?? []);
  const addHref = addSourceHref(series, episodes.data ?? []);

  const [lone] = series.sources;
  if (series.sources.length === 1 && lone) {
    return (
      <SourceRow
        seriesId={series.id}
        source={lone}
        extractor={extractorOf(lone)}
        spans={spansOf(lone)}
        ended={ended}
      >
        <AddSourceButton href={addHref} />
      </SourceRow>
    );
  }

  const closed = series.sources.filter((source) => source.closed).length;
  const reading = series.sources.length - closed;
  const warn = ended !== null && reading > 0;
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className={ROWS}>
      <div className={ROW}>
        <Collapsible.Trigger className="group/head flex min-w-0 flex-1 items-center self-stretch py-3 pr-2 text-left focus-visible:outline-none">
          <RowMark>
            <LinkMark />
          </RowMark>
          <span className="flex min-w-0 flex-1 flex-col pl-1.5 leading-snug">
            <span className="truncate text-lg group-hover/head:underline underline-offset-3">
              {t.series.detail.sources(series.sources.length)}
            </span>
            {warn ? (
              <span
                title={t.series.detail.sourceStillOpenHint(ended)}
                className="flex min-w-0 items-center gap-1 text-sm font-medium text-amber-800"
              >
                <HugeiconsIcon
                  icon={Alert02Icon}
                  className="size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span className="truncate">
                  {[
                    t.series.detail.openButEnded(reading, ended),
                    closed > 0 && t.series.detail.closedSources(closed),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            ) : (
              <span className="truncate text-sm text-muted-foreground">
                {t.series.detail.sourcesSummary(reading, closed)}
              </span>
            )}
          </span>
        </Collapsible.Trigger>
        <AddSourceButton href={addHref} />
        <Collapsible.Trigger
          aria-label={open ? t.series.detail.hideSources : t.series.detail.showSources}
          title={open ? t.series.detail.hideSources : t.series.detail.showSources}
          className={ROUND_BUTTON}
        >
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={cn("size-4 transition-transform duration-200", open && "rotate-180")}
            aria-hidden="true"
          />
        </Collapsible.Trigger>
      </div>

      <Collapsible.Panel className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
        {/* Four rows and a half at most, the half saying there is more: a long series scrolls here
            rather than pushing the settings down. */}
        <div
          className={cn("max-h-82 overflow-y-auto overscroll-contain [scrollbar-width:thin]", ROWS)}
        >
          {sorted.map((source) => (
            <SourceRow
              key={source.id}
              seriesId={series.id}
              source={source}
              extractor={extractorOf(source)}
              spans={spansOf(source)}
              ended={ended}
            />
          ))}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
