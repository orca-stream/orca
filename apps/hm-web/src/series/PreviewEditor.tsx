import type { PreviewDto } from "@orca/hm-contract";
import { TriangleAlertIcon } from "lucide-react";
import { CheckboxField } from "@/components/checkbox-field";
import { PendingButton } from "@/components/pending-button";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { SwitchField } from "@/components/switch-field";
import { TextField } from "@/components/text-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBytes, formatDuration } from "@/i18n/format";
import { useLocale, useT } from "@/i18n/locale";
import type { Messages } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { PosterImage } from "./Poster";
import {
  canConfirm,
  episodeCode,
  parseYear,
  setAllIncluded,
  toggleEpisode,
  warningsByEpisode,
  type PreviewForm,
} from "./preview-form";

const LICENSE_TONE: Record<PreviewDto["license"]["kind"], Tone> = {
  "public-domain": "success",
  cc0: "success",
  "cc-by": "success",
  "cc-by-sa": "success",
  "cc-other": "warning",
  unknown: "warning",
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

/**
 * The warning in the panel's language by its kind, and the server's own detail after it (which
 * episode, how long, why). For a kind we don't know the server's text is all there is, shown once.
 */
function warningText(
  warning: PreviewDto["warnings"][number],
  t: Messages,
): { sentence: string; detail: string | null } {
  const text = (t.add.warningText as Record<string, string | undefined>)[warning.kind];
  return text === undefined
    ? { sentence: warning.message, detail: null }
    : { sentence: text, detail: warning.message };
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
  const warnings = warningsByEpisode(preview);
  const included = new Set(form.included);
  const allIncluded = form.included.length === preview.episodes.length;
  const ok = canConfirm(form);
  const yearInvalid = parseYear(form.year) === "invalid";

  return (
    <div className="flex flex-col gap-6">
      <Card className="grid gap-4 px-4 sm:grid-cols-[9rem_1fr]">
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
              <h3 className="text-sm font-medium">{t.add.description}</h3>
              <p className="mt-1 text-muted-foreground">{preview.series.plot}</p>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <h3 className="text-sm font-medium">{t.add.license}</h3>
            <p className="flex flex-wrap items-center gap-3 text-sm">
              <StatusBadge tone={LICENSE_TONE[preview.license.kind]}>
                {t.add.licenseKinds[preview.license.kind]}
              </StatusBadge>
              <span className="text-muted-foreground">
                {t.add.licenseWhy[preview.license.kind]}
              </span>
              {preview.license.url && !isHttpUrl(preview.license.url) && (
                <span className="break-all text-muted-foreground">{preview.license.url}</span>
              )}
              {preview.license.url && isHttpUrl(preview.license.url) && (
                <a
                  href={preview.license.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline underline-offset-3 hover:text-primary"
                >
                  {t.add.licenseSource}
                </a>
              )}
            </p>
          </div>
        </div>
      </Card>

      {preview.warnings.length > 0 && (
        <Alert
          role="region"
          aria-label={t.add.warnings}
          className="border-warning/40 bg-warning/8 px-4 py-3"
        >
          <TriangleAlertIcon className="text-warning" />
          <AlertTitle className="text-warning">{t.add.warnings}</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 flex flex-col gap-1 text-foreground/80">
              {preview.warnings.map((warning, index) => {
                const { sentence, detail } = warningText(warning, t);
                return (
                  <li key={index}>
                    <strong className="font-medium text-warning">
                      {t.add.warningKinds[warning.kind]}:{" "}
                    </strong>
                    {sentence}
                    {detail && (
                      <span className="block text-xs text-muted-foreground">{detail}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-medium">
            {t.add.episodes(form.included.length, preview.episodes.length)}
          </h3>
          <CheckboxField
            label={t.add.includeAll}
            checked={allIncluded}
            onCheckedChange={(checked) => onChange(setAllIncluded(preview, form, checked))}
          />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.add.colInclude}</TableHead>
              <TableHead>{t.add.colCode}</TableHead>
              <TableHead>{t.add.colTitle}</TableHead>
              <TableHead>{t.add.colDuration}</TableHead>
              <TableHead>{t.add.colSize}</TableHead>
              <TableHead>{t.add.colFormat}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.episodes.map((episode) => {
              const code = episodeCode(episode.season, episode.episode);
              const hasGap = warnings.get(episode.key)?.some((warning) => warning.kind === "gap");
              return (
                <TableRow
                  key={episode.key}
                  className={cn(!included.has(episode.key) && "opacity-50")}
                >
                  <TableCell>
                    <Checkbox
                      aria-label={t.add.includeEpisode(code)}
                      checked={included.has(episode.key)}
                      onCheckedChange={() => onChange(toggleEpisode(form, episode.key))}
                    />
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{code}</span>
                    {episode.inferred && (
                      <StatusBadge tone="warning" title={t.add.inferredHint} className="ml-2">
                        {t.add.inferred}
                      </StatusBadge>
                    )}
                    {hasGap && (
                      <StatusBadge tone="warning" className="ml-2">
                        {t.add.warningKinds.gap}
                      </StatusBadge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal">{episode.title}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {episode.durationSec === null
                      ? "—"
                      : formatDuration(Math.round(episode.durationSec))}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {episode.sizeBytes === null ? "—" : formatBytes(episode.sizeBytes, locale)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{episode.format ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      <Card className="gap-4 px-4">
        <SwitchField
          checked={form.follow}
          label={t.add.followSeries}
          onCheckedChange={(follow) => onChange({ ...form, follow })}
        />
        <SwitchField
          checked={form.downloadNow}
          label={t.add.downloadNow}
          onCheckedChange={(downloadNow) => onChange({ ...form, downloadNow })}
        />
        <div className="flex items-center gap-3">
          <PendingButton disabled={!ok} pending={confirming} onClick={onConfirm}>
            {confirming ? t.add.confirming : t.add.confirm}
          </PendingButton>
          {!ok && (
            <p className="text-sm text-muted-foreground">
              {form.title.trim() === ""
                ? t.add.needsTitle
                : form.included.length === 0
                  ? t.add.needsEpisodes
                  : null}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
