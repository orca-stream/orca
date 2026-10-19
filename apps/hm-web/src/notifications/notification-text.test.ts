import type { NotificationDto } from "@orca/hm-contract";
import { describe, expect, it } from "vite-plus/test";
import { MESSAGES } from "../i18n/messages";
import { notificationText } from "./notification-text";

function make(over: Partial<NotificationDto>): NotificationDto {
  return {
    id: "n1",
    kind: "new_episodes",
    title: "New episodes",
    body: "Show: 2 new episodes (S01E03, S01E04)",
    seriesId: "s1",
    jobId: null,
    data: {},
    createdAt: 1,
    readAt: null,
    ...over,
  };
}

describe("notificationText", () => {
  const es = MESSAGES.es;
  const en = MESSAGES.en;

  it("says new episodes in the panel's language, singular and plural", () => {
    const many = make({ data: { seriesTitle: "Show", count: 2, codes: "S01E03, S01E04" } });
    expect(notificationText(many, es)).toEqual({
      title: "Episodios nuevos",
      body: "Show: 2 episodios nuevos (S01E03, S01E04)",
    });
    const one = make({ data: { seriesTitle: "Show", count: 1, codes: "S01E03" } });
    expect(notificationText(one, es).body).toBe("Show: 1 episodio nuevo (S01E03)");
    expect(notificationText(one, en).body).toBe("Show: 1 new episode (S01E03)");
  });

  it("says a finished batch", () => {
    const n = make({
      kind: "series_downloaded",
      data: { seriesTitle: "Show", available: 5, total: 6 },
    });
    expect(notificationText(n, es).body).toBe("Show: 5 de 6 episodios disponibles");
    expect(notificationText(n, en).body).toBe("Show: 5 of 6 episodes are available");
  });

  it("says a failed job with what it was about and why", () => {
    const n = make({
      kind: "job_failed",
      data: {
        seriesTitle: "Show",
        episodeCode: "S01E02",
        jobKind: "download_episode",
        error: "HTTP 404",
      },
    });
    expect(notificationText(n, es)).toEqual({
      title: "Un trabajo falló",
      body: "Show S01E02: HTTP 404",
    });
    const check = make({
      kind: "job_failed",
      data: { seriesTitle: null, episodeCode: null, jobKind: "check_series", error: "gone" },
    });
    expect(notificationText(check, en).body).toBe("Check series: gone");
  });

  it("says episodes that could not be added", () => {
    const n = make({
      kind: "episodes_skipped",
      data: { seriesTitle: "Show", count: 2 },
    });
    expect(notificationText(n, es).body).toBe(
      "Show: 2 episodios nuevos no se añadieron porque su número ya está en uso",
    );
    expect(notificationText(make({ ...n, data: { seriesTitle: "Show", count: 1 } }), en).body).toBe(
      "Show: 1 new episode was not added because its number is already taken",
    );
  });

  it("falls back to the server's English text when the data is missing", () => {
    expect(notificationText(make({ data: {} }), es)).toEqual({
      title: "New episodes",
      body: "Show: 2 new episodes (S01E03, S01E04)",
    });
  });
});
