import type { SeriesDto, ShowLookupDto } from "@orca/hm-contract";
import { MAX_TITLE_LENGTH } from "@orca/hm-contract/rules";
import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Calendar03Icon,
  Clock01Icon,
  Film01Icon,
  HdIcon,
  RefreshIcon,
  RssIcon,
  SubtitleIcon,
  TextFontIcon,
  Tv01Icon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons";
import { useMutations } from "@/api/mutations";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Spinner } from "@/components/ui/spinner";
import { useNow } from "@/hooks/use-now";
import { formatRelative } from "@/i18n/format";
import { useLocale, useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import { BarField, BarMultiPicker, BarPicker, BarToggle, HINT_CARD, type PickItem } from "./bar";
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

/** How long typing has to stop before a typed setting saves itself. */
const TYPING_PAUSE_MS = 800;

/**
 * The series' settings as one bar, the way adding a series is: its addresses and every choice of
 * its own as rows. Each change saves itself: a switch or a list at once, a typed one once the typing
 * stops (and only while it is valid). Looking for new episodes now is a round button beside how
 * often it is done, with when it was and will be on hover.
 */
export function SeriesSettings({
  series,
  checkSeries,
  showStatus = null,
}: {
  series: SeriesDto;
  /** What TMDB says of the show, so open sources of one that ended are pointed out. */
  showStatus?: ShowLookupDto["status"];
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
  const invalid = invalidSettings(form);

  // Sends what differs from the series. The draft stays after it is saved: dropping it before the
  // refetched series arrives would flash the old values back for a moment.
  const typing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(typing.current), []);
  function save(next: SettingsForm) {
    clearTimeout(typing.current);
    const patch = toSettingsPatch(next, series);
    if (patch === "invalid" || Object.keys(patch).length === 0) return;
    patchSeries.mutate({ seriesId: series.id, patch });
  }
  function update(change: Partial<SettingsForm>, typed = false) {
    const next = { ...form, ...change };
    setDraft(next);
    if (!typed) save(next);
    else {
      clearTimeout(typing.current);
      typing.current = setTimeout(() => save(next), TYPING_PAUSE_MS);
    }
  }
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

  const checkStatus = queued ? [t.series.checkQueued] : checks;

  return (
    <form
      aria-label={t.series.detail.settings}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save(form);
      }}
      className="border-t border-(--glass-edge) [&>*+*]:border-t [&>*+*]:border-t-(--glass-edge)"
    >
      <SeriesSources series={series} showStatus={showStatus} />

      <div className={PAIR}>
        <BarToggle
          icon={RssIcon}
          label={t.series.follow}
          hint={t.add.followHint}
          checked={form.follow}
          onChange={(follow) => update({ follow })}
        />
        <div className={cn(SECOND, "flex min-h-18 min-w-0 items-center pr-4")}>
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
            onChange={(event) => update({ interval: digitsOf(event.target.value) }, true)}
            onBlur={() => save(form)}
            className="min-w-0 flex-1"
          />
          {/* Looking now, beside how often: when it was and when it will be, on hover. */}
          <HoverCard>
            <HoverCardTrigger
              delay={0}
              closeDelay={100}
              render={
                <button
                  type="button"
                  aria-label={t.series.checkNow}
                  disabled={checkSeries.isPending}
                  aria-busy={checkSeries.isPending || undefined}
                  onClick={() => checkSeries.mutate(series.id)}
                />
              }
              className={cn(ROW_BUTTON, "size-10 justify-center px-0", queued && "text-primary")}
            >
              {checkSeries.isPending ? (
                <Spinner aria-hidden="true" />
              ) : (
                <HugeiconsIcon icon={RefreshIcon} className="size-4" aria-hidden="true" />
              )}
            </HoverCardTrigger>
            <HoverCardContent side="top" align="end" sideOffset={6} className={HINT_CARD}>
              {checkStatus.map((line, index) => (
                <p key={line} className={cn(index > 0 && "text-muted-foreground")}>
                  {line}
                </p>
              ))}
            </HoverCardContent>
          </HoverCard>
          <p role="status" className="sr-only">
            {checkStatus.join(". ")}
          </p>
        </div>
      </div>

      {/* The name it goes by in Jellyfin: a new one makes Jellyfin reread the series. */}
      <div className="flex">
        <BarField
          icon={TextFontIcon}
          label={t.add.fieldTitle}
          placeholder={t.add.titlePlaceholder}
          title={t.series.detail.titleHint}
          maxLength={MAX_TITLE_LENGTH}
          error={invalid.has("title") ? t.series.detail.titleInvalid : undefined}
          value={form.title}
          onChange={(event) => update({ title: event.target.value }, true)}
          onBlur={() => save(form)}
        />
        <BarField
          icon={Calendar03Icon}
          label={t.add.fieldYear}
          placeholder={t.add.yearPlaceholder}
          inputMode="numeric"
          maxLength={4}
          error={invalid.has("year") ? t.add.yearInvalid : undefined}
          value={form.year}
          onChange={(event) => update({ year: digitsOf(event.target.value) }, true)}
          onBlur={() => save(form)}
          className="w-48 shrink-0 border-l border-l-(--glass-edge)"
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
          onChange={(event) => update({ tmdbId: digitsOf(event.target.value) }, true)}
          onBlur={() => save(form)}
        />
        <BarField
          icon={Tv01Icon}
          label={t.series.ids.imdb}
          placeholder={t.add.imdbPlaceholder}
          title={t.series.ids.hint}
          error={invalid.has("imdbId") ? t.add.imdbInvalid : undefined}
          value={form.imdbId}
          onChange={(event) => update({ imdbId: event.target.value.trim() }, true)}
          onBlur={() => save(form)}
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

      {/* Nothing to press: only a save that failed says so, with the way to try again. */}
      {patchSeries.isError && (
        <div className="flex items-center gap-4 p-4">
          <p role="alert" className="min-w-0 flex-1 text-sm text-warning">
            {t.series.detail.saveFailed}
          </p>
          <button type="button" onClick={() => save(form)} className={ROW_BUTTON}>
            {t.common.retry}
          </button>
        </div>
      )}
    </form>
  );
}
