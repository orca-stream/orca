import type { JobDto, NotificationDto, SeriesDto } from "@orca/hm-contract";
import {
  Add01Icon,
  Alert02Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
  Download04Icon,
  Film01Icon,
  RepeatIcon,
  RssIcon,
  SparklesIcon,
  Search01Icon,
  Tv01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useApi } from "@/api/context";
import { useMutations } from "@/api/mutations";
import { posterUrl, queries } from "@/api/queries";
import { Dock, DockAdd, DockPlaces } from "@/components/dock";
import { Loading } from "@/components/loading";
import { PendingButton } from "@/components/pending-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isHousekeeping, jobName, splitActive } from "@/downloads/job-view";
import { parseEpisodeCode } from "@/downloads/job-art";
import { JobRow } from "@/downloads/JobRow";
import { useNow } from "@/hooks/use-now";
import { formatDate, formatRelative } from "@/i18n/format";
import { useLocale, useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import { GLASS_PANEL } from "@/series/bar";
import { SeriesTile } from "@/series/SeriesListScreen";
import { useShow } from "@/series/use-show";

/** How many series the recent row holds. */
const RECENT = 12;
/** How many shows the "not downloaded" card names. */
const NOT_DOWNLOADED_SHOWN = 4;
/** How many waiting downloads the downloading card names before it only counts the rest. */
const QUEUED_SHOWN = 4;
/** How many announced episodes the upcoming card names. */
const UPCOMING_SHOWN = 4;
/** How many finished downloads the last card shows. */
const LAST_DOWNLOADS = 6;

/** The latest a series moved: an episode just downloaded, or the series just added. */
const latest = (s: SeriesDto) => Math.max(s.lastDownloadAt ?? 0, s.createdAt);

/** Episodes a show has found and not downloaded, nor on their way. */
function notDownloaded(series: SeriesDto) {
  if (series.kind === "movie") return 0;
  return Math.max(0, series.episodeCount - series.availableCount - series.downloadingCount);
}

/** The small caps heading every card of the home starts with. */
const HEADING = "text-xs font-semibold tracking-wide text-muted-foreground uppercase";

/**
 * The search the whole home starts from: a name searches every site, an address is read by the
 * site it belongs to, both on the add screen with the text already in.
 */
function AddSearch() {
  const t = useT();
  const [, navigate] = useLocation();
  const [text, setText] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const typed = text.trim();
    navigate(
      typed === ""
        ? "/series/new"
        : `/series/new?${new URLSearchParams({ url: typed }).toString()}`,
    );
  }

  return (
    <form role="search" onSubmit={submit} className="w-full">
      <div className={cn(GLASS_PANEL, "rounded-[44px]")}>
        <InputGroup className="h-22 rounded-[43px] border-0 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/30">
          <InputGroupInput
            name="q"
            value={text}
            onChange={(event) => setText(event.target.value)}
            type="text"
            autoComplete="off"
            spellCheck={false}
            aria-label={t.home.searchLabel}
            placeholder={t.home.searchPlaceholder}
            className="h-full pl-4! text-base md:text-lg"
          />
          <InputGroupAddon align="inline-start" className="pl-[15px]">
            <span className="flex size-14 items-center justify-center text-primary">
              <HugeiconsIcon icon={Search01Icon} className="size-6" />
            </span>
          </InputGroupAddon>
          <InputGroupAddon align="inline-end" className="pr-[15px] has-[>button]:mr-0">
            <Button
              type="submit"
              aria-label={t.home.searchSubmit}
              className="size-14 rounded-full shadow-lg shadow-primary/30"
            >
              <HugeiconsIcon icon={ArrowRight01Icon} className="size-6" />
            </Button>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </form>
  );
}

/** One glass card of the home, with its heading (and how many, and what goes at its end) on top. */
function Card({
  id,
  title,
  icon,
  count,
  end,
  children,
  className,
}: {
  id: string;
  title: string;
  icon: IconSvgElement;
  count?: number;
  end?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(GLASS_PANEL, "flex min-w-0 flex-col gap-2 p-2", className)}
    >
      <div className="flex min-h-12 items-center gap-3 px-2 pt-2">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <HugeiconsIcon icon={icon} className="size-5" />
        </span>
        <h2 id={id} className={HEADING}>
          {title}
          {count !== undefined && count > 0 && (
            <span className="ml-1.5 font-normal tabular-nums">{count}</span>
          )}
        </h2>
        <span className="ml-auto flex items-center gap-2">{end}</span>
      </div>
      {children}
    </section>
  );
}

