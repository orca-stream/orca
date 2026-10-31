import type {
  ExtractorDto,
  GuideEpisodeDto,
  PreviewDto,
  SeriesDto,
  ShowLookupDto,
} from "@orca/hm-contract";
import { TMDB_ID_PATTERN } from "@orca/hm-contract/rules";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useLocation, useSearch, useSearchParams } from "wouter";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  Cancel01Icon,
  Calendar03Icon,
  Download04Icon,
  Film01Icon,
  Folder01Icon,
  Layers01Icon,
  PlayListIcon,
  FolderAddIcon,
  FolderCheckIcon,
  Link01Icon,
  RotateLeft01Icon,
  RssIcon,
  Search01Icon,
  TextFontIcon,
  Tick02Icon,
  Tv01Icon,
} from "@hugeicons/core-free-icons";
import { ApiError } from "@/api/client";
import { useApi } from "@/api/context";
import { useMutations } from "@/api/mutations";
import { posterUrl, queries } from "@/api/queries";
import { Dock, DockButton, DockExtractors, DockPlaces, DockSeparator } from "@/components/dock";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { ExtractorMark } from "@/extractors/ExtractorMark";
import { useDebounced } from "@/hooks/use-debounced";
import { useElementHeight } from "@/hooks/use-element-height";
import { useLocale, useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import type { Messages } from "@/i18n/messages";
import { BAR_POPUP, BAR_ROW, BarField, BarPicker, BarToggle, ErrorHint, GLASS_PANEL } from "./bar";
import { EpisodeGrid } from "./EpisodeGrid";
import {
  canConfirm,
  clashingCodes,
  digitsOf,
  episodeCode,
  guideKey,
  initialForm,
  invalidFields,
  jellyfinShowOf,
  jellyfinTarget,
  matchExtractor,
  nextEpisode,
  numberer,
  parseSeason,
  shortRanges,
  toCreateBody,
  type PreviewForm,
} from "./preview-form";
import { ShowBackdrop } from "./ShowBackdrop";
import { ShowCard, ShowHoverCard, type ShowCardData } from "./ShowCard";

/** How long the TMDB id has to stay put before it is looked up. */
const LOOKUP_DELAY_MS = 500;

/** The fields a TMDB lookup fills in, unless they were typed by hand. */
type LookupField = "title" | "year" | "imdbId";

/** Where the address goes: a series that exists, or a show Jellyfin has (`jellyfinTarget`). */
interface AddTarget {
  value: string;
  /** The title alone, what the row shows and is searched by; the year goes beside it, dimmed. */
  label: string;
  year: number | null;
  /** The title with its year, for the sentences that name it. */
  name: string;
  /** A show of Jellyfin's that this server takes over when the address is added to it. */
  inJellyfin: boolean;
  tmdbId: string | null;
  imdbId: string | null;
  /** The series itself, when it is one of this server's. */
  series: SeriesDto | null;
}

const nameOf = (show: { title: string; year: number | null }) =>
  show.year === null ? show.title : `${show.title} (${show.year})`;

function previewError(error: unknown, t: Messages): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return t.errors.network;
    if (error.status === 400) return t.add.unsupported;
    if (error.status === 404) return t.add.notFound;
    if (error.status === 422) return t.add.noEpisodes;
    if (error.status === 502) return t.add.upstream;
  }
  return t.add.previewFailed;
}

function lookupError(error: unknown, t: Messages): string {
  return error instanceof ApiError && error.status === 404
    ? t.add.tmdbNotFound
    : t.add.tmdbLookupFailed;
}

/** The reason in the panel's language, and the server's own detail when it said which clash. */
function createError(error: unknown, t: Messages): { sentence: string; detail: string | null } {
  if (error instanceof ApiError) {
    if (error.status === 0) return { sentence: t.errors.network, detail: null };
    if (error.status === 409) {
      return {
        sentence: t.add.alreadyAdded,
        detail: error.message === error.code ? null : error.message,
      };
    }
  }
  return { sentence: t.add.createFailed, detail: null };
}

/**
 * Inside the address, on the left: the mark of the extractor that will read it, as you type, and
 * its name on hover. Faded while it is only the hint; a plain link icon when no extractor knows the
 * address yet.
 */
function ExtractorIndicator({
  extractor,
  faded,
}: {
  extractor: ExtractorDto | null;
  faded: boolean;
}) {
  const t = useT();
  if (!extractor) {
    return (
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-full bg-white/90 text-muted-foreground shadow-xs ring-1 ring-black/5"
      >
        <HugeiconsIcon icon={Link01Icon} className="size-5" />
      </span>
    );
  }
  // The icon alone keeps the address wide; the name slides out over it on hover.
  return (
    <span role="status" className="group/reader relative block size-10">
      <span
        className={cn(
          // Always on its white rim, so the gap to the edge of the address reads the same all round.
          "absolute top-0 left-0 z-10 flex h-10 items-center rounded-full bg-white/90 p-1 shadow-xs ring-1 ring-black/5 transition-all duration-300 ease-out",
          "group-hover/reader:pr-3 group-hover/reader:shadow-md",
          faded && "opacity-60 group-hover/reader:opacity-100",
        )}
      >
        <ExtractorMark
          extractor={extractor}
          className="size-8 rounded-full"
          iconClassName="size-4"
        />
        <span
          aria-hidden="true"
          className="max-w-0 overflow-hidden text-sm font-medium whitespace-nowrap text-foreground opacity-0 transition-all duration-300 ease-out group-hover/reader:ml-2 group-hover/reader:max-w-48 group-hover/reader:opacity-100"
        >
          {extractor.name}
        </span>
      </span>
      <span className="sr-only">{t.add.matches(extractor.name)}</span>
    </span>
  );
}

