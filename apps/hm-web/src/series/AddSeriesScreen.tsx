import type { PreviewDto } from "@orca/hm-contract";
import { LICENSE_ACK_REQUIRED } from "@orca/hm-contract/rules";
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useLocation, useSearchParams } from "wouter";
import { ApiError } from "../api/client";
import { useApi } from "../api/context";
import { useMutations } from "../api/mutations";
import { queries } from "../api/queries";
import { useT } from "../i18n/locale";
import type { Messages } from "../i18n/messages";
import { Button, TextField } from "../ui";
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

function createError(error: unknown, t: Messages): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return t.errors.network;
    if (error.status === 409) return t.add.alreadyAdded;
    if (error.code === LICENSE_ACK_REQUIRED) return t.add.ackRequired;
  }
  return t.add.createFailed;
}

export function AddSeriesScreen() {
  const t = useT();
  const api = useApi();
  const [params] = useSearchParams();
  const [, navigate] = useLocation();
  const { preview: previewMutation, createSeries } = useMutations();
  const extractors = useQuery(queries.extractors(api));

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

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.add.title}</h1>
        <p className="mt-1 text-sm text-white/60">{t.add.subtitle}</p>
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
          <Button
            type="submit"
            variant="primary"
            disabled={!urlFilled}
            loading={previewMutation.isPending}
          >
            {previewMutation.isPending ? t.add.previewing : t.add.preview}
          </Button>
        </div>
        {explicit.length > 0 && (
          <div className="flex flex-col gap-1.5 sm:max-w-sm">
            <label htmlFor="extractor-choice" className="text-sm text-white/70">
              {t.add.extractorChoice}
            </label>
            <select
              id="extractor-choice"
              value={chosen?.id ?? ""}
              onChange={(event) => setChosenId(event.target.value)}
              className="h-10 rounded-md border border-white/10 bg-surface px-3 text-sm text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
            >
              <option value="">{t.add.autoExtractor}</option>
              {explicit.map((extractor) => (
                <option key={extractor.id} value={extractor.id}>
                  {extractor.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {chosen && (
          <p role="status" className="text-sm text-amber-300">
            {t.add.usingExplicit(chosen.name)}
          </p>
        )}
        {urlFilled && extractors.isSuccess && !chosen && (
          <p
            role="status"
            className={matched ? "text-sm text-emerald-300" : "text-sm text-amber-300"}
          >
            {matched ? t.add.matches(matched.name) : t.add.noMatch}
          </p>
        )}
        {previewMutation.isError && (
          <p role="alert" className="text-sm text-amber-300">
            {previewError(previewMutation.error, t)}
          </p>
        )}
      </form>

      {notice && (
        <p
          role="status"
          className="rounded-md border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-200"
        >
          {notice}
        </p>
      )}
      {createSeries.isError && !gone && (
        <p role="alert" className="text-sm text-amber-300">
          {createError(createSeries.error, t)}
        </p>
      )}

      {preview && form && (
        <PreviewEditor
          preview={preview}
          form={form}
          onChange={setForm}
          onConfirm={confirm}
          confirming={createSeries.isPending || (gone && previewMutation.isPending)}
        />
      )}
    </div>
  );
}
