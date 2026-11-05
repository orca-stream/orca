import type {
  EpisodeAdjustment,
  GuideEpisodeDto,
  PreviewDto,
  PreviewEpisode,
} from "@orca/hm-contract";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Alert02Icon,
  RefreshIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Download04Icon,
  Globe02Icon,
  HashtagIcon,
  LeftToRightListNumberIcon,
  PencilEdit02Icon,
  ServerStack02Icon,
  Tick02Icon,
  Video01Icon,
} from "@hugeicons/core-free-icons";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { formatBytes, formatDate, formatDuration } from "@/i18n/format";
import { useLocale, useT } from "@/i18n/locale";
import type { Messages } from "@/i18n/messages";
import { useRetryingImage } from "@/lib/retrying-image";
import { cn } from "@/lib/utils";
import { NumberRow, ROWS, SelectRow } from "@/settings/rows";
import {
  adjustmentOf,
  episodeCode,
  guideKey,
  nextSpecial,
  numberer,
  setAdjustment,
  setAllIncluded,
  toggleEpisode,
  warningsByEpisode,
  type PreviewForm,
} from "./preview-form";
import { BAR_POPUP, GLASS_PANEL, ISLAND } from "./bar";
import { agrees, localToday, matchTmdb, numberRanges, type SeasonMatch } from "./tmdb-match";

/** What happens to an episode when the series is added, which its card says on its frame. */
type Fate = "download" | "wait" | "left-out" | "taken" | "kept";

const FATE_STYLE: Record<Fate, string> = {
  download: "bg-primary text-primary-foreground",
  wait: "bg-white/90 text-foreground",
  "left-out": "bg-black/45 text-white/85",
  taken: "bg-info text-white",
  kept: "bg-white/90 text-foreground",
};

/** The glass every chip over a frame is made of: dark, so it reads on any picture. */
const CHIP =
  "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap backdrop-blur-md";

interface EpisodeGridProps {
  preview: PreviewDto;
  form: PreviewForm;
  onChange: (form: PreviewForm) => void;
  /** TMDB's episodes by `guideKey`, where they are known: the frame, the name, the synopsis. */
  guide: ReadonlyMap<string, GuideEpisodeDto>;
  /**
   * TMDB's episodes of each season the address lands in, where known (empty for a season TMDB
   * doesn't have), to show where the site and TMDB disagree.
   */
  guideSeasons: ReadonlyMap<number, readonly GuideEpisodeDto[]>;
  /** The codes the series it goes to already has; empty for a new one. */
  taken: ReadonlySet<string>;
  /** The codes the Jellyfin show it goes to has as files: kept, not downloaded again. */
  kept: ReadonlySet<string>;
}

