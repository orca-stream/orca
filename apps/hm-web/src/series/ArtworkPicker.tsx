import type {
  ArtworkKind,
  ArtworkOptionDto,
  ArtworkOptionsDto,
  SeriesDto,
  ShowLookupDto,
} from "@orca/hm-contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { type ReactElement, type RefObject, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowTurnBackwardIcon,
  Cancel01Icon,
  Tick02Icon,
  Upload04Icon,
} from "@hugeicons/core-free-icons";
import { ApiError } from "@/api/client";
import { useApi } from "@/api/context";
import { useMutations } from "@/api/mutations";
import { artworkUrl, queries } from "@/api/queries";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import {
  currentArtwork,
  fileOf,
  OWN,
  TMDB_DEFAULT,
  type DraftArtwork,
  type DraftArtworks,
} from "./artwork";
import { GLASS_PANEL, PILL_BUTTON, SECONDARY } from "./bar";

const KINDS: readonly ArtworkKind[] = ["poster", "backdrop", "logo"];

/** What a file input offers for each kind; the server checks the bytes either way. */
const ACCEPT: Record<ArtworkKind, string> = {
  poster: "image/jpeg,image/png,image/webp",
  backdrop: "image/jpeg,image/png,image/webp",
  logo: "image/png,image/webp",
};

/** How each kind's tiles are laid out: its own shape, and as many across as stay legible. */
const GRID: Record<ArtworkKind, { grid: string; tile: string }> = {
  poster: { grid: "grid-cols-3 sm:grid-cols-4 lg:grid-cols-5", tile: "aspect-[2/3]" },
  backdrop: { grid: "grid-cols-2 lg:grid-cols-3", tile: "aspect-video" },
  logo: { grid: "grid-cols-2 lg:grid-cols-3", tile: "aspect-[16/7]" },
};

/**
 * One image to choose: its picture, its language, and whether it is the one in use. A logo sits on
 * the series' backdrop, the way it shows in the banner.
 */
function Tile({
  kind,
  src,
  label,
  current,
  busy,
  disabled,
  behind,
  onPick,
}: {
  kind: ArtworkKind;
  src: string;
  label: string | null;
  current: boolean;
  busy: boolean;
  disabled: boolean;
  behind: string | null;
  onPick: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled || current}
      aria-pressed={current}
      className={cn(
        "group/tile relative overflow-hidden rounded-xl bg-secondary ring-1 ring-black/5 transition-shadow focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none enabled:hover:ring-2 enabled:hover:ring-primary/60 disabled:cursor-default",
        current && "ring-2 ring-primary",
        GRID[kind].tile,
      )}
    >
      {kind === "logo" && (
        <span aria-hidden="true" className="absolute inset-0 bg-zinc-700">
          {behind && (
            <img src={behind} alt="" className="size-full object-cover opacity-70 blur-[2px]" />
          )}
        </span>
      )}
      <img
        src={src}
        alt=""
        loading="lazy"
        className={cn(
          "relative size-full",
          kind === "logo" ? "object-contain p-4 drop-shadow-md" : "object-cover",
        )}
      />
      {label && (
        <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white uppercase backdrop-blur-sm">
          {label}
        </span>
      )}
      {current && (
        <span
          title={t.series.artwork.inUse}
          className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm"
        >
          <HugeiconsIcon icon={Tick02Icon} className="size-4" />
          <span className="sr-only">{t.series.artwork.inUse}</span>
        </span>
      )}
      {busy && (
        <span className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-[1px]">
          <Spinner className="size-6 text-primary" />
        </span>
      )}
    </button>
  );
}

/** What the picker shows of one kind: the TMDB file in use, and a picture of one's own in use. */
interface KindState {
  /** The file name of the TMDB image in use (`fileOf`), marked in the list; null for none of them. */
  inUse: string | null;
  /** An image in use that the list doesn't have (an upload), shown first; null when there is none. */
  ownSrc: string | null;
  /** Whether "Use TMDB's" undoes a choice of one's own. */
  resettable: boolean;
}

interface PickerFrame {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: ArtworkKind;
  onKindChange: (kind: ArtworkKind) => void;
  /** The button it opens from and sits beside. */
  trigger: ReactElement;
  /** What it opens beside: the show's card. */
  anchor: RefObject<Element | null>;
}

/**
 * Chooses a show's poster, backdrop and logo: one of TMDB's, an image of one's own, or back to
 * TMDB's choice. It opens beside the show's card, not over it, so each pick shows on the card as it
 * is made. What a pick does is the caller's: saved at once for a series, kept for one being added.
 */
