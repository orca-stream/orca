import type { PreviewDto } from "@orca/hm-contract";
import { formatBytes, formatDuration } from "../i18n/format";
import { useLocale, useT } from "../i18n/locale";
import type { Messages } from "../i18n/messages";
import { PosterImage } from "./Poster";
import { Button, Checkbox, Switch, Table, TBody, Td, TextField, Th, THead, Tr, cx } from "../ui";
import {
  ackReason,
  canConfirm,
  episodeCode,
  parseYear,
  setAllIncluded,
  toggleEpisode,
  warningsByEpisode,
  type PreviewForm,
} from "./preview-form";

const LICENSE_TONE: Record<PreviewDto["license"]["kind"], string> = {
  "public-domain": "bg-emerald-500/15 text-emerald-300",
  cc0: "bg-emerald-500/15 text-emerald-300",
  "cc-by": "bg-emerald-500/15 text-emerald-300",
  "cc-by-sa": "bg-emerald-500/15 text-emerald-300",
  "cc-other": "bg-amber-500/15 text-amber-300",
  unknown: "bg-amber-500/15 text-amber-300",
};

/** Only http(s) addresses become links: a `javascript:` URL from a site must never be clickable. */
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** The warning in the panel's language by its kind; the server's own text for a kind we don't know. */
function warningText(warning: PreviewDto["warnings"][number], t: Messages): string {
  const text = (t.add.warningText as Record<string, string | undefined>)[warning.kind];
  return text ?? warning.message;
}

interface PreviewEditorProps {
  preview: PreviewDto;
  form: PreviewForm;
  onChange: (form: PreviewForm) => void;
  onConfirm: () => void;
  confirming: boolean;
}