/** The episodes of the address as a grid of frames: which go in, where they land, from where. */
export function EpisodeGrid({
  preview,
  form,
  onChange,
  guide,
  guideSeasons,
  taken,
  kept,
}: EpisodeGridProps) {
  const t = useT();
  const included = new Set(form.included);
  const number = numberer(preview, form);
  const warnings = warningsByEpisode(preview);
  // The warnings about the series as a whole; the ones about episodes go on their cards.
  const general = preview.warnings.filter((warning) => !warning.keys?.length);
  const all = form.included.length === preview.episodes.length;
  // Where the address and TMDB disagree: what lands where TMDB lists nothing, and what TMDB lists
  // that nothing brings (the series having it already counts as brought).
  const matches = matchTmdb(
    preview.episodes.map(number),
    guideSeasons,
    new Set([...taken, ...kept]),
    localToday(),
  );
  const extra = new Set(
    matches.flatMap((match) => match.extra.map((n) => episodeCode(match.season, n))),
  );
  // The address's episodes and TMDB's that it lacks, together in the order they land in.
  const cells: Cell[] = [
    ...preview.episodes.map((episode) => ({
      kind: "episode" as const,
      episode,
      at: number(episode),
    })),
    ...matches.flatMap((match) =>
      [...match.missing, ...match.upcoming].map((n) => ({
        kind: "gap" as const,
        aired: match.missing.includes(n),
        tmdb: guide.get(guideKey(match.season, n)) ?? null,
        at: { season: match.season, episode: n },
      })),
    ),
  ].sort(
    (a, b) =>
      a.at.season - b.at.season ||
      a.at.episode - b.at.episode ||
      (a.kind === "episode" && b.kind === "episode" ? a.episode.season - b.episode.season : 0),
  );

  return (
    // One panel, as a series shows its episodes: the header floats inside it over the frames. A
    // clip, not a hidden overflow, so the header can stick.
    <section aria-labelledby="episodes-title" className={cn(GLASS_PANEL, "min-w-0 overflow-clip")}>
      <header className={cn(ISLAND, "top-4 mx-4 mt-4")}>
        <h2 id="episodes-title" className="text-base font-medium">
          {t.add.episodesTitle}
        </h2>
        <span className="text-sm text-muted-foreground tabular-nums">
          {t.add.episodesCount(form.included.length, preview.episodes.length)}
        </span>
        {matches.length > 0 && <TmdbMatch matches={matches} />}
        {general.length > 0 && <GeneralWarnings warnings={general} />}
        <label className="ml-auto flex cursor-pointer items-center gap-2.5 text-sm">
          {t.add.includeAllShort}
          <Switch
            size="lg"
            aria-label={t.add.includeAll}
            checked={all}
            onCheckedChange={(on) => onChange(setAllIncluded(preview, form, on))}
          />
        </label>
      </header>
      {/* No gap: the grid's 8px plus each card's own 8px make the panel's 16px, to its edge and between frames. */}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] p-2">
        {cells.map((cell) => {
          if (cell.kind === "gap") {
            const code = episodeCode(cell.at.season, cell.at.episode);
            return (
              <li key={`gap:${code}`}>
                <GapCard code={code} aired={cell.aired} tmdb={cell.tmdb} />
              </li>
            );
          }
          const { episode, at: mapped } = cell;
          const code = episodeCode(mapped.season, mapped.episode);
          const isIn = included.has(episode.key);
          const fate: Fate = !isIn
            ? "left-out"
            : taken.has(code)
              ? "taken"
              : kept.has(code)
                ? "kept"
                : form.downloadNow
                  ? "download"
                  : "wait";
          return (
            <li key={episode.key}>
              <EpisodeCard
                episode={episode}
                code={code}
                siteCode={episodeCode(episode.season, episode.episode)}
                fate={fate}
                included={isIn}
                tmdb={guide.get(guideKey(mapped.season, mapped.episode)) ?? null}
                flags={[...new Set((warnings.get(episode.key) ?? []).map((w) => w.kind))]}
                notInTmdb={extra.has(code)}
                onToggle={() => onChange(toggleEpisode(form, episode.key))}
                numbering={{
                  adjustment: adjustmentOf(form, episode),
                  // Where it would land counted in order: the number "another number" starts from.
                  counted: numberer(preview, setAdjustment(form, episode, null))(episode).episode,
                  nextSpecial: nextSpecial(form, taken),
                  onChange: (next) => onChange(setAdjustment(form, episode, next)),
                }}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A cell of the grid: an episode of the address, or one TMDB lists that the address lacks. */
type Cell =
  | { kind: "episode"; episode: PreviewEpisode; at: { season: number; episode: number } }
  | {
      kind: "gap";
      aired: boolean;
      tmdb: GuideEpisodeDto | null;
      at: { season: number; episode: number };
    };

/**
 * How the address compares with TMDB, season by season, as a sign in the header: green when they
 * agree, amber when not; the counts and the episodes that differ on hover.
 */
function TmdbMatch({ matches }: { matches: SeasonMatch[] }) {
  const t = useT();
  const ok = matches.every(agrees);
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={0}
        closeDelay={100}
        render={<span />}
        className={cn(
          "flex h-8 cursor-help items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
          ok ? "bg-success/12 text-success" : "bg-warning/12 text-warning",
        )}
      >
        <HugeiconsIcon icon={ok ? CheckmarkCircle02Icon : Alert02Icon} className="size-4" />
        {ok ? t.add.tmdbAgrees : t.add.tmdbDiffers}
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        sideOffset={8}
        className="w-80 rounded-2xl border border-(--glass-edge) bg-(--glass-strong) p-4 text-sm shadow-[0_16px_48px_-20px_var(--glass-shadow)] ring-0 supports-backdrop-filter:bg-(--glass) supports-backdrop-filter:backdrop-blur-[24px]"
      >
        <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t.add.tmdbMatchTitle}
        </p>
        <ul className="flex flex-col gap-2">
          {matches.map((match) => (
            <li key={match.season}>
              <strong
                className={cn(
                  "flex items-center gap-1.5 font-medium tabular-nums",
                  agrees(match) ? "text-foreground" : "text-warning",
                )}
              >
                <HugeiconsIcon
                  icon={agrees(match) ? CheckmarkCircle02Icon : Alert02Icon}
                  className={cn("size-4 shrink-0", agrees(match) && "text-success")}
                />
                {match.tmdb === 0
                  ? t.add.tmdbNoSeason(match.season, match.site)
                  : t.add.tmdbSeasonRow(match.season, match.site, match.tmdb)}
              </strong>
              {match.extra.length > 0 && match.tmdb > 0 && (
                <span className="block pl-5.5 text-muted-foreground">
                  {t.add.tmdbExtra(numberRanges(match.extra))}
                </span>
              )}
              {match.missing.length > 0 && (
                <span className="block pl-5.5 text-muted-foreground">
                  {t.add.tmdbMissing(numberRanges(match.missing))}
                </span>
              )}
              {match.upcoming.length > 0 && (
                <span className="block pl-5.5 text-muted-foreground">
                  {t.add.tmdbUpcoming(numberRanges(match.upcoming))}
                </span>
              )}
              {match.covered.length > 0 && (
                <span className="block pl-5.5 text-muted-foreground">
                  {t.add.tmdbCovered(numberRanges(match.covered))}
                </span>
              )}
            </li>
          ))}
        </ul>
      </HoverCardContent>
    </HoverCard>
  );
}

/** The warnings about the series, behind an amber sign in the header: read on hover. */
function GeneralWarnings({ warnings }: { warnings: PreviewDto["warnings"] }) {
  const t = useT();
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={0}
        closeDelay={100}
        render={<span />}
        className="flex h-8 cursor-help items-center gap-1.5 rounded-full bg-warning/12 px-2.5 text-xs font-medium text-warning"
      >
        <HugeiconsIcon icon={Alert02Icon} className="size-4" />
        {warnings.length}
        <span className="sr-only">{t.add.generalWarnings(warnings.length)}</span>
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        sideOffset={8}
        className="w-80 rounded-2xl border border-(--glass-edge) bg-(--glass-strong) p-4 text-sm shadow-[0_16px_48px_-20px_var(--glass-shadow)] ring-0 supports-backdrop-filter:bg-(--glass) supports-backdrop-filter:backdrop-blur-[24px]"
      >
        <ul className="flex flex-col gap-2">
          {warnings.map((warning, index) => (
            <li key={index}>
              <strong className="font-medium text-warning">
                {t.add.warningKinds[warning.kind]}
              </strong>
              <span className="block text-muted-foreground">{warningSentence(warning, t)}</span>
            </li>
          ))}
        </ul>
      </HoverCardContent>
    </HoverCard>
  );
}

/** The warning in the panel's language by its kind; the server's text for a kind we don't know. */
function warningSentence(warning: PreviewDto["warnings"][number], t: Messages): string {
  return (t.add.warningText as Record<string, string | undefined>)[warning.kind] ?? warning.message;
}

/** Where the episode is fetched from, as a chip: its host, or "several servers" for mirrors. */
function serverOf(
  source: PreviewEpisode["source"],
  t: Messages,
): { icon: IconSvgElement; label: string; hint: string } {
  const host = source.host ?? t.add.unknownServer;
  if (source.kind === "mirrors") {
    return {
      icon: ServerStack02Icon,
      label: t.add.severalServers,
      hint: t.add.server.mirrors(host),
    };
  }
  return { icon: Globe02Icon, label: host, hint: t.add.server[source.kind](host) };
}

interface EpisodeCardProps {
  episode: PreviewEpisode;
  /** Where it lands, and where the site has it (when the numbering moves it). */
  code: string;
  siteCode: string;
  fate: Fate;
  included: boolean;
  tmdb: GuideEpisodeDto | null;
  flags: PreviewDto["warnings"][number]["kind"][];
  /** It lands on a number TMDB doesn't list for its season. */
  notInTmdb: boolean;
  onToggle: () => void;
  numbering: Numbering;
}

function EpisodeCard({
  episode,
  code,
  siteCode,
  fate,
  included,
  tmdb,
  flags,
  notInTmdb,
  onToggle,
  numbering,
}: EpisodeCardProps) {
  const t = useT();
  const locale = useLocale();
  const { src: still, onError: onStillError } = useRetryingImage(tmdb?.stillUrl);
  const title = tmdb?.name || episode.title;
  const server = serverOf(episode.source, t);
  const fateText = {
    download: { label: t.add.willDownload, hint: t.add.downloadHint, icon: Download04Icon },
    wait: { label: t.add.willWait, hint: t.add.waitHint, icon: Tick02Icon },
    "left-out": { label: t.add.leftOut, hint: t.add.leftOutHint, icon: null },
    taken: { label: t.add.alreadyThere, hint: t.add.alreadyThereHint(code), icon: RefreshIcon },
    kept: {
      label: t.add.keptInJellyfin,
      hint: t.add.keptInJellyfinHint(code),
      icon: CheckmarkCircle02Icon,
    },
  }[fate];
  // The site's own length when it gave one, else TMDB's.
  const length =
    episode.durationSec !== null
      ? formatDuration(Math.round(episode.durationSec))
      : tmdb?.runtimeMin
        ? t.add.minutes(tmdb.runtimeMin)
        : null;
  const details = [
    tmdb?.airDate ? formatDate(tmdb.airDate, locale) : null,
    length,
    episode.sizeBytes === null ? null : formatBytes(episode.sizeBytes, locale),
    episode.format?.toUpperCase() ?? null,
  ].filter((part) => part !== null);

  return (
    <article
      onClick={onToggle}
      className={cn(
        // Rounded around the frame (its 15px plus the 8px padding), so the hover never shows a
        // square corner against the rounded panel.
        "group/card flex h-full cursor-pointer flex-col gap-3 rounded-[23px] p-2 transition-[background-color,opacity] duration-300 hover:bg-white/35",
        !included && "opacity-70 hover:opacity-100",
      )}
    >
      <div className="relative aspect-video overflow-hidden rounded-[15px] bg-linear-to-br from-primary/15 via-white/40 to-info/20">
        {still ? (
          <img
            src={still}
            alt=""
            loading="lazy"
            onError={onStillError}
            className={cn(
              "size-full object-cover transition-[filter,scale] duration-500 group-hover/card:scale-[1.03]",
              !included && "grayscale",
            )}
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex size-full flex-col items-center justify-center gap-1 text-primary/50"
          >
            <HugeiconsIcon icon={Video01Icon} className="size-8" />
            <span className="font-mono text-sm">{code}</span>
          </div>
        )}
        {/* Darker at the edges, so the chips read on a bright frame. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-linear-to-b from-black/35 via-transparent to-black/45"
        />

        {/* Where it lands and where it comes from; the box to its right. */}
        <div className="absolute top-2 right-13 left-2 flex items-start gap-1.5">
          <NumberingChip code={code} siteCode={siteCode} numbering={numbering} />
          <span title={server.hint} className={cn(CHIP, "min-w-0 shrink bg-black/45 text-white")}>
            <HugeiconsIcon icon={server.icon} className="size-3.5 shrink-0" />
            <span className="truncate">{server.label}</span>
          </span>
        </div>

        {/* The download sign is the episode's box: in, and downloaded or not; or left out. */}
        <button
          type="button"
          role="checkbox"
          aria-checked={included}
          aria-label={t.add.includeEpisode(code)}
          title={fateText.hint}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          className={cn(
            "absolute top-2 right-2 flex size-10 items-center justify-center rounded-full shadow-md ring-1 ring-black/10 backdrop-blur-md transition-colors focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none",
            fate === "left-out" ? "bg-black/30 ring-white/60 hover:bg-black/45" : FATE_STYLE[fate],
          )}
        >
          {fateText.icon && <HugeiconsIcon icon={fateText.icon} className="size-4.5" />}
        </button>

        <div className="absolute inset-x-2 bottom-2 flex flex-wrap-reverse items-end gap-1.5">
          <span title={fateText.hint} className={cn(CHIP, FATE_STYLE[fate])}>
            {fateText.icon && <HugeiconsIcon icon={fateText.icon} className="size-3.5" />}
            {fateText.label}
          </span>
          {notInTmdb && (
            <span
              title={t.add.notInTmdbHint(code)}
              className={cn(CHIP, "bg-warning/90 text-white")}
            >
              {t.add.notInTmdb}
            </span>
          )}
          {flags
            .filter((kind) => kind !== "license" && kind !== "year")
            .map((kind) => (
              <span
                key={kind}
                title={kind === "inferred" ? t.add.inferredHint : undefined}
                className={cn(CHIP, "bg-warning/90 text-white")}
              >
                {t.add.warningKinds[kind]}
              </span>
            ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1 px-2 pb-1.5">
        <h3
          title={title === episode.title ? undefined : episode.title}
          className="truncate font-medium"
        >
          {title}
        </h3>
        {details.length > 0 && (
          <p className="truncate text-xs text-muted-foreground tabular-nums">
            {details.join(" · ")}
          </p>
        )}
        {tmdb?.overview && (
          <p className="line-clamp-2 text-sm text-foreground/70">{tmdb.overview}</p>
        )}
      </div>
    </article>
  );
}

/** How a card's episode is numbered, and how to change it. */
interface Numbering {
  adjustment: EpisodeAdjustment | null;
  /** The number it gets counted in order, with the rest as they are. */
  counted: number;
  /** The first special number free. */
  nextSpecial: number;
  onChange: (next: Pick<EpisodeAdjustment, "kind" | "number"> | null) => void;
}

const MAX_EPISODE = 9999;

/**
 * Where the episode lands and where the site has it, as a chip that opens its numbering: counted in
 * order, sent to the specials, or another number that the ones after it carry on from.
 */
function NumberingChip({
  code,
  siteCode,
  numbering,
}: {
  code: string;
  siteCode: string;
  numbering: Numbering;
}) {
  const t = useT();
  const { adjustment, counted, onChange } = numbering;
  const kind = adjustment?.kind ?? "counts";
  return (
    <Popover>
      <PopoverTrigger
        aria-label={t.add.episodeNumbering.open(code)}
        title={siteCode === code ? undefined : t.add.siteCode(siteCode)}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          CHIP,
          "cursor-pointer font-mono text-white transition-colors focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none",
          adjustment ? "bg-primary/85 hover:bg-primary" : "bg-black/45 hover:bg-black/65",
        )}
      >
        {code}
        {siteCode !== code && (
          <span className={adjustment ? "text-white/75" : "text-white/60"}>· {siteCode}</span>
        )}
        {adjustment && <HugeiconsIcon icon={PencilEdit02Icon} className="size-3.5 opacity-80" />}
      </PopoverTrigger>
      {/* Clicks inside reach the card through the portal: they mustn't pick the episode. */}
      <PopoverContent
        align="start"
        sideOffset={8}
        onClick={(event) => event.stopPropagation()}
        className={cn(BAR_POPUP, "w-[min(24rem,var(--available-width))] gap-0 p-0")}
      >
        <p className="p-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t.add.episodeNumbering.title(siteCode)}
        </p>
        <div className={ROWS}>
          <SelectRow
            icon={LeftToRightListNumberIcon}
            label={t.add.episodeNumbering.kind}
            hint={t.add.episodeNumbering.kindHint}
            value={kind}
            options={[
              { value: "counts", label: t.add.episodeNumbering.counts },
              { value: "special", label: t.add.episodeNumbering.special },
              { value: "renumber", label: t.add.episodeNumbering.renumber },
            ]}
            onChange={(next) =>
              onChange(
                next === "special"
                  ? { kind: "special", number: numbering.nextSpecial }
                  : next === "renumber"
                    ? { kind: "renumber", number: counted }
                    : null,
              )
            }
          />
          {adjustment && (
            <NumberRow
              icon={HashtagIcon}
              label={
                adjustment.kind === "special"
                  ? t.add.episodeNumbering.specialNumber
                  : t.add.episodeNumbering.episodeNumber
              }
              value={String(adjustment.number)}
              min={adjustment.kind === "special" ? 1 : 0}
              max={MAX_EPISODE}
              decrease={t.add.episodeNumbering.decrease}
              increase={t.add.episodeNumbering.increase}
              onChange={(text) => {
                if (text !== "") onChange({ kind: adjustment.kind, number: Number(text) });
              }}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * An episode TMDB lists that the address doesn't bring, in the place it would land: its frame
 * faded behind a dashed rim, with nothing to pick. A series' grid says it of all its sources, with
 * its own words for an aired one.
 */
export function GapCard({
  code,
  aired,
  tmdb,
  missing,
}: {
  code: string;
  aired: boolean;
  tmdb: GuideEpisodeDto | null;
  /** The chip and the hint of an aired one, when not the address's. */
  missing?: { label: string; hint: string };
}) {
  const t = useT();
  const locale = useLocale();
  const { src: still, onError: onStillError } = useRetryingImage(tmdb?.stillUrl);
  const hint = aired ? (missing?.hint ?? t.add.notOnSiteHint(code)) : t.add.notAiredHint(code);
  const details = [
    tmdb?.airDate ? formatDate(tmdb.airDate, locale) : null,
    tmdb?.runtimeMin ? t.add.minutes(tmdb.runtimeMin) : null,
  ].filter((part) => part !== null);
  return (
    <article title={hint} className="flex h-full flex-col gap-3 rounded-[23px] p-2 opacity-60">
      <div className="relative aspect-video overflow-hidden rounded-[15px] border-2 border-dashed border-foreground/20 bg-white/30">
        {still ? (
          <img
            src={still}
            alt=""
            loading="lazy"
            onError={onStillError}
            className="size-full object-cover grayscale"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex size-full flex-col items-center justify-center gap-1 text-foreground/40"
          >
            <HugeiconsIcon icon={Video01Icon} className="size-8" />
          </div>
        )}
        <div className="absolute top-2 left-2">
          <span className={cn(CHIP, "bg-black/45 font-mono text-white")}>{code}</span>
        </div>
        <div className="absolute inset-x-2 bottom-2 flex">
          <span
            className={cn(CHIP, aired ? "bg-warning/90 text-white" : "bg-white/90 text-foreground")}
          >
            <HugeiconsIcon icon={aired ? Alert02Icon : Clock01Icon} className="size-3.5" />
            {aired ? (missing?.label ?? t.add.notOnSite) : t.add.notAired}
          </span>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1 px-2 pb-1.5">
        <h3 className="truncate font-medium">{tmdb?.name || code}</h3>
        {details.length > 0 && (
          <p className="truncate text-xs text-muted-foreground tabular-nums">
            {details.join(" · ")}
          </p>
        )}
      </div>
    </article>
  );
}
