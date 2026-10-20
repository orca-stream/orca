import { useState } from "react";
import { useMutations } from "@/api/mutations";
import type { SeriesDto, SeriesPatch } from "@/api/types";
import { PendingButton } from "@/components/pending-button";
import { TextField } from "@/components/text-field";
import { useT } from "@/i18n/locale";
import { isInvalidImdbId, isInvalidTmdbId, parseImdbId, parseTmdbId } from "./preview-form";

/** "TMDB and IMDb": the ids Jellyfin looks the show up by. Empty removes one. */
export function SeriesIdsForm({ series }: { series: SeriesDto }) {
  const t = useT();
  const { patchSeries } = useMutations();
  const [tmdbDraft, setTmdbDraft] = useState<string | null>(null);
  const [imdbDraft, setImdbDraft] = useState<string | null>(null);
  const tmdbText = tmdbDraft ?? series.tmdbId ?? "";
  const imdbText = imdbDraft ?? series.imdbId ?? "";
  const tmdb = parseTmdbId(tmdbText);
  const imdb = parseImdbId(imdbText);
  const tmdbInvalid = isInvalidTmdbId(tmdbText);
  const imdbInvalid = isInvalidImdbId(imdbText);
  const invalid = tmdbInvalid || imdbInvalid;
  const patch: SeriesPatch = {
    ...(!invalid && tmdb !== series.tmdbId ? { tmdbId: tmdb } : {}),
    ...(!invalid && imdb !== series.imdbId ? { imdbId: imdb } : {}),
  };
  const unchanged = Object.keys(patch).length === 0;

  return (
    <form
      aria-label={t.series.ids.title}
      className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid || unchanged) return;
        patchSeries.mutate(
          { seriesId: series.id, patch },
          {
            onSuccess: () => {
              setTmdbDraft(null);
              setImdbDraft(null);
            },
          },
        );
      }}
    >
      <div>
        <h2 className="text-sm font-semibold">{t.series.ids.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t.series.ids.hint}</p>
      </div>
      <div className="grid gap-4 sm:max-w-md sm:grid-cols-2">
        <TextField
          label={t.series.ids.tmdb}
          inputMode="numeric"
          placeholder="12345"
          value={tmdbText}
          error={tmdbInvalid ? t.series.ids.invalid : undefined}
          onChange={(event) => setTmdbDraft(event.target.value)}
        />
        <TextField
          label={t.series.ids.imdb}
          placeholder="tt0123456"
          value={imdbText}
          error={imdbInvalid ? t.series.ids.invalid : undefined}
          onChange={(event) => setImdbDraft(event.target.value)}
        />
      </div>
      <PendingButton
        type="submit"
        variant="outline"
        className="self-start"
        disabled={invalid || unchanged}
        pending={patchSeries.isPending}
      >
        {t.series.ids.save}
      </PendingButton>
    </form>
  );
}