/** A figure of the library: its icon, the number, and what it counts. */
function Stat({ icon, value, label }: { icon: IconSvgElement; value: number; label: string }) {
  return (
    <li className={cn(GLASS_PANEL, "flex items-center gap-4 rounded-3xl p-4")}>
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-sky-400 to-primary text-white shadow-lg shadow-primary/30">
        <HugeiconsIcon icon={icon} className="size-6" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
        <span className="block truncate text-sm text-muted-foreground">{label}</span>
      </span>
    </li>
  );
}

function Stats({ series }: { series: SeriesDto[] }) {
  const t = useT();
  const shows = series.filter((s) => s.kind !== "movie");
  return (
    <ul aria-label={t.nav.library} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Stat icon={Tv01Icon} value={shows.length} label={t.home.stats.shows} />
      <Stat icon={Film01Icon} value={series.length - shows.length} label={t.home.stats.movies} />
      <Stat
        icon={CheckmarkCircle02Icon}
        value={shows.reduce((sum, s) => sum + s.availableCount, 0)}
        label={t.home.stats.episodes}
      />
      <Stat
        icon={RssIcon}
        value={shows.filter((s) => s.follow).length}
        label={t.home.stats.following}
      />
    </ul>
  );
}

/**
 * Every download that failed, across the whole width: each with why and the way to try it again
 * (a permanent error too: the site may have mended), and all of them at once.
 */
function Errors() {
  const t = useT();
  const api = useApi();
  const failed = useQuery(queries.jobsFailed(api));
  const { retryJob, retryJobs } = useMutations();
  const failures = (failed.data ?? []).filter((job) => !isHousekeeping(job));
  if (failures.length === 0) return null;

  return (
    <Card
      id="home-errors"
      title={t.home.errorsTitle}
      icon={Alert02Icon}
      count={failures.length}
      className="bg-destructive/5"
      end={
        failures.length > 1 && (
          <PendingButton
            variant="ghost"
            pending={retryJobs.isPending}
            onClick={() => retryJobs.mutate(failures.map((job) => job.id))}
            className="rounded-full text-primary hover:bg-white"
          >
            {t.home.retryAll}
          </PendingButton>
        )
      }
    >
      <ul className={cn("grid gap-1", failures.length > 1 && "lg:grid-cols-2")}>
        {failures.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            detail={
              <p className="line-clamp-2 break-words text-destructive/90">
                {job.lastError ?? t.dashboard.unknownError}
              </p>
            }
            action={
              <Tooltip>
                <TooltipTrigger
                  render={
                    <PendingButton
                      variant="ghost"
                      size="icon"
                      aria-label={t.dashboard.retryOne(jobName(job, t.dashboard.kinds[job.kind]))}
                      pending={retryJob.isPending && retryJob.variables === job.id}
                      onClick={() => retryJob.mutate(job.id)}
                      className="rounded-full hover:bg-white"
                    />
                  }
                >
                  <HugeiconsIcon icon={RepeatIcon} />
                </TooltipTrigger>
                <TooltipContent>{t.common.retry}</TooltipContent>
              </Tooltip>
            }
          />
        ))}
      </ul>
    </Card>
  );
}

