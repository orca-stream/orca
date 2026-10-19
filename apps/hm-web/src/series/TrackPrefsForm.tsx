import { useState } from "react";
import { useMutations } from "../api/mutations";
import type { SeriesDto } from "../api/types";
import { useT } from "../i18n/locale";
import { Button, Switch, TextField } from "../ui";
import { formState, toTrackPatch, type TrackForm } from "./track-prefs";

/** The heights worth offering; a height set another way still shows up as its own option. */
const HEIGHTS = [2160, 1440, 1080, 720, 480, 360] as const;

/** "Quality and tracks": the series' own choices for streams, empty meaning the server's default. */
export function TrackPrefsForm({ series }: { series: SeriesDto }) {
  const t = useT();
  const { patchSeries } = useMutations();
  const [draft, setDraft] = useState<TrackForm | null>(null);
  const form = draft ?? formState(series);
  const patch = toTrackPatch(form, series);
  const invalid = patch === "invalid";
  const unchanged = !invalid && Object.keys(patch).length === 0;
  const heights =
    series.maxHeight !== null && !(HEIGHTS as readonly number[]).includes(series.maxHeight)
      ? [...HEIGHTS, series.maxHeight].sort((a, b) => b - a)
      : HEIGHTS;
  const update = (next: Partial<TrackForm>) => setDraft({ ...form, ...next });

  return (
    <form
      aria-label={t.series.tracks.title}
      className="flex flex-col gap-3 rounded-lg border border-white/10 bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid || unchanged) return;
        patchSeries.mutate({ seriesId: series.id, patch }, { onSuccess: () => setDraft(null) });
      }}
    >
      <div>
        <h2 className="text-sm font-semibold">{t.series.tracks.title}</h2>
        <p className="mt-1 text-xs text-white/50">{t.series.tracks.hint}</p>
      </div>
      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <label htmlFor="track-height" className="text-sm text-white/70">
          {t.series.tracks.maxHeight}
        </label>
        <select
          id="track-height"
          value={form.maxHeight}
          onChange={(event) => update({ maxHeight: event.target.value })}
          className="h-10 rounded-md border border-white/10 bg-surface px-3 text-sm text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
        >
          <option value="">{t.series.tracks.defaultOption}</option>
          {heights.map((height) => (
            <option key={height} value={String(height)}>
              {t.series.tracks.heightOption(height)}
            </option>
          ))}
        </select>
      </div>
      <TextField
        label={t.series.tracks.audio}
        placeholder="spa, eng"
        value={form.audio}
        onChange={(event) => update({ audio: event.target.value })}
      />
      <TextField
        label={t.series.tracks.subtitles}
        placeholder="spa, eng"
        disabled={form.noSubtitles}
        value={form.subtitles}
        onChange={(event) => update({ subtitles: event.target.value })}
      />
      <Switch
        checked={form.noSubtitles}
        label={t.series.tracks.noSubtitles}
        onCheckedChange={(noSubtitles) => update({ noSubtitles })}
      />
      <p className="text-xs text-white/50">{t.series.tracks.langHint}</p>
      {invalid && (
        <p role="alert" className="text-sm text-amber-300">
          {t.series.tracks.invalid}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={invalid || unchanged} loading={patchSeries.isPending}>
          {t.series.tracks.save}
        </Button>
        {patchSeries.isSuccess && unchanged && (
          <span role="status" className="text-xs text-white/60">
            {t.series.tracks.saved}
          </span>
        )}
      </div>
    </form>
  );
}