function ArtworkPickerView({
  open,
  onOpenChange,
  kind,
  onKindChange,
  trigger,
  anchor,
  hint,
  options,
  hasTmdbId,
  state,
  backdrop,
  pending,
  failed,
  onPick,
  onUpload,
  onReset,
}: PickerFrame & {
  hint: string;
  options: UseQueryResult<ArtworkOptionsDto>;
  hasTmdbId: boolean;
  state: (kind: ArtworkKind) => KindState;
  /** Behind each logo, the backdrop in use. */
  backdrop: string | null;
  /** What is being saved: a TMDB address, `upload` or `reset`, and the kind it is for. */
  pending: { kind: ArtworkKind; what: string } | null;
  failed: { message: string; retry: () => void } | null;
  onPick: (option: ArtworkOptionDto) => void;
  onUpload: (file: File) => void;
  onReset: () => void;
}) {
  const t = useT();
  const file = useRef<HTMLInputElement>(null);
  const busy = pending !== null;
  const list = options.data?.[kind] ?? [];
  const noTmdb = !hasTmdbId
    ? t.series.artwork.noTmdbId
    : options.error instanceof ApiError && options.error.status === 503
      ? t.series.artwork.noTmdbKey
      : null;
  // A word under the list only when there is nothing (yet) to pick from.
  const note =
    noTmdb ??
    (options.isPending ? (
      <span className="flex items-center gap-2">
        <Spinner className="size-4" />
        {t.series.artwork.loading}
      </span>
    ) : options.isError ? (
      t.series.artwork.tmdbFailed
    ) : list.length === 0 ? (
      t.series.artwork.none
    ) : null);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger} />
      {/* Beside the card, 16px out from its edge and level with its top (the card is 1px in from
          its panel's edge). It stays there: never flipped or shifted over the card. */}
      <PopoverContent
        anchor={anchor}
        side="right"
        align="start"
        sideOffset={17}
        alignOffset={-1}
        collisionAvoidance={{ side: "none", align: "none", fallbackAxisSide: "none" }}
        className={cn(
          GLASS_PANEL,
          "max-h-[min(52rem,calc(var(--available-height)-11px))] w-[min(56rem,calc(var(--available-width)-11px))] gap-4 p-4 text-base",
        )}
      >
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1 px-2 pt-1">
            <PopoverTitle className="text-lg font-semibold">{t.series.artwork.title}</PopoverTitle>
            <PopoverDescription className="text-sm">{hint}</PopoverDescription>
          </div>
          <PopoverClose
            render={<Button variant="ghost" size="icon" className={SECONDARY} />}
            aria-label={t.series.artwork.close}
          >
            <HugeiconsIcon icon={Cancel01Icon} className="size-5" />
          </PopoverClose>
        </div>

        <Tabs
          value={kind}
          onValueChange={(value) => onKindChange(value as ArtworkKind)}
          className="min-h-0 flex-1 gap-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <TabsList>
              {KINDS.map((k) => (
                <TabsTab key={k} value={k}>
                  {t.series.artwork.kinds[k]}
                </TabsTab>
              ))}
            </TabsList>
            <span className="flex-1" />
            {state(kind).resettable && (
              <button
                type="button"
                disabled={busy}
                onClick={onReset}
                title={t.series.artwork.resetHint}
                className={cn(PILL_BUTTON, SECONDARY, "h-10 px-4")}
              >
                {pending?.what === "reset" ? (
                  <Spinner className="size-4" />
                ) : (
                  <HugeiconsIcon icon={ArrowTurnBackwardIcon} className="size-4" />
                )}
                {t.series.artwork.reset}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => file.current?.click()}
              className={cn(PILL_BUTTON, SECONDARY, "h-10 px-4")}
            >
              {pending?.what === "upload" ? (
                <Spinner className="size-4" />
              ) : (
                <HugeiconsIcon icon={Upload04Icon} className="size-4" />
              )}
              {t.series.artwork.upload}
            </button>
            <input
              ref={file}
              type="file"
              accept={ACCEPT[kind]}
              className="hidden"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                event.target.value = "";
                if (chosen) onUpload(chosen);
              }}
            />
          </div>

          {failed && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-2xl bg-destructive/10 px-4 py-2 text-sm text-destructive"
            >
              <HugeiconsIcon icon={Alert02Icon} className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">{failed.message}</span>
              <Button variant="outline" onClick={failed.retry}>
                {t.series.artwork.retry}
              </Button>
            </div>
          )}

          {KINDS.map((k) => {
            const listed = options.data?.[k] ?? [];
            const { inUse, ownSrc } = state(k);
            return (
              <TabsPanel
                key={k}
                value={k}
                className="-m-1 min-h-0 overflow-y-auto overscroll-contain p-1 [scrollbar-color:oklch(0_0_0/18%)_transparent] [scrollbar-width:thin]"
              >
                <div className={cn("grid gap-4", GRID[k].grid)}>
                  {ownSrc !== null && (
                    <Tile
                      kind={k}
                      src={ownSrc}
                      label={t.series.artwork.own}
                      current
                      busy={false}
                      disabled
                      behind={backdrop}
                      onPick={() => undefined}
                    />
                  )}
                  {listed.map((option) => (
                    <Tile
                      key={option.url}
                      kind={k}
                      src={option.previewUrl}
                      label={option.language ?? t.series.artwork.noText}
                      current={inUse !== null && fileOf(option.url) === inUse}
                      busy={pending?.kind === k && pending.what === option.url}
                      disabled={busy}
                      behind={backdrop}
                      onPick={() => onPick(option)}
                    />
                  ))}
                </div>
                {k === kind && note !== null && (
                  <p className="px-2 pt-4 text-sm text-muted-foreground">{note}</p>
                )}
              </TabsPanel>
            );
          })}
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