/** Whether the address is one a site could answer: http(s) with a host, the only kind a preview reads. */
function isWebAddress(text: string): boolean {
  try {
    const { protocol, hostname } = new URL(text);
    return (protocol === "https:" || protocol === "http:") && hostname !== "";
  } catch {
    return false;
  }
}

/**
 * Adding a series. Starting over, or coming in again from an extractor's shortcut, mounts it afresh:
 * the address, what was read and every field go back to how they start.
 */
export function AddSeriesScreen() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const [round, setRound] = useState(0);
  return (
    <AddSeries
      key={`${round}?${search}`}
      onStartOver={() => {
        navigate("/series/new");
        setRound((n) => n + 1);
      }}
    />
  );
}

function AddSeries({ onStartOver }: { onStartOver: () => void }) {
  const t = useT();
  const api = useApi();
  const [params] = useSearchParams();
  const [, navigate] = useLocation();
  const { preview: previewMutation, createSeries } = useMutations();
  const extractors = useQuery(queries.extractors(api));
  const seriesList = useQuery(queries.seriesList(api));

  const [url, setUrl] = useState(params.get("url") ?? "");
  // "" lets the address pick the extractor; an id is a choice among the ones that never match by address.
  const [chosenId, setChosenId] = useState(params.get("extractor") ?? "");
  const [preview, setPreview] = useState<PreviewDto | null>(null);
  const [form, setForm] = useState<PreviewForm | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Set when Preview is pressed on something that is not a web address; typing again clears it.
  const [urlInvalid, setUrlInvalid] = useState(false);
  const urlErrorId = useId();
  // What is wrong with the address: not one at all, or what the server said reading it.
  const urlError = urlInvalid
    ? t.add.urlInvalid
    : previewMutation.isError
      ? previewError(previewMutation.error, t)
      : undefined;
  // What was typed by hand: a TMDB lookup fills in the rest (and whatever was emptied), and replaces
  // what the site or an earlier lookup put there.
  const [edited, setEdited] = useState<ReadonlySet<LookupField>>(new Set());
  // The list of where the address goes drops from the address and itself, not from the fields below.
  const head = useRef<HTMLDivElement>(null);
  const [columnRef, columnHeight] = useElementHeight<HTMLDivElement>();

  // The series "Add another source" came from, if any: the address goes to it once read.
  const intoSeries = seriesList.data?.find((series) => series.id === params.get("into")) ?? null;
  const explicit = (extractors.data ?? []).filter((extractor) => extractor.explicit);
  // The extractor "Try it" came from: its example is the hint, never a value to erase first.
  const hinted = extractors.data?.find((extractor) => extractor.id === params.get("extractor"));
  const chosen = explicit.find((extractor) => extractor.id === chosenId) ?? null;
  const extractorId = chosen?.id;
  const matched = extractors.data && !chosen ? matchExtractor(url, extractors.data) : null;
  const urlFilled = url.trim() !== "";
  // Who will read the address: the one picked by hand, the one it matches, or the one hinted at.
  const reader = chosen ?? matched ?? (urlFilled ? null : hinted) ?? null;
  const showChoice =
    explicit.length > 0 && (chosen !== null || (urlFilled && extractors.isSuccess && !matched));

  function runPreview(event?: FormEvent) {
    event?.preventDefault();
    if (!urlFilled || previewMutation.isPending) return;
    if (!isWebAddress(url.trim())) {
      setUrlInvalid(true);
      return;
    }
    setNotice(null);
    createSeries.reset();
    previewMutation.mutate(
      { url: url.trim(), ...(extractorId ? { extractorId } : {}) },
      {
        onSuccess: (next) => {
          setPreview(next);
          setForm({ ...initialForm(next), ...(intoSeries ? { addTo: intoSeries.id } : {}) });
          setEdited(new Set());
          // A lookup answered for an earlier preview comes back from the cache as the same object:
          // forgotten here, it fills in this one too.
          setAppliedShow(null);
        },
      },
    );
  }

  function confirm() {
    if (!preview || !form) return;
    setNotice(null);
    createSeries.mutate(toCreateBody(preview, form), {
      onSuccess: (series) => navigate(`/series/${encodeURIComponent(series.id)}`),
      onError: (error) => {
        // Previews are kept for a short while only: read the address again, keeping the edits.
        if (error instanceof ApiError && error.status === 410) {
          previewMutation.mutate(
            { url: url.trim(), ...(extractorId ? { extractorId } : {}) },
            {
              onSuccess: (next) => {
                const known = new Set(next.episodes.map((episode) => episode.key));
                setPreview(next);
                setForm((current) =>
                  current
                    ? { ...current, included: current.included.filter((key) => known.has(key)) }
                    : initialForm(next),
                );
                setNotice(t.add.expired);
              },
            },
          );
        }
      },
    });
  }

  const gone = createSeries.error instanceof ApiError && createSeries.error.status === 410;
  const failure = createSeries.isError && !gone ? createError(createSeries.error, t) : null;
  // Once the address is read, where it goes hangs under it, as the lower half of the same bar.
  const attached = preview !== null && form !== null;
  // A new series asks for its name and ids right there, as the bar's last part.
  const asksNew = attached && form.addTo === "";
  const invalid = form ? invalidFields(form) : new Set<string>();

  // The TMDB id of a new series, looked up once it stops changing and only while it is still the one shown.
  const typedTmdbId = asksNew ? form.tmdbId.trim() : "";
  const settledTmdbId = useDebounced(typedTmdbId, LOOKUP_DELAY_MS);
  const lookupId =
    settledTmdbId === typedTmdbId && TMDB_ID_PATTERN.test(settledTmdbId) ? settledTmdbId : "";
  const lookup = useQuery({ ...queries.showLookup(api, lookupId), enabled: lookupId !== "" });
  // Each answer is applied once, while rendering (not in an effect), and only to the id still shown.
  const [appliedShow, setAppliedShow] = useState<ShowLookupDto | null>(null);
  if (lookup.data && lookup.data !== appliedShow) {
    const show = lookup.data;
    setAppliedShow(show);
    if (form && form.tmdbId.trim() === show.tmdbId) {
      // What was typed by hand stays, unless it was emptied: an empty field is always filled in.
      const fills = (field: LookupField) => !edited.has(field) || form[field].trim() === "";
      setForm({
        ...form,
        ...(fills("title") ? { title: show.title } : {}),
        ...(fills("year") ? { year: show.year === null ? "" : String(show.year) } : {}),
        ...(fills("imdbId") ? { imdbId: show.imdbId ?? "" } : {}),
      });
    }
  }
  const typedBy = (field: LookupField) => setEdited((fields) => new Set(fields).add(field));
  const tmdbError = invalid.has("tmdbId")
    ? t.add.tmdbInvalid
    : lookupId !== "" && lookup.isError
      ? lookupError(lookup.error, t)
      : undefined;
  // Asked once the address is read: without Jellyfin, only this server's own series are offered.
  const libraryShows = useQuery({ ...queries.libraryShows(api), enabled: attached });
  // The series that exist, then the shows Jellyfin has that none of them is: left empty, the
  // address makes a new series.
  const targets: AddTarget[] = [
    ...(seriesList.data ?? []).map((series) => ({
      value: series.id,
      label: series.title,
      year: series.year,
      name: nameOf(series),
      inJellyfin: false,
      tmdbId: series.tmdbId,
      imdbId: series.imdbId,
      series,
    })),
    ...(libraryShows.data ?? [])
      .filter((show) => show.seriesId === null && show.adoptable)
      .map((show) => ({
        value: jellyfinTarget(show.id),
        label: show.title,
        year: show.year,
        name: nameOf(show),
        inJellyfin: true,
        tmdbId: show.tmdbId,
        imdbId: show.imdbId,
        series: null,
      })),
  ];
  // A new series with the TMDB or IMDb id of one there already is: offered instead of a duplicate.
  const typedImdbId = asksNew ? form.imdbId.trim() : "";
  const twin = asksNew
    ? (targets.find(
        (target) =>
          (typedTmdbId !== "" && target.tmdbId === typedTmdbId) ||
          (typedImdbId !== "" && target.imdbId === typedImdbId),
      ) ?? null)
    : null;
  // Set aside by hand, it stays aside until another one matches.
  const [dismissedTwin, setDismissedTwin] = useState<string | null>(null);
  const offer = twin && twin.value !== dismissedTwin ? twin : null;

  // The numbering picks from TMDB's seasons and episodes when the show has a TMDB id and the server
  // a TMDB key; otherwise (or until they come) the numbers are typed.
  const locale = useLocale();
  const chosenTarget =
    attached && !asksNew ? targets.find((target) => target.value === form.addTo) : undefined;
  const guideTmdbId = asksNew ? lookupId : (chosenTarget?.tmdbId ?? "");
  const guide = useQuery({
    ...queries.guideSeasons(api, guideTmdbId, locale),
    enabled: guideTmdbId !== "",
  });
  const guided = guideTmdbId !== "" && guide.isSuccess && guide.data.length > 0;
  // The season the first episode is picked in: the one chosen, or the site's own.
  const siteSeason = preview
    ? Math.min(...preview.episodes.map((episode) => episode.season))
    : null;
  // What the empty pickers amount to, shown as picked: the site's season (when the address has
  // only one) and its lowest episode number.
  const siteSeasons = new Set(preview?.episodes.map((episode) => episode.season));
  const oneSiteSeason =
    siteSeasons.size === 1 && siteSeason !== null ? String(siteSeason) : undefined;
  const siteFirstEpisode =
    preview && preview.episodes.length > 0
      ? String(Math.min(...preview.episodes.map((episode) => episode.episode)))
      : undefined;
  const typedSeason = form ? parseSeason(form.season) : null;
  const pickSeason = typedSeason === "invalid" ? null : (typedSeason ?? siteSeason);
  const guideEpisodes = useQuery({
    ...queries.guideEpisodes(api, guideTmdbId, pickSeason ?? 0, locale),
    enabled: guided && pickSeason !== null,
  });
  const episodesGuided = guided && guideEpisodes.isSuccess && guideEpisodes.data.length > 0;
  // The card of the series it goes to, or of the one the TMDB id names: this server's own words
  // first, then TMDB's (asked through Jellyfin, and cached, so hovering costs nothing twice).
  const [listOpen, setListOpen] = useState(false);
  const cardTmdbId = asksNew ? lookupId : (chosenTarget?.tmdbId ?? "");
  const cardLookup = useQuery({
    ...queries.showLookup(api, cardTmdbId),
    enabled: cardTmdbId !== "",
  });
  const tmdbShow =
    cardTmdbId !== "" && cardLookup.data?.tmdbId === cardTmdbId ? cardLookup.data : null;
  const seasonCount = guided
    ? (guide.data ?? []).filter((season) => season.number > 0).length || null
    : null;
  const targetCard: ShowCardData | null = chosenTarget
    ? {
        title: chosenTarget.label,
        year: chosenTarget.year,
        overview: chosenTarget.series?.plot ?? tmdbShow?.overview ?? null,
        posterUrl: chosenTarget.series?.hasPoster
          ? posterUrl(chosenTarget.series.id)
          : (tmdbShow?.posterUrl ?? null),
        tmdbId: chosenTarget.tmdbId,
        imdbId: chosenTarget.imdbId,
        seasons: seasonCount,
        episodes: chosenTarget.series
          ? {
              available: chosenTarget.series.availableCount,
              total: chosenTarget.series.episodeCount,
            }
          : null,
        inJellyfin: chosenTarget.inJellyfin,
      }
    : null;
  // The series the address goes into, on the preview button: its own cover, else TMDB's. Before
  // the reading, the one that sent you here; after it, the one chosen. A new series has none.
  const intoLookupId =
    !attached && intoSeries && !intoSeries.hasPoster ? (intoSeries.tmdbId ?? "") : "";
  const intoLookup = useQuery({
    ...queries.showLookup(api, intoLookupId),
    enabled: intoLookupId !== "",
  });
  const goesInto: { title: string; cover: string | null } | null = attached
    ? targetCard && { title: targetCard.title, cover: targetCard.posterUrl }
    : intoSeries && {
        title: intoSeries.title,
        cover: intoSeries.hasPoster
          ? posterUrl(intoSeries.id)
          : intoLookupId !== "" && intoLookup.data?.tmdbId === intoLookupId
            ? intoLookup.data.posterUrl
            : null,
      };

  const tmdbCard: ShowCardData | null =
    asksNew && tmdbShow
      ? {
          title: tmdbShow.title,
          year: tmdbShow.year,
          overview: tmdbShow.overview,
          posterUrl: tmdbShow.posterUrl,
          tmdbId: tmdbShow.tmdbId,
          imdbId: tmdbShow.imdbId,
          seasons: seasonCount,
          episodes: null,
          inJellyfin: false,
        }
      : null;
  // Beside the episodes, what is known of the show: where it goes, what TMDB says, or the site.
  const sideCard: { caption: string; show: ShowCardData } | null = targetCard
    ? { caption: t.add.cardGoesTo, show: targetCard }
    : tmdbCard
      ? { caption: t.add.cardFromTmdb, show: tmdbCard }
      : preview && asksNew
        ? {
            caption: t.add.cardFromSite,
            show: {
              title: preview.series.title,
              year: preview.series.year,
              overview: preview.series.plot,
              posterUrl: preview.posterUrl,
              tmdbId: null,
              imdbId: null,
              seasons: preview.seasons.length || null,
              episodes: null,
              inJellyfin: false,
            },
          }
        : null;
  // Once TMDB has said which show it is, the show fills the background behind the glass.
  const backdrop = tmdbShow
    ? tmdbShow.backdropUrl
      ? { src: tmdbShow.backdropUrl, poster: false }
      : { src: sideCard?.show.posterUrl ?? tmdbShow.posterUrl, poster: true }
    : null;
  // TMDB's episodes wherever the address's land (one season, or several when the site has more),
  // for their frames and names in the grid.
  const landing = preview && form ? numberer(preview, form) : null;
  const guideSeasonNumbers = new Set((guide.data ?? []).map((season) => season.number));
  const landedSeasons =
    guided && preview && landing && invalid.size === 0
      ? [...new Set(preview.episodes.map((episode) => landing(episode).season))]
      : [];
  const landingSeasons = landedSeasons.filter((season) => guideSeasonNumbers.has(season));
  const landingGuides = useQueries({
    queries: landingSeasons.map((season) =>
      queries.guideEpisodes(api, guideTmdbId, season, locale),
    ),
  });
  const stills = new Map(
    landingSeasons.flatMap((season, index) =>
      (landingGuides[index]?.data ?? []).map(
        (episode) => [guideKey(season, episode.number), episode] as const,
      ),
    ),
  );
  // Each season it lands in as TMDB lists it, once known, to compare with the address: empty for
  // one TMDB doesn't have.
  const guideSeasons = new Map<number, GuideEpisodeDto[]>([
    ...landedSeasons
      .filter((season) => !guideSeasonNumbers.has(season))
      .map((season) => [season, []] as [number, GuideEpisodeDto[]]),
    ...landingSeasons.flatMap((season, index) => {
      const data = landingGuides[index]?.data;
      return data ? [[season, data] as [number, GuideEpisodeDto[]]] : [];
    }),
  ]);
  // What the series it goes to already has, so a clash shows on its card and blocks adding.
  const targetSeriesId = chosenTarget?.series?.id ?? "";
  const targetEpisodes = useQuery({
    ...queries.episodes(api, targetSeriesId),
    enabled: targetSeriesId !== "",
  });
  // Adding to a series that has the season already, the numbering starts after its last episode
  // there — unless TMDB says the season has no more; applied while rendering, and replaced only
  // while nobody has picked another number. It waits for TMDB's seasons too, so a length that comes
  // late doesn't leave a continuation past the season's end standing.
  const seasonLength = guided
    ? guide.data.find((season) => season.number === pickSeason)?.episodeCount
    : undefined;
  const continuesAt =
    targetEpisodes.isSuccess && pickSeason !== null
      ? nextEpisode(targetEpisodes.data, pickSeason, seasonLength)
      : null;
  const continueKey =
    (targetSeriesId === "" || targetEpisodes.isSuccess) && (guideTmdbId === "" || !guide.isPending)
      ? `${targetSeriesId}:${pickSeason ?? ""}:${seasonLength ?? ""}`
      : null;
  const [continued, setContinued] = useState<{ key: string; value: string } | null>(null);
  if (form && continueKey !== null && continueKey !== continued?.key) {
    const value = continuesAt === null ? "" : String(continuesAt);
    const previous = continued?.value;
    setContinued({ key: continueKey, value });
    // From the form as it stands then: one rendered here can predate what the TMDB lookup filled.
    setForm((current) =>
      current &&
      current.firstEpisode !== value &&
      (current.firstEpisode === "" || current.firstEpisode === previous)
        ? { ...current, firstEpisode: value }
        : current,
    );
  }
  const taken = new Set(
    (targetEpisodes.data ?? []).map((episode) => episodeCode(episode.season, episode.episode)),
  );
  // A show of Jellyfin's keeps the episodes it has as files: those aren't downloaded again. So does
  // a series of this server's, for the files its folder has that it doesn't know of.
  const targetShowId = form
    ? (jellyfinShowOf(form.addTo) ??
      (libraryShows.data ?? []).find(
        (show) => targetSeriesId !== "" && show.seriesId === targetSeriesId,
      )?.id ??
      null)
    : null;
  const showEpisodes = useQuery({
    ...queries.libraryEpisodes(api, targetShowId ?? ""),
    enabled: targetShowId !== null,
  });
  const kept = new Set(
    targetShowId === null
      ? []
      : (showEpisodes.data ?? []).map((episode) => episodeCode(episode.season, episode.episode)),
  );
  const clashes =
    preview && form && targetSeriesId !== ""
      ? clashingCodes(preview, form, targetEpisodes.data ?? [])
      : [];
  // Until the target's episodes are known, clashes can't be ruled out.
  const ready =
    form !== null &&
    canConfirm(form, clashes) &&
    (targetSeriesId === "" || targetEpisodes.isSuccess);
  const blocker = !form
    ? null
    : asksNew && form.title.trim() === ""
      ? t.add.needsTitle
      : form.included.length === 0
        ? t.add.needsEpisodes
        : clashes.length > 0
          ? t.add.clashes(clashes.join(", "))
          : null;
  // Following belongs to the series: one that exists keeps its own setting.
  const asksFollow = asksNew || chosenTarget?.inJellyfin === true;

  const numbered =
    preview && form && invalid.size === 0
      ? shortRanges(
          preview.episodes
            .filter((episode) => form.included.includes(episode.key))
            .map(numberer(preview, form)),
        )
      : "";

  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-4",
        // Once read: the bar on the left, the episodes on the right, each taking half the width.
        attached ? "xl:grid xl:grid-cols-2 xl:items-start xl:gap-4" : "max-w-5xl",
      )}
    >
      <ShowBackdrop src={backdrop?.src ?? null} poster={backdrop?.poster} />
      {/* Just the address for now: the title and its label are there for screen readers only. */}
      <h1 className="sr-only">{t.add.title}</h1>

      {/* The bar stays in sight beside a long list. Taller than the window, it scrolls with the page
          until its end shows and sticks there, as a series' page does with its own. */}
      <div
        ref={columnRef}
        style={{ "--panel-h": `${columnHeight}px` } as CSSProperties}
        className={cn(
          "flex min-w-0 flex-col gap-4",
          attached && "xl:sticky xl:top-[min(1rem,calc(100svh-var(--panel-h)-1rem))]",
        )}
      >
        {/* The address floats as it is while the page scrolls, always clear of the window's top. */}
        <form
          noValidate
          onSubmit={runPreview}
          className={cn(
            "z-20 mx-auto w-full",
            attached ? "max-w-3xl xl:max-w-none" : "sticky top-8 max-w-3xl",
          )}
        >
          <FieldLabel htmlFor="series-url" className="sr-only">
            {t.add.url}
          </FieldLabel>
          {/* The rim and the shadow are the whole bar's: the address alone, or with where it goes. */}
          <div className={cn(GLASS_PANEL, urlError && "border-destructive/40")}>
            <div ref={head}>
              <InputGroup
                className={cn(
                  "h-18 rounded-[35px] border-0 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/30",
                  attached &&
                    "rounded-b-none has-[[data-slot=input-group-control]:focus-visible]:bg-white/45 has-[[data-slot=input-group-control]:focus-visible]:ring-0",
                )}
              >
                <InputGroupInput
                  id="series-url"
                  name="url"
                  type="url"
                  inputMode="url"
                  placeholder={hinted?.example ?? t.add.urlPlaceholder}
                  autoFocus
                  value={url}
                  aria-invalid={urlError ? true : undefined}
                  aria-describedby={urlError ? urlErrorId : undefined}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    setUrlInvalid(false);
                    if (previewMutation.isError) previewMutation.reset();
                  }}
                  className="h-full pl-4! text-base md:text-lg"
                />
                <InputGroupAddon align="inline-start" className="cursor-default pl-[15px]">
                  {urlError ? (
                    <ErrorHint
                      error={urlError}
                      className="size-10 bg-white/90 shadow-xs ring-1 ring-destructive/20 hover:bg-white [&_svg]:size-5"
                    />
                  ) : (
                    <ExtractorIndicator extractor={reader} faded={!urlFilled} />
                  )}
                  {urlError && (
                    <span id={urlErrorId} role="alert" className="sr-only">
                      {urlError}
                    </span>
                  )}
                </InputGroupAddon>
                <InputGroupAddon align="inline-end" className="pr-[15px] has-[>button]:mr-0">
                  {/* A circle that keeps the address wide; into an existing series it is that
                      series' cover, and its name slides out leftwards on hover, like the reader's. */}
                  <span className="group/preview relative block size-10">
                    <InputGroupButton
                      type="submit"
                      variant="default"
                      aria-label={
                        previewMutation.isPending
                          ? t.add.previewing
                          : goesInto
                            ? t.add.previewInto(goesInto.title)
                            : t.add.preview
                      }
                      className={cn(
                        "absolute top-0 right-0 z-10 h-10 w-auto gap-0 rounded-full p-0 shadow-md shadow-primary/30 transition-all duration-300 ease-out",
                        goesInto && "p-1 group-hover/preview:pl-3",
                      )}
                      disabled={!urlFilled || previewMutation.isPending}
                      aria-busy={previewMutation.isPending || undefined}
                    >
                      {goesInto && (
                        <span
                          aria-hidden="true"
                          className="max-w-0 overflow-hidden text-sm font-medium whitespace-nowrap opacity-0 transition-all duration-300 ease-out group-hover/preview:mr-2 group-hover/preview:max-w-48 group-hover/preview:opacity-100"
                        >
                          {goesInto.title}
                        </span>
                      )}
                      <span
                        className={cn(
                          "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full",
                          goesInto ? "size-8 bg-white/20" : "size-10",
                        )}
                      >
                        {previewMutation.isPending ? (
                          <Spinner aria-hidden="true" className="size-6" />
                        ) : goesInto?.cover ? (
                          <img src={goesInto.cover} alt="" className="size-full object-cover" />
                        ) : (
                          // The magnifier only for a new series; an existing one without a cover
                          // keeps a folder in its place.
                          <HugeiconsIcon
                            icon={goesInto ? FolderCheckIcon : Search01Icon}
                            className="size-6"
                          />
                        )}
                      </span>
                    </InputGroupButton>
                  </span>
                </InputGroupAddon>
              </InputGroup>
              {attached && offer && (
                // The series this one already is, offered in place of the list: the whole row says
                // it, and the two buttons at its end take it or set it aside.
                <div className="flex h-14 items-center gap-2 border-t border-t-(--glass-edge) bg-primary/5 pr-4">
                  {/* No gap after the icon: the text then starts where the other rows' inputs do. */}
                  <span className="flex w-[46px] shrink-0 justify-start pl-4 text-primary">
                    <HugeiconsIcon icon={FolderCheckIcon} className="size-5" />
                  </span>
                  <p role="status" className="min-w-0 flex-1 truncate pr-2 pl-1.5 text-base">
                    <span className="sr-only">{t.add.alreadyHave(offer.name)}</span>
                    <span aria-hidden="true" title={t.add.alreadyHave(offer.name)}>
                      <span className="text-muted-foreground">{t.add.alreadyYours} </span>
                      <span className="font-medium">{offer.name}</span>
                    </span>
                  </p>
                  <button
                    type="button"
                    aria-label={t.add.dismissTwin}
                    title={t.add.dismissTwin}
                    onClick={() => setDismissedTwin(offer.value)}
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/70 text-muted-foreground ring-1 ring-black/5 transition-colors hover:bg-destructive/10 hover:text-destructive hover:ring-destructive/20 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} className="size-4.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t.add.addToIt}
                    title={t.add.addToIt}
                    onClick={() => setForm({ ...form, addTo: offer.value })}
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs transition-colors hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
                  >
                    <HugeiconsIcon icon={Tick02Icon} className="size-5" />
                  </button>
                </div>
              )}
              {attached && !offer && (
                <Combobox
                  items={targets}
                  value={targets.find((item) => item.value === form.addTo) ?? null}
                  onValueChange={(item) => setForm({ ...form, addTo: item?.value ?? "" })}
                  isItemEqualToValue={(item, value) => item.value === value.value}
                  onOpenChange={setListOpen}
                >
                  <ShowHoverCard show={targetCard} quiet={listOpen}>
                    <ComboboxInput
                      id="add-to"
                      aria-label={t.add.addTo}
                      placeholder={t.add.addToSearch}
                      showClear={form.addTo !== ""}
                      className={cn(
                        BAR_ROW,
                        "w-full rounded-none border-t border-t-(--glass-edge) pr-4 [&_input]:text-base",
                      )}
                    >
                      {/* In the indicator's column above, so both texts start at the same place. */}
                      <InputGroupAddon align="inline-start" className="w-[46px] justify-start pl-4">
                        <HugeiconsIcon
                          icon={form.addTo === "" ? FolderAddIcon : Folder01Icon}
                          className="size-5"
                        />
                      </InputGroupAddon>
                      {/* Dimmed beside the title, the way the lists below give their details. */}
                      {chosenTarget && chosenTarget.year !== null && !listOpen && (
                        <InputGroupAddon
                          align="inline-end"
                          aria-hidden="true"
                          className="order-[9998] pr-1 text-sm text-muted-foreground tabular-nums"
                        >
                          {chosenTarget.year}
                        </InputGroupAddon>
                      )}
                    </ComboboxInput>
                  </ShowHoverCard>
                  <ComboboxContent anchor={head} sideOffset={8} className={BAR_POPUP}>
                    <ComboboxEmpty>{t.add.addToNone}</ComboboxEmpty>
                    <ComboboxList>
                      {(item: AddTarget) => (
                        <ComboboxItem
                          key={item.value}
                          value={item}
                          className="rounded-xl py-2 pl-3 text-base"
                        >
                          <span className="min-w-0 truncate">{item.label}</span>
                          {(item.year !== null || item.inJellyfin) && (
                            <span className="ml-auto shrink-0 pl-6 text-sm text-muted-foreground tabular-nums">
                              {[item.year, item.inJellyfin ? t.add.inJellyfin : null]
                                .filter((part) => part !== null)
                                .join(" · ")}
                            </span>
                          )}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              )}
            </div>
            {attached && (
              <div className="overflow-hidden rounded-b-[35px] [&>*]:border-t [&>*]:border-t-(--glass-edge)">
                {asksNew && (
                  <>
                    <div className="flex">
                      <BarField
                        icon={TextFontIcon}
                        label={t.add.fieldTitle}
                        placeholder={t.add.titlePlaceholder}
                        value={form.title}
                        onChange={(event) => {
                          typedBy("title");
                          setForm({ ...form, title: event.target.value });
                        }}
                      />
                      <BarField
                        icon={Calendar03Icon}
                        label={t.add.fieldYear}
                        placeholder={t.add.yearPlaceholder}
                        inputMode="numeric"
                        maxLength={4}
                        error={invalid.has("year") ? t.add.yearInvalid : undefined}
                        value={form.year}
                        onChange={(event) => {
                          typedBy("year");
                          setForm({ ...form, year: digitsOf(event.target.value) });
                        }}
                        className="w-48 shrink-0 border-l border-l-(--glass-edge)"
                      />
                    </div>
                    <div className="grid grid-cols-2">
                      <ShowHoverCard show={tmdbCard} className="min-w-0">
                        <BarField
                          icon={Film01Icon}
                          label={t.add.tmdbId}
                          placeholder={t.add.tmdbPlaceholder}
                          inputMode="numeric"
                          error={tmdbError}
                          busy={lookup.isFetching ? t.add.tmdbLooking : undefined}
                          value={form.tmdbId}
                          onChange={(event) => {
                            // Whatever the id settles on is applied again, even an answer seen before.
                            setAppliedShow(null);
                            setForm({ ...form, tmdbId: digitsOf(event.target.value) });
                          }}
                        />
                      </ShowHoverCard>
                      <BarField
                        icon={Tv01Icon}
                        label={t.add.imdbId}
                        placeholder={t.add.imdbPlaceholder}
                        error={invalid.has("imdbId") ? t.add.imdbInvalid : undefined}
                        value={form.imdbId}
                        onChange={(event) => {
                          typedBy("imdbId");
                          setForm({ ...form, imdbId: event.target.value });
                        }}
                        className="border-l border-l-(--glass-edge)"
                      />
                    </div>
                  </>
                )}
                <div className="flex">
                  {guided ? (
                    <BarPicker
                      icon={Layers01Icon}
                      label={t.add.season}
                      placeholder={t.add.seasonPlaceholder(siteSeason)}
                      items={(guide.data ?? []).map((season) => ({
                        value: String(season.number),
                        label: t.add.seasonOption(season.number),
                        detail: t.add.seasonDetail(season.episodeCount, season.year),
                      }))}
                      value={form.season}
                      fallback={oneSiteSeason}
                      onChange={(season) => {
                        // Picking the season it already has changes nothing.
                        if (season !== form.season) setForm({ ...form, season, firstEpisode: "" });
                      }}
                      className="w-1/2 shrink-0"
                    />
                  ) : (
                    <BarField
                      icon={Layers01Icon}
                      label={t.add.season}
                      placeholder={t.add.seasonPlaceholder(siteSeason)}
                      inputMode="numeric"
                      maxLength={3}
                      busy={guide.isFetching ? t.add.guideSeasonsLoading : undefined}
                      error={invalid.has("season") ? t.add.countInvalid : undefined}
                      value={form.season}
                      onChange={(event) =>
                        setForm({ ...form, season: digitsOf(event.target.value) })
                      }
                      className="w-1/2 shrink-0"
                    />
                  )}
                  {episodesGuided ? (
                    <BarPicker
                      icon={PlayListIcon}
                      label={t.add.firstEpisode}
                      placeholder={t.add.firstEpisode}
                      items={(guideEpisodes.data ?? []).map((episode) => ({
                        value: String(episode.number),
                        label: t.add.episodeOption(episode.number, episode.name),
                      }))}
                      value={form.firstEpisode}
                      fallback={siteFirstEpisode}
                      onChange={(firstEpisode) => setForm({ ...form, firstEpisode })}
                      busy={guideEpisodes.isFetching ? t.add.guideEpisodesLoading : undefined}
                      className="border-l border-l-(--glass-edge)"
                    />
                  ) : (
                    <BarField
                      icon={PlayListIcon}
                      label={t.add.firstEpisode}
                      placeholder={t.add.firstEpisodePlaceholder}
                      inputMode="numeric"
                      maxLength={4}
                      busy={guideEpisodes.isFetching ? t.add.guideEpisodesLoading : undefined}
                      error={invalid.has("firstEpisode") ? t.add.countInvalid : undefined}
                      value={form.firstEpisode}
                      onChange={(event) =>
                        setForm({ ...form, firstEpisode: digitsOf(event.target.value) })
                      }
                      className="border-l border-l-(--glass-edge)"
                    />
                  )}
                </div>
                <div className="flex">
                  {asksFollow && (
                    <BarToggle
                      icon={RssIcon}
                      label={t.add.followShort}
                      hint={t.add.followHint}
                      checked={form.follow}
                      onChange={(follow) => setForm({ ...form, follow })}
                      className="w-1/2 shrink-0 border-r border-r-(--glass-edge)"
                    />
                  )}
                  <BarToggle
                    icon={Download04Icon}
                    label={t.add.downloadNow}
                    hint={form.downloadNow ? t.add.downloadHint : t.add.downloadNowHint}
                    checked={form.downloadNow}
                    onChange={(downloadNow) => setForm({ ...form, downloadNow })}
                    className="flex-1"
                  />
                </div>
                {/* The bar ends the way it starts: what it will do, and the button that does it,
                    16px from the rim as Preview is. */}
                <div className="flex items-center gap-4 p-4">
                  <p
                    role={blocker ? "status" : undefined}
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      clashes.length > 0 ? "text-warning" : "text-muted-foreground",
                    )}
                    title={blocker ?? undefined}
                  >
                    {blocker ??
                      (numbered === "" ? null : t.add.readyToAdd(form.included.length, numbered))}
                  </p>
                  <button
                    type="button"
                    disabled={!ready || createSeries.isPending}
                    aria-busy={createSeries.isPending || undefined}
                    onClick={confirm}
                    className="flex h-14 shrink-0 items-center gap-2 rounded-full bg-primary px-6 text-base font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
                  >
                    {createSeries.isPending && <Spinner aria-hidden="true" />}
                    {createSeries.isPending ? t.add.confirming : t.add.confirm}
                  </button>
                </div>
              </div>
            )}
            {attached && sideCard && (
              // Wide screens only, as the bar's last part: there it fills the column; narrower, the
              // hover cards do.
              <section
                aria-label={sideCard.caption}
                className="hidden border-t border-t-(--glass-edge) p-4 text-sm xl:block"
              >
                <p className="mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {sideCard.caption}
                </p>
                <ShowCard show={sideCard.show} large />
              </section>
            )}
          </div>
        </form>

        <div
          className={cn(
            "-mt-3 mx-auto flex w-full flex-col gap-3 empty:hidden",
            attached ? "max-w-3xl xl:max-w-none" : "max-w-3xl",
          )}
        >
          {/* Only when the address alone can't pick an extractor, or one was picked by hand. */}
          {showChoice && (
            <Field className="px-4 sm:max-w-sm">
              <FieldLabel htmlFor="extractor-choice">{t.add.extractorChoice}</FieldLabel>
              <NativeSelect
                id="extractor-choice"
                className="w-full"
                value={chosen?.id ?? ""}
                onChange={(event) => setChosenId(event.target.value)}
              >
                <NativeSelectOption value="">{t.add.autoExtractor}</NativeSelectOption>
                {explicit.map((extractor) => (
                  <NativeSelectOption key={extractor.id} value={extractor.id}>
                    {extractor.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}
          {chosen && (
            <p role="status" className="px-4 text-sm text-warning">
              {t.add.usingExplicit(chosen.name)}
            </p>
          )}
        </div>

        {notice && (
          <Alert role="status" className="border-warning/40 bg-warning/8 text-warning">
            <HugeiconsIcon icon={Alert02Icon} />
            <AlertDescription className="text-warning">{notice}</AlertDescription>
          </Alert>
        )}
        {failure && (
          <p role="alert" className="text-sm text-warning">
            {failure.sentence}
            {failure.detail && (
              <span className="block text-xs text-muted-foreground">{failure.detail}</span>
            )}
          </p>
        )}
      </div>

      {attached && (
        <EpisodeGrid
          preview={preview}
          form={form}
          onChange={setForm}
          guide={stills}
          guideSeasons={guideSeasons}
          taken={taken}
          kept={kept}
        />
      )}
      <Dock label={t.dock.label}>
        <DockPlaces />
        <DockExtractors />
        {attached && (
          <>
            <DockSeparator />
            <DockButton label={t.dock.startOver} icon={RotateLeft01Icon} onClick={onStartOver} />
          </>
        )}
      </Dock>
    </div>
  );
}