/** One check that found new episodes: the show, which ones, when, and a button to download them. */
function NewEpisodesRow({
  notification,
  series,
  count,
  codes,
}: {
  notification: NotificationDto;
  series: SeriesDto;
  count: number;
  codes: string;
}) {
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const now = useNow(60_000);
  const { cover } = useShow(series);
  const { enqueue, markNotificationsRead } = useMutations();
  const episodes = useQuery(queries.episodes(api, series.id));
  const places = codes.split(",").flatMap((code) => parseEpisodeCode(code.trim()) ?? []);
  // Only the ones still to download: a download is never asked for twice.
  const toDownload = (episodes.data ?? [])
    .filter(
      (e) =>
        (e.status === "missing" || e.status === "failed") &&
        places.some((place) => place.season === e.season && place.episode === e.episode),
    )
    .map((e) => e.id);
  const href = `/series/${encodeURIComponent(series.id)}`;
  const seen = () => markNotificationsRead.mutate([notification.id]);

  return (
    <li className="flex min-h-18 items-center gap-4 rounded-2xl p-2 transition-colors hover:bg-white/60">
      <RowCover src={cover} kind={series.kind} />
      <div className="min-w-0 flex-1 leading-tight">
        <Link
          href={href}
          onClick={seen}
          className="block truncate text-sm font-medium hover:underline"
        >
          {series.title}
        </Link>
        <p className="truncate text-xs text-muted-foreground tabular-nums">
          {t.home.newEpisodes(count, codes)}
          {" · "}
          {formatRelative(new Date(notification.createdAt), new Date(now), locale)}
        </p>
      </div>
      {toDownload.length > 0 && (
        <Tooltip>
          <TooltipTrigger
            render={
              <PendingButton
                variant="ghost"
                size="icon"
                aria-label={t.home.downloadNew(series.title)}
                pending={enqueue.isPending}
                onClick={() => enqueue.mutate(toDownload, { onSuccess: seen })}
                className="rounded-full hover:bg-white"
              />
            }
          >
            <HugeiconsIcon icon={Download04Icon} />
          </TooltipTrigger>
          <TooltipContent>{t.home.download}</TooltipContent>
        </Tooltip>
      )}
    </li>
  );
}

/**
 * The new episodes the checks found and nobody has looked at yet (the unread ones of the bell):
 * nothing is downloaded by itself, so each is one click from being asked for.
 */
function NewEpisodes({ series }: { series: SeriesDto[] }) {
  const t = useT();
  const api = useApi();
  const notifications = useQuery(queries.notifications(api));
  const found = (notifications.data?.items ?? []).flatMap((n) => {
    if (n.kind !== "new_episodes" || n.readAt !== null) return [];
    const of = series.find((s) => s.id === n.seriesId);
    const { count, codes } = n.data;
    if (!of || typeof count !== "number" || typeof codes !== "string") return [];
    return [{ notification: n, series: of, count, codes }];
  });
  if (found.length === 0) return null;

  return (
    <Card id="home-new" title={t.home.newEpisodesTitle} icon={SparklesIcon} count={found.length}>
      <ul className="grid gap-1 lg:grid-cols-2">
        {found.map((row) => (
          <NewEpisodesRow key={row.notification.id} {...row} />
        ))}
      </ul>
    </Card>
  );
}

/**
 * What is downloading, as tall as the cards beside it: what runs with its frame and progress, the
 * first few waiting behind, and how many more. With nothing on its way, a proper empty state.
 */
function Downloading({ className }: { className?: string }) {
  const t = useT();
  const api = useApi();
  const active = useQuery(queries.jobsActive(api));
  const jobs = (active.data ?? []).filter((job) => job.kind === "download_episode");
  const { running, queued } = splitActive(jobs);
  const more = queued.length - QUEUED_SHOWN;

  return (
    <Card
      id="home-downloading"
      title={t.home.downloadingTitle}
      icon={Download04Icon}
      count={jobs.length}
      className={className}
    >
      {active.isPending ? (
        <Loading className="m-auto" />
      ) : jobs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
          <span className="relative mb-2 flex size-24 items-center justify-center">
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full bg-primary/10 motion-safe:animate-pulse"
            />
            <span className="relative flex size-16 items-center justify-center rounded-full bg-linear-to-br from-sky-400 to-primary text-white shadow-lg shadow-primary/30">
              <HugeiconsIcon icon={Download04Icon} className="size-8" />
            </span>
          </span>
          <p className="text-lg font-semibold tracking-tight">{t.home.downloadingEmpty}</p>
          <p className="max-w-72 text-sm text-muted-foreground">{t.home.downloadingEmptyHint}</p>
          <Link
            href="/series/new"
            className={cn(buttonVariants(), "mt-2 h-10 gap-2 rounded-full px-5")}
          >
            <HugeiconsIcon icon={Add01Icon} />
            {t.home.addSomething}
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {running.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
          {queued.slice(0, QUEUED_SHOWN).map((job) => (
            <JobRow key={job.id} job={job} detail={t.status.queued} />
          ))}
          {more > 0 && (
            <li className="px-2 pb-2 text-sm text-muted-foreground">{t.home.moreQueued(more)}</li>
          )}
        </ul>
      )}
    </Card>
  );
}

