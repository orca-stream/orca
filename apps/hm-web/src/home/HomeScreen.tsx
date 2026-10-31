import type { ExtractorDto, SeriesDto } from "@orca/hm-contract";
import { Add01Icon, ArrowUpRight01Icon, Tv01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { Link } from "wouter";
import { useApi } from "@/api/context";
import { posterUrl, queries } from "@/api/queries";
import { StatusBadge } from "@/components/status-badge";
import { Dock, DockExtractors, DockLink } from "@/components/dock";
import { extractorHref } from "@/extractors/href";
import { ROUND_ACTION, TILE_GRID, Tile, TileLink } from "@/components/tile";
import { useT } from "@/i18n/locale";
import { ExtractorMark } from "@/extractors/ExtractorMark";
import { paletteOf } from "@/extractors/palette";
import { cn } from "@/lib/utils";

/** How many covers the series card fans out. */
const FANNED = 3;

/** Up to three covers fanned like cards in a hand; they open a little more on hover. */
function Covers({ series }: { series: SeriesDto[] }) {
  const covers = series.filter((s) => s.hasPoster).slice(0, FANNED);
  if (covers.length === 0) {
    return (
      <span className="flex size-20 items-center justify-center rounded-3xl bg-linear-to-br from-sky-400 to-primary text-white shadow-lg shadow-primary/30">
        <HugeiconsIcon icon={Tv01Icon} className="size-10" />
      </span>
    );
  }
  const middle = (covers.length - 1) / 2;
  return (
    <div className="relative h-full w-full">
      {covers.map((s, index) => {
        const offset = index - middle;
        return (
          <img
            key={s.id}
            src={posterUrl(s.id)}
            alt=""
            loading="lazy"
            style={{ "--o": offset } as CSSProperties}
            className="absolute top-1/2 left-1/2 aspect-2/3 h-[84%] -translate-y-1/2 translate-x-[calc(-50%+var(--o)*30%)] rotate-[calc(var(--o)*7deg)] rounded-xl object-cover shadow-xl ring-1 ring-white/70 transition-transform duration-300 ease-out group-hover/tile:translate-x-[calc(-50%+var(--o)*38%)] group-hover/tile:rotate-[calc(var(--o)*10deg)]"
          />
        );
      })}
    </div>
  );
}

function SeriesTile() {
  const t = useT();
  const api = useApi();
  const list = useQuery(queries.seriesList(api));
  const series = list.data ?? [];
  const downloading = series.reduce((sum, s) => sum + s.downloadingCount, 0);

  return (
    <Tile className="bg-linear-to-b from-primary/10 to-transparent">
      <div className="flex flex-1 items-center justify-center p-4 pb-1 sm:p-6 sm:pb-2">
        <Covers series={series} />
      </div>
      <div className="flex items-end gap-2 p-4 pt-2 sm:gap-3 sm:p-5 sm:pt-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
            <TileLink href="/series">{t.nav.series}</TileLink>
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
            {list.isSuccess
              ? series.length === 0
                ? t.home.seriesEmpty
                : t.home.seriesCount(series.length)
              : list.isError
                ? t.dashboard.loadFailed
                : t.common.loading}
          </p>
          {downloading > 0 && (
            <StatusBadge tone="info" className="mt-2">
              {t.series.downloading(downloading)}
            </StatusBadge>
          )}
        </div>
        <Link
          href="/series/new"
          aria-label={t.series.add}
          className={cn(ROUND_ACTION, "relative z-10")}
        >
          <HugeiconsIcon icon={Add01Icon} className="size-5" />
        </Link>
      </div>
    </Tile>
  );
}

function ExtractorTile({ extractor }: { extractor: ExtractorDto }) {
  const t = useT();
  const palette = paletteOf(extractor.id);
  const sites = extractor.explicit ? [t.extractors.explicitOnly] : extractor.hosts;

  return (
    <Tile>
      <div
        aria-hidden="true"
        style={palette}
        className="absolute inset-x-0 top-0 h-1/2 bg-linear-to-b from-(--wash) to-transparent"
      />
      {/* The sites, as badges in the top right corner. */}
      <ul
        className="absolute inset-x-4 top-4 flex flex-wrap justify-end gap-1.5 sm:inset-x-5 sm:top-5"
        aria-label={extractor.name}
      >
        {(sites.length > 0 ? sites : [t.home.anyPage]).map((site) => (
          <li
            key={site}
            className="max-w-full truncate rounded-full bg-white/70 px-2.5 py-0.5 text-xs text-muted-foreground ring-1 ring-black/5"
          >
            {site}
          </li>
        ))}
      </ul>
      {/* Centred and sized like the series tile's icon, so the row reads as one set. */}
      <div className="relative flex flex-1 items-center justify-center p-4 pb-1 sm:p-6 sm:pb-2">
        <ExtractorMark
          extractor={extractor}
          className="size-20 rounded-3xl shadow-lg"
          iconClassName="size-10"
        />
      </div>
      <div className="flex items-end gap-2 p-4 pt-0 sm:gap-3 sm:p-5 sm:pt-0">
        <h2 className="min-w-0 flex-1 text-base leading-tight font-semibold tracking-tight sm:text-lg">
          {extractor.name}
        </h2>
        {/* The link stays unpositioned and untransformed, or it would trap its stretched ::after. */}
        <TileLink href={extractorHref(extractor)}>
          <span className="sr-only">{t.extractors.tryIt}</span>
        </TileLink>
        <span aria-hidden="true" className={cn(ROUND_ACTION, "group-hover/tile:scale-105")}>
          <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-5" />
        </span>
      </div>
    </Tile>
  );
}

/** Ghost tiles while the extractors load, so the grid keeps its shape. */
function PlaceholderTile() {
  return <Tile className="animate-pulse opacity-60" />;
}

/** Home: the series and every extractor, as one grid of 3:4 glass cards in the middle of the screen. */
export function HomeScreen() {
  const t = useT();
  const api = useApi();
  const extractors = useQuery(queries.extractors(api));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6">
      <h1 className="sr-only">{t.nav.home}</h1>
      <ul className={TILE_GRID}>
        <SeriesTile />
        {extractors.isPending && <PlaceholderTile />}
        {extractors.data?.map((extractor) => (
          <ExtractorTile key={extractor.id} extractor={extractor} />
        ))}
      </ul>
      {extractors.isError && (
        <p role="alert" className="text-sm text-warning">
          {t.dashboard.loadFailed}
        </p>
      )}
      {extractors.isSuccess && extractors.data.length === 0 && (
        <p className="text-sm text-muted-foreground">{t.extractors.empty}</p>
      )}
      <Dock label={t.dock.label}>
        <DockLink href="/series" label={t.nav.series} icon={Tv01Icon} />
        <DockExtractors />
      </Dock>
    </div>
  );
}