/** The preview, editable: what will be added, under which license, and which episodes. */
export function PreviewEditor({
  preview,
  form,
  onChange,
  onConfirm,
  confirming,
}: PreviewEditorProps) {
  const t = useT();
  const locale = useLocale();
  const reason = ackReason(preview, form);
  const warnings = warningsByEpisode(preview);
  const included = new Set(form.included);
  const allIncluded = form.included.length === preview.episodes.length;
  const ok = canConfirm(preview, form);
  const yearInvalid = parseYear(form.year) === "invalid";

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 rounded-lg border border-white/10 bg-surface p-4 sm:grid-cols-[9rem_1fr]">
        <PosterImage
          src={preview.posterUrl}
          alt={preview.series.title}
          className="max-w-36 sm:max-w-none"
        />
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <TextField
              label={t.add.fieldTitle}
              value={form.title}
              onChange={(event) => onChange({ ...form, title: event.target.value })}
            />
            <TextField
              label={t.add.fieldYear}
              inputMode="numeric"
              value={form.year}
              error={yearInvalid ? t.add.yearInvalid : undefined}
              onChange={(event) => onChange({ ...form, year: event.target.value })}
            />
          </div>
          {preview.series.plot && (
            <div>
              <h3 className="text-sm text-white/70">{t.add.description}</h3>
              <p className="mt-1 text-sm text-white/80">{preview.series.plot}</p>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <h3 className="text-sm text-white/70">{t.add.license}</h3>
            <p className="flex flex-wrap items-center gap-3 text-sm">
              <span
                className={cx(
                  "rounded-full px-2.5 py-0.5 text-xs font-medium",
                  LICENSE_TONE[preview.license.kind],
                )}
              >
                {t.add.licenseKinds[preview.license.kind]}
              </span>
              <span className="text-white/70">{t.add.licenseWhy[preview.license.kind]}</span>
              {preview.license.url && !isHttpUrl(preview.license.url) && (
                <span className="break-all text-white/60">{preview.license.url}</span>
              )}
              {preview.license.url && isHttpUrl(preview.license.url) && (
                <a
                  href={preview.license.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-white/80 underline"
                >
                  {t.add.licenseSource}
                </a>
              )}
            </p>
          </div>
        </div>
      </section>

      {preview.warnings.length > 0 && (
        <section
          aria-label={t.add.warnings}
          className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-4"
        >
          <h3 className="text-sm font-medium text-amber-300">{t.add.warnings}</h3>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-white/80">
            {preview.warnings.map((warning, index) => (
              <li key={index}>
                <strong className="font-medium text-amber-200">
                  {t.add.warningKinds[warning.kind]}:{" "}
                </strong>
                {warningText(warning, t)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-medium">
            {t.add.episodes(form.included.length, preview.episodes.length)}
          </h3>
          <Checkbox
            label={t.add.includeAll}
            checked={allIncluded}
            onChange={(event) => onChange(setAllIncluded(preview, form, event.target.checked))}
          />
        </div>
        <Table>
          <THead>
            <Tr>
              <Th>{t.add.colInclude}</Th>
              <Th>{t.add.colCode}</Th>
              <Th>{t.add.colTitle}</Th>
              <Th>{t.add.colDuration}</Th>
              <Th>{t.add.colSize}</Th>
              <Th>{t.add.colFormat}</Th>
            </Tr>
          </THead>
          <TBody>
            {preview.episodes.map((episode) => {
              const code = episodeCode(episode.season, episode.episode);
              const hasGap = warnings.get(episode.key)?.some((warning) => warning.kind === "gap");
              return (
                <Tr key={episode.key} className={cx(!included.has(episode.key) && "opacity-50")}>
                  <Td>
                    <input
                      type="checkbox"
                      className="size-4 accent-brand"
                      aria-label={t.add.includeEpisode(code)}
                      checked={included.has(episode.key)}
                      onChange={() => onChange(toggleEpisode(form, episode.key))}
                    />
                  </Td>
                  <Td className="whitespace-nowrap">
                    <span className="font-mono text-xs">{code}</span>
                    {episode.inferred && (
                      <span
                        title={t.add.inferredHint}
                        className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300"
                      >
                        {t.add.inferred}
                      </span>
                    )}
                    {hasGap && (
                      <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                        {t.add.warningKinds.gap}
                      </span>
                    )}
                  </Td>
                  <Td>{episode.title}</Td>
                  <Td className="whitespace-nowrap text-white/70">
                    {episode.durationSec === null
                      ? "—"
                      : formatDuration(Math.round(episode.durationSec))}
                  </Td>
                  <Td className="whitespace-nowrap text-white/70">
                    {episode.sizeBytes === null ? "—" : formatBytes(episode.sizeBytes, locale)}
                  </Td>
                  <Td className="text-white/70">{episode.format ?? "—"}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-white/10 bg-surface p-4">
        <Switch
          checked={form.follow}
          label={t.add.followSeries}
          onCheckedChange={(follow) => onChange({ ...form, follow })}
        />
        <Switch
          checked={form.downloadNow}
          label={t.add.downloadNow}
          onCheckedChange={(downloadNow) => onChange({ ...form, downloadNow })}
        />
        {reason && (
          <div className="rounded-md border border-amber-400/30 bg-amber-500/10 p-3">
            <p className="mb-2 text-sm text-amber-200">
              {reason === "license" ? t.add.ackReasonLicense : t.add.ackReasonYear}
            </p>
            <Checkbox
              label={t.add.ack}
              checked={form.licenseAck}
              onChange={(event) => onChange({ ...form, licenseAck: event.target.checked })}
            />
          </div>
        )}
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={!ok} loading={confirming} onClick={onConfirm}>
            {confirming ? t.add.confirming : t.add.confirm}
          </Button>
          {!ok && (
            <p className="text-sm text-white/60">
              {form.title.trim() === ""
                ? t.add.needsTitle
                : form.included.length === 0
                  ? t.add.needsEpisodes
                  : reason && !form.licenseAck
                    ? t.add.needsAck
                    : null}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