/** A series' artwork: each pick is saved at once, into its folder, where Jellyfin reads it. */
export function ArtworkPicker({
  series,
  tmdb,
  ...frame
}: PickerFrame & { series: SeriesDto; tmdb: ShowLookupDto | null }) {
  const t = useT();
  const api = useApi();
  const { setArtwork, removeArtwork } = useMutations();
  const { kind } = frame;
  const options = useQuery({
    ...queries.artworkOptions(api, series.id),
    enabled: frame.open && series.tmdbId !== null,
  });
  const [pending, setPending] = useState<{ kind: ArtworkKind; what: string } | null>(null);
  const [failed, setFailed] = useState<{ message: string; retry: () => void } | null>(null);

  const run = (what: string, task: () => Promise<unknown>) => {
    const forKind = kind;
    setPending({ kind: forKind, what });
    setFailed(null);
    task()
      .catch((error: unknown) => {
        setFailed({
          message: error instanceof ApiError ? error.message : t.series.artwork.failed,
          retry: () => run(what, task),
        });
      })
      .finally(() => setPending(null));
  };

  const state = (k: ArtworkKind): KindState => {
    const own = series[OWN[k]];
    const listed = options.data?.[k] ?? [];
    // The one in use: the series' own (by the TMDB file it was taken from), else TMDB's pick.
    const from = own ? (series.artworkFrom[k] ?? null) : null;
    const inUse = own ? fileOf(from) : fileOf(tmdb?.[TMDB_DEFAULT[k]]);
    // Its own picture only when TMDB's list doesn't have it: an upload, or one TMDB dropped.
    const ownTile =
      own &&
      (from === null ||
        options.isError ||
        (options.isSuccess && !listed.some((o) => fileOf(o.url) === inUse)));
    return { inUse, ownSrc: ownTile ? artworkUrl(series, k) : null, resettable: own };
  };

  return (
    <ArtworkPickerView
      {...frame}
      hint={t.series.artwork.hint}
      options={options}
      hasTmdbId={series.tmdbId !== null}
      state={state}
      backdrop={currentArtwork(series, tmdb, "backdrop")}
      pending={pending}
      failed={failed}
      onPick={(option) =>
        run(option.url, () =>
          setArtwork.mutateAsync({ seriesId: series.id, kind, from: { url: option.url } }),
        )
      }
      onUpload={(chosen) =>
        run("upload", () =>
          setArtwork.mutateAsync({ seriesId: series.id, kind, from: { file: chosen } }),
        )
      }
      onReset={() => run("reset", () => removeArtwork.mutateAsync({ seriesId: series.id, kind }))}
    />
  );
}

/**
 * The artwork of a show being added: nothing is saved yet, the picks are kept and the card shows
 * them; they go into the series' folder once it is added.
 */
export function DraftArtworkPicker({
  tmdb,
  chosen,
  onChange,
  ...frame
}: PickerFrame & {
  tmdb: ShowLookupDto;
  chosen: DraftArtworks;
  onChange: (chosen: DraftArtworks) => void;
}) {
  const t = useT();
  const api = useApi();
  const { kind } = frame;
  const options = useQuery({
    ...queries.showArtworkOptions(api, tmdb.tmdbId),
    enabled: frame.open,
  });
  const state = (k: ArtworkKind): KindState => {
    const pick = chosen[k];
    return {
      inUse: pick ? ("url" in pick ? fileOf(pick.url) : null) : fileOf(tmdb[TMDB_DEFAULT[k]]),
      ownSrc: pick && "file" in pick ? pick.previewUrl : null,
      resettable: pick !== undefined,
    };
  };
  const set = (pick: DraftArtwork | undefined) => {
    const next = { ...chosen };
    if (pick) next[kind] = pick;
    else delete next[kind];
    onChange(next);
  };
  return (
    <ArtworkPickerView
      {...frame}
      hint={t.series.artwork.draftHint}
      options={options}
      hasTmdbId
      state={state}
      backdrop={chosen.backdrop?.previewUrl ?? tmdb.backdropUrl}
      pending={null}
      failed={null}
      onPick={(option) => set({ url: option.url, previewUrl: option.previewUrl })}
      onUpload={(file) => set({ file, previewUrl: URL.createObjectURL(file) })}
      onReset={() => set(undefined)}
    />
  );
}
