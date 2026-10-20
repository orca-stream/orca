import { useState } from "react";
import { useMutations } from "@/api/mutations";
import type { SeriesDto } from "@/api/types";
import { PendingButton } from "@/components/pending-button";
import { SwitchField } from "@/components/switch-field";
import { TextField } from "@/components/text-field";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useT } from "@/i18n/locale";
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
      className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid || unchanged) return;
        patchSeries.mutate({ seriesId: series.id, patch }, { onSuccess: () => setDraft(null) });
      }}
    >
      <div>
        <h2 className="text-sm font-semibold">{t.series.tracks.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t.series.tracks.hint}</p>
      </div>
      <Field className="sm:max-w-xs">
        <FieldLabel htmlFor="track-height">{t.series.tracks.maxHeight}</FieldLabel>
        <NativeSelect
          id="track-height"
          className="w-full"
          value={form.maxHeight}
          onChange={(event) => update({ maxHeight: event.target.value })}
        >
          <NativeSelectOption value="">{t.series.tracks.defaultOption}</NativeSelectOption>
          {heights.map((height) => (
            <NativeSelectOption key={height} value={String(height)}>
              {t.series.tracks.heightOption(height)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
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
      <SwitchField
        checked={form.noSubtitles}
        label={t.series.tracks.noSubtitles}
        onCheckedChange={(noSubtitles) => update({ noSubtitles })}
      />
      <p className="text-xs text-muted-foreground">{t.series.tracks.langHint}</p>
      {invalid && (
        <p role="alert" className="text-sm text-warning">
          {t.series.tracks.invalid}
        </p>
      )}
      <div className="flex items-center gap-3">
        <PendingButton
          type="submit"
          variant="outline"
          disabled={invalid || unchanged}
          pending={patchSeries.isPending}
        >
          {t.series.tracks.save}
        </PendingButton>
        {patchSeries.isSuccess && unchanged && (
          <span role="status" className="text-xs text-muted-foreground">
            {t.series.tracks.saved}
          </span>
        )}
      </div>
    </form>
  );
}