/** A small 2:3 cover for a row of a card, or its kind's icon. */
function RowCover({ src, kind }: { src: string | null; kind: SeriesDto["kind"] }) {
  return src ? (
    <img
      src={src}
      alt=""
      loading="lazy"
      className="aspect-2/3 h-14 shrink-0 rounded-lg object-cover ring-1 ring-black/5"
    />
  ) : (
    <span className="flex aspect-2/3 h-14 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
      <HugeiconsIcon icon={kind === "movie" ? Film01Icon : Tv01Icon} className="size-5" />
    </span>
  );
}

/** A row of a card that opens a series: its cover, its name, a line under it. */
function SeriesRow({
  series,
  cover,
  detail,
}: {
  series: SeriesDto;
  cover: string | null;
  detail: string;
}) {
  return (
    <li>
      <Link
        href={`/series/${encodeURIComponent(series.id)}`}
        className="flex min-h-18 items-center gap-4 rounded-2xl p-2 outline-none transition hover:bg-white/60 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <RowCover src={cover} kind={series.kind} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-medium">{series.title}</span>
          <span className="block truncate text-xs text-muted-foreground tabular-nums">
            {detail}
          </span>
        </span>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          className="mr-2 size-5 shrink-0 text-muted-foreground"
        />
      </Link>
    </li>
  );
}

function NotDownloadedRow({ series }: { series: SeriesDto }) {
  const t = useT();
  const { cover } = useShow(series);
  return (
    <SeriesRow series={series} cover={cover} detail={t.home.notDownloaded(notDownloaded(series))} />
  );
}

