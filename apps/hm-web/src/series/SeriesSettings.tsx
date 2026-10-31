import type { SeriesDto } from "@orca/hm-contract";
import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Clock01Icon,
  Film01Icon,
  HdIcon,
  RefreshIcon,
  RssIcon,
  SubtitleIcon,
  Tv01Icon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons";
import { useMutations } from "@/api/mutations";
import { Spinner } from "@/components/ui/spinner";
import { useNow } from "@/hooks/use-now";
import { formatRelative } from "@/i18n/format";
import { useLocale, useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import { BarField, BarMultiPicker, BarPicker, BarToggle, type PickItem } from "./bar";
import { digitsOf } from "./preview-form";
import { SeriesSources } from "./SeriesSources";
import {
  ALL_LANGUAGES,
  COMMON_HEIGHTS,
  COMMON_LANGUAGES,
  NO_SUBTITLES,
  applyLanguagePick,
  codesOf,
  invalidSettings,
  MAX_CHECK_HOURS,
  pickedLanguages,
  settingsOf,
  toSettingsPatch,
  type SettingsForm,
} from "./settings-form";

/** Two settings side by side, one above the other on a phone, where half a row is too narrow. */
const PAIR = "grid sm:grid-cols-2";
/** The second of a pair: its hairline on top on a phone, on its left beside the first. */
const SECOND = "border-(--glass-edge) max-sm:border-t sm:border-l";

/** The small round buttons at the end of a row, the size of the bar's own. */
const ROW_BUTTON =
  "flex h-10 shrink-0 items-center gap-2 rounded-full bg-white/70 px-4 text-sm font-medium ring-1 ring-black/5 transition-colors hover:bg-white focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

/**
 * The series' settings as one bar, the way adding a series is: its addresses, when it is checked,
 * and every choice of its own as rows. One Save at the end sends whatever changed.
 */
export function SeriesSettings({
  series,
  checkSeries,
}: {
  series: SeriesDto;
  /** The page's own, so the dock's "look now" and this row's show the same state. */
  checkSeries: ReturnType<typeof useMutations>["checkSeries"];
}) {
  const t = useT();
  const locale = useLocale();
  const now = useNow(30_000);
  const { patchSeries } = useMutations();
  const [draft, setDraft] = useState<SettingsForm | null>(null);
  // When the last "look now" was sent, and when the series had last been read at that moment: the
  // search stays "queued" only until the check that request started stamps a newer time.
  const [request, setRequest] = useState({
    submittedAt: checkSeries.submittedAt,
    lastCheckedAt: series.lastCheckedAt,
  });
  if (checkSeries.submittedAt !== request.submittedAt) {
    setRequest({ submittedAt: checkSeries.submittedAt, lastCheckedAt: series.lastCheckedAt });
  }
  const queued = checkSeries.isSuccess && series.lastCheckedAt === request.lastCheckedAt;

  const form = draft ?? settingsOf(series);
  const update = (next: Partial<SettingsForm>) => setDraft({ ...form, ...next });
  const invalid = invalidSettings(form);
  const patch = toSettingsPatch(form, series);
  const changes = patch === "invalid" ? null : Object.keys(patch).length;
  const dirty = draft !== null && changes !== 0;
  const heights =
    series.maxHeight !== null && !(COMMON_HEIGHTS as readonly number[]).includes(series.maxHeight)
      ? [...COMMON_HEIGHTS, series.maxHeight].sort((a, b) => b - a)
      : COMMON_HEIGHTS;

  // The languages on offer: the usual ones, then any other the series already has.
  const languages = [
    ...new Set([...COMMON_LANGUAGES, ...codesOf(form.audio), ...codesOf(form.subtitles)]),
  ];
  const nameOf = (code: string) => t.series.detail.languages[code] ?? code;
  const languageItems: PickItem[] = languages.map((code) => ({
    value: code,
    label: nameOf(code),
    detail: code,
  }));
  const allItem: PickItem = { value: ALL_LANGUAGES, label: t.series.detail.allLanguages };
  const audioPicked = pickedLanguages(form.audio);
  const subtitlesPicked = pickedLanguages(form.subtitles, form.noSubtitles);
  const names = (text: string) => codesOf(text).map(nameOf).join(", ");

  const nextCheckAt =
    series.lastCheckedAt === null
      ? null
      : series.lastCheckedAt + series.checkIntervalHours * 3_600_000;
  const checks = [
    series.lastCheckedAt === null
      ? t.series.neverChecked
      : t.series.lastChecked(formatRelative(new Date(series.lastCheckedAt), new Date(now), locale)),
    series.follow
      ? nextCheckAt === null || nextCheckAt <= now
        ? t.series.checkSoon
        : t.series.nextChecked(formatRelative(new Date(nextCheckAt), new Date(now), locale))
      : null,
  ].filter((part) => part !== null);

  function save() {
    if (patch === "invalid" || changes === 0) return;
    patchSeries.mutate({ seriesId: series.id, patch }, { onSuccess: () => setDraft(null) });
  }

  return (
    <form
      aria-label={t.series.detail.settings}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="border-t border-(--glass-edge) [&>*+*]:border-t [&>*+*]:border-t-(--glass-edge)"
    >
      <SeriesSources series={series} />

      {/* When the site was last read, and the way to read it again right now. */}
      <div className="flex min-h-14 items-center py-2 pr-2">
        <span className="flex w-[63px] shrink-0 justify-center pl-[7px] text-muted-foreground">
          <HugeiconsIcon icon={RefreshIcon} className="size-5" />
        </span>
        <p role="status" className="flex min-w-0 flex-1 flex-col pr-3 pl-1.5 text-sm leading-snug">
          {queued ? (
            <span>{t.series.checkQueued}</span>
          ) : (
            <>
              <span className="truncate">{checks[0]}</span>
              {checks[1] && (
                <span className="truncate text-xs text-muted-foreground">{checks[1]}</span>
              )}
            </>
          )}
        </p>
        <button
          type="button"
          disabled={checkSeries.isPending}
          aria-busy={checkSeries.isPending || undefined}
          onClick={() => checkSeries.mutate(series.id)}
          className={ROW_BUTTON}
        >
          {checkSeries.isPending && <Spinner aria-hidden="true" />}
          {t.series.checkNow}
        </button>
      </div>

      <div className={PAIR}>
        <BarToggle
          icon={RssIcon}
          label={t.series.follow}
          hint={t.add.followHint}
          checked={form.follow}
          onChange={(follow) => update({ follow })}
        />
        <BarField
          icon={Clock01Icon}
          label={t.series.checkEvery}
          placeholder={t.series.detail.intervalPlaceholder}
          type="number"
          min={1}
          max={MAX_CHECK_HOURS}
          step={1}
          suffix={t.series.detail.hours}
          alignEnd
          error={invalid.has("interval") ? t.series.detail.intervalInvalid : undefined}
          value={form.interval}
          onChange={(event) => update({ interval: digitsOf(event.target.value) })}
          className={SECOND}
        />
      </div>

      <div className={PAIR}>
        <BarField
          icon={Film01Icon}
          label={t.series.ids.tmdb}
          placeholder={t.add.tmdbPlaceholder}
          title={t.series.ids.hint}
          inputMode="numeric"
          error={invalid.has("tmdbId") ? t.add.tmdbInvalid : undefined}
          value={form.tmdbId}
          onChange={(event) => update({ tmdbId: digitsOf(event.target.value) })}
        />
        <BarField
          icon={Tv01Icon}
          label={t.series.ids.imdb}
          placeholder={t.add.imdbPlaceholder}
          title={t.series.ids.hint}
          error={invalid.has("imdbId") ? t.add.imdbInvalid : undefined}
          value={form.imdbId}
          onChange={(event) => update({ imdbId: event.target.value.trim() })}
          className={SECOND}
        />
      </div>

      {/* Only streams are cut to a height and to tracks; a file is kept as it comes. */}
      <div title={t.series.tracks.hint}>
        <BarPicker
          icon={HdIcon}
          label={t.series.tracks.maxHeight}
          placeholder={t.series.detail.heightDefault}
          items={heights.map((height) => ({
            value: String(height),
            label: t.series.detail.heightOption(height),
          }))}
          value={form.maxHeight}
          onChange={(maxHeight) => update({ maxHeight })}
        />
      </div>

      {/* Which tracks are kept: none picked keeps them all, as the server does by default. */}
      <div className={PAIR} title={t.series.tracks.langHint}>
        <BarMultiPicker
          icon={VolumeHighIcon}
          label={t.series.tracks.audio}
          summary={
            codesOf(form.audio).length > 0
              ? t.series.detail.audioOf(names(form.audio))
              : t.series.detail.audioAll
          }
          items={[allItem, ...languageItems]}
          value={audioPicked}
          onChange={(next) => update({ audio: applyLanguagePick(audioPicked, next).codes })}
        />
        <BarMultiPicker
          icon={SubtitleIcon}
          label={t.series.tracks.subtitles}
          summary={
            form.noSubtitles
              ? t.series.tracks.noSubtitles
              : codesOf(form.subtitles).length > 0
                ? t.series.detail.subtitlesOf(names(form.subtitles))
                : t.series.detail.subtitlesAll
          }
          items={[
            allItem,
            { value: NO_SUBTITLES, label: t.series.tracks.noSubtitles },
            ...languageItems,
          ]}
          value={subtitlesPicked}
          onChange={(next) => {
            const { codes, none } = applyLanguagePick(subtitlesPicked, next);
            update({ subtitles: codes, noSubtitles: none });
          }}
          className={SECOND}
        />
      </div>

      {/* The bar ends the way adding a series does: what it will do, and the button that does it. */}
      <div className="flex h-[calc(--spacing(18)+1px)] items-center gap-3 pr-[7px] pl-6">
        <p
          role="status"
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            patchSeries.isError ? "text-warning" : "text-muted-foreground",
          )}
        >
          {patchSeries.isError
            ? t.series.detail.saveFailed
            : dirty && changes !== null
              ? t.series.detail.unsaved(changes)
              : patchSeries.isSuccess && draft === null
                ? t.series.detail.saved
                : null}
        </p>
        {draft !== null && (
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              patchSeries.reset();
            }}
            className={cn(ROW_BUTTON, "h-14 px-6 text-base")}
          >
            {t.series.detail.discard}
          </button>
        )}
        <button
          type="submit"
          disabled={!dirty || changes === null || patchSeries.isPending}
          aria-busy={patchSeries.isPending || undefined}
          className="flex h-14 shrink-0 items-center gap-2 rounded-full bg-primary px-6 text-base font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
        >
          {patchSeries.isPending && <Spinner aria-hidden="true" />}
          {patchSeries.isPending ? t.series.detail.saving : t.series.detail.save}
        </button>
      </div>
    </form>
  );
}
