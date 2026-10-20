import type { PreviewDto } from "@orca/hm-contract";
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useLocation, useSearchParams } from "wouter";
import { TriangleAlertIcon } from "lucide-react";
import { ApiError } from "@/api/client";
import { useApi } from "@/api/context";
import { useMutations } from "@/api/mutations";
import { queries } from "@/api/queries";
import { PendingButton } from "@/components/pending-button";
import { TextField } from "@/components/text-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useT } from "@/i18n/locale";
import type { Messages } from "@/i18n/messages";
import { PreviewEditor } from "./PreviewEditor";
import { initialForm, matchExtractor, toCreateBody, type PreviewForm } from "./preview-form";

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

export function AddSeriesScreen() {
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

  const explicit = (extractors.data ?? []).filter((extractor) => extractor.explicit);
  const chosen = explicit.find((extractor) => extractor.id === chosenId) ?? null;
  const extractorId = chosen?.id;
  const matched = extractors.data && !chosen ? matchExtractor(url, extractors.data) : null;
  const urlFilled = url.trim() !== "";

  function runPreview(event?: FormEvent) {
    event?.preventDefault();
    if (!urlFilled || previewMutation.isPending) return;
    setNotice(null);
    createSeries.reset();
    previewMutation.mutate(
      { url: url.trim(), ...(extractorId ? { extractorId } : {}) },
      {
        onSuccess: (next) => {
          setPreview(next);
          setForm(initialForm(next));
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
  const addTo = form?.addTo ?? "";
  const targetEpisodes = useQuery({ ...queries.episodes(api, addTo), enabled: addTo !== "" });
  const failure = createSeries.isError && !gone ? createError(createSeries.error, t) : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.add.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.add.subtitle}</p>
      </div>

      <form onSubmit={runPreview} className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <TextField
              label={t.add.url}
              name="url"
              type="url"
              inputMode="url"
              placeholder={t.add.urlPlaceholder}
              autoFocus
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <PendingButton type="submit" disabled={!urlFilled} pending={previewMutation.isPending}>
            {previewMutation.isPending ? t.add.previewing : t.add.preview}
          </PendingButton>
        </div>
        {explicit.length > 0 && (
          <Field className="sm:max-w-sm">
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
          <p role="status" className="text-sm text-warning">
            {t.add.usingExplicit(chosen.name)}
          </p>
        )}
        {urlFilled && extractors.isSuccess && !chosen && (
          <p role="status" className={matched ? "text-sm text-success" : "text-sm text-warning"}>
            {matched ? t.add.matches(matched.name) : t.add.noMatch}
          </p>
        )}
        {previewMutation.isError && (
          <p role="alert" className="text-sm text-warning">
            {previewError(previewMutation.error, t)}
          </p>
        )}
      </form>

      {notice && (
        <Alert role="status" className="border-warning/40 bg-warning/8 text-warning">
          <TriangleAlertIcon />
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

      {preview && form && (
        <PreviewEditor
          preview={preview}
          form={form}
          seriesOptions={seriesList.data ?? []}
          targetEpisodes={addTo === "" ? undefined : targetEpisodes.data}
          onChange={setForm}
          onConfirm={confirm}
          confirming={createSeries.isPending || (gone && previewMutation.isPending)}
        />
      )}
    </div>
  );
}
