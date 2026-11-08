// Turns the tools' progress into the setup page's words, in the person's language.
import type { SetupRow, SetupView } from "./shell-page.ts";
import type { Strings } from "./strings.ts";
import type { ToolState } from "./tools/index.ts";

const MB = 1_000_000;

/** Megabytes with one decimal, without the unit: "12.3 of 125.8 MB" says it once. */
function megabytes(bytes: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(bytes / MB);
}

function row(state: ToolState, strings: Strings, locale: string): SetupRow {
  const label = strings[state.id];
  const tool = state.id;
  switch (state.phase) {
    case "waiting":
      return { tool, label, status: strings.waiting, percent: 0, state: "busy" };
    case "downloading": {
      if (state.total === undefined) {
        return {
          tool,
          label,
          status: `${megabytes(state.received, locale)} MB`,
          percent: null,
          state: "busy",
        };
      }
      return {
        tool,
        label,
        status: strings.of(megabytes(state.received, locale), megabytes(state.total, locale)),
        percent: Math.min(100, (state.received / state.total) * 100),
        state: "busy",
      };
    }
    case "installing":
      return { tool, label, status: strings.installing, percent: null, state: "busy" };
    case "ready":
      return { tool, label, status: strings.ready, percent: 100, state: "ready" };
    case "failed":
      return { tool, label, status: strings.failedStep, percent: 0, state: "failed" };
  }
}

export function setupView(
  states: ToolState[],
  strings: Strings,
  locale: string,
  failure?: string,
): SetupView {
  return {
    title: strings.setupTitle,
    detail: strings.setupDetail,
    rows: states.map((state) => row(state, strings, locale)),
    ...(failure === undefined
      ? {}
      : { failure: { message: strings.setupFailed, detail: failure, retry: strings.retry } }),
  };
}