/** The shows with episodes found and not downloaded, the latest first. */
function NotDownloaded({ series }: { series: SeriesDto[] }) {
  const t = useT();
  const left = series.filter((s) => notDownloaded(s) > 0).toSorted((a, b) => latest(b) - latest(a));
  return (
    <Card
      id="home-not-downloaded"
      title={t.home.notDownloadedTitle}
      icon={Tv01Icon}
      count={left.length}
    >
      {left.length === 0 ? (
        <p className="flex items-center gap-2 px-2 pb-2 text-sm text-muted-foreground">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-5 text-success" />
          {t.home.allClear}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {left.slice(0, NOT_DOWNLOADED_SHOWN).map((s) => (
            <NotDownloadedRow key={s.id} series={s} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The next episode TMDB announces of each show being followed, the soonest first. */
function Upcoming({ series }: { series: SeriesDto[] }) {
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const followed = series.filter((s) => s.kind !== "movie" && s.follow && s.tmdbId !== null);
  const lookups = useQueries({
    queries: followed.map((s) => queries.showLookup(api, s.tmdbId ?? "", s.kind)),
  });
  const coming = followed
    .flatMap((s, index) => {
      const show = lookups[index]?.data;
      return show?.nextEpisode
        ? [
            {
              series: s,
              next: show.nextEpisode,
              cover: s.hasPoster ? posterUrl(s) : show.posterUrl,
            },
          ]
        : [];
    })
    .toSorted((a, b) => (a.next.airDate ?? "9999").localeCompare(b.next.airDate ?? "9999"))
    .slice(0, UPCOMING_SHOWN);

  return (
    <Card
      id="home-upcoming"
      title={t.home.upcomingTitle}
      icon={Calendar03Icon}
      count={coming.length}
    >
      {coming.length === 0 ? (
        <p className="px-2 pb-2 text-sm text-muted-foreground">{t.home.upcomingEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {coming.map(({ series: s, next, cover }) => (
            <SeriesRow
              key={s.id}
              series={s}
              cover={cover ?? null}
              detail={t.home.upcoming(
                next.season,
                next.number,
                next.airDate && formatDate(next.airDate, locale),
              )}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** A round 40px arrow of the carousel. */
function ArrowButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: IconSvgElement;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-full bg-white/70 ring-1 ring-black/5 hover:bg-white"
    >
      <HugeiconsIcon icon={icon} />
    </Button>
  );
}

/**
 * The library's latest as a carousel of its cards: arrows on top move it a pageful at a time, and
 * there is no scrollbar (it still follows a wheel, a swipe or the keyboard).
 */
function Recent({ series }: { series: SeriesDto[] }) {
  const t = useT();
  const track = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const recent = series.toSorted((a, b) => latest(b) - latest(a)).slice(0, RECENT);

  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const measure = () =>
      setEdges({
        start: node.scrollLeft <= 1,
        end: node.scrollLeft + node.clientWidth >= node.scrollWidth - 1,
      });
    measure();
    node.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => {
      node.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [recent.length]);

  function move(direction: 1 | -1) {
    const node = track.current;
    if (!node) return;
    node.scrollBy({ left: direction * node.clientWidth * 0.9, behavior: "smooth" });
  }

  return (
    <section aria-labelledby="home-recent" className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-12 items-center gap-2 px-4">
        <h2 id="home-recent" className={HEADING}>
          {t.home.recentTitle}
        </h2>
        <Link
          href="/series"
          className="ml-auto flex items-center gap-1 rounded-full px-3 py-2 text-sm font-medium text-primary outline-none hover:bg-white/60 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {t.home.seeLibrary}
        </Link>
        <ArrowButton
          label={t.home.previous}
          icon={ArrowLeft01Icon}
          disabled={edges.start}
          onClick={() => move(-1)}
        />
        <ArrowButton
          label={t.home.next}
          icon={ArrowRight01Icon}
          disabled={edges.end}
          onClick={() => move(1)}
        />
      </div>
      {/* Room above and below the row, so a card lifting on hover keeps its shadow. */}
      <ul
        ref={track}
        className="-my-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-px py-4 [scrollbar-width:none] *:w-48 *:shrink-0 *:snap-start sm:*:w-56 [&::-webkit-scrollbar]:hidden"
      >
        {recent.map((s) => (
          <SeriesTile key={s.id} series={s} />
        ))}
      </ul>
    </section>
  );
}

/** The downloads that finished last, with when. */
function LastDownloads() {
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const now = useNow(60_000);
  const history = useInfiniteQuery(queries.jobsHistory(api));
  // Newest first; an episode downloaded again shows once, as its latest download.
  const seen = new Set<string>();
  const done = (history.data?.pages[0]?.items ?? [])
    .filter((job: JobDto) => job.kind === "download_episode" && job.status === "done")
    .filter((job) => {
      const key = job.episodeId ?? job.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, LAST_DOWNLOADS);
  if (done.length === 0) return null;

  return (
    <Card id="home-last" title={t.home.lastDownloadsTitle} icon={CheckmarkCircle02Icon}>
      <ul className="grid gap-1 lg:grid-cols-2">
        {done.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            detail={
              job.finishedAt === null
                ? t.status.done
                : t.dashboard.finished(
                    formatRelative(new Date(job.finishedAt), new Date(now), locale),
                  )
            }
          />
        ))}
      </ul>
    </Card>
  );
}

/** With nothing in the library yet: only the search, and what it is for. */
function EmptyLibrary() {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <span className="flex size-20 items-center justify-center rounded-3xl bg-linear-to-br from-sky-400 to-primary text-white shadow-lg shadow-primary/30">
        <HugeiconsIcon icon={Film01Icon} className="size-10" />
      </span>
      <h2 className="mt-2 text-lg font-semibold tracking-tight">{t.home.emptyTitle}</h2>
      <p className="max-w-80 text-sm text-muted-foreground">{t.home.emptyHint}</p>
    </div>
  );
}

/**
 * Home, as a dashboard: the search that adds a show or a movie on top, the library's figures, any
 * download that failed across the whole width and the new episodes found, then what is downloading (as tall as the column
 * beside it: what is left to download and what airs next), the library's latest as a carousel and
 * the downloads that finished last.
 */
export function HomeScreen() {
  const t = useT();
  const api = useApi();
  const list = useQuery(queries.seriesList(api));
  const series = list.data ?? [];

  return (
    <div className="flex w-full flex-col gap-4">
      <h1 className="sr-only">{t.nav.home}</h1>
      <div className="mx-auto w-full max-w-3xl pt-4 sm:pt-8">
        <AddSearch />
      </div>
      {list.isPending && <Loading className="self-center" />}
      {list.isError && (
        <p role="alert" className="text-center text-sm text-warning">
          {t.dashboard.loadFailed}
        </p>
      )}
      {list.isSuccess && series.length === 0 && <EmptyLibrary />}
      {list.isSuccess && series.length > 0 && (
        <>
          <Stats series={series} />
          <Errors />
          <NewEpisodes series={series} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Downloading className="lg:col-span-2 lg:row-span-2" />
            <NotDownloaded series={series} />
            <Upcoming series={series} />
          </div>
          <Recent series={series} />
          <LastDownloads />
        </>
      )}
      <Dock label={t.dock.label}>
        <DockPlaces here="home" />
        <DockAdd />
      </Dock>
    </div>
  );
}
