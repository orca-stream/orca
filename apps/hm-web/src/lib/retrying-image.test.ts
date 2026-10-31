import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { IMAGE_RETRY_DELAYS_MS, useRetryingImage } from "./retrying-image";

const STILL = "https://image.tmdb.org/t/p/w400/a.jpg";

describe("useRetryingImage", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("tries again after a failed load, with a fresh address each time", () => {
    const { result } = renderHook(() => useRetryingImage(STILL));
    expect(result.current.src).toBe(STILL);

    act(() => result.current.onError());
    expect(result.current.src).toBeNull();
    act(() => {
      vi.advanceTimersByTime(IMAGE_RETRY_DELAYS_MS[0]!);
    });
    expect(result.current.src).toBe(`${STILL}?retry=1`);

    act(() => result.current.onError());
    act(() => {
      vi.advanceTimersByTime(IMAGE_RETRY_DELAYS_MS[1]!);
    });
    expect(result.current.src).toBe(`${STILL}?retry=2`);
  });

  it("gives up after the last attempt", () => {
    const { result } = renderHook(() => useRetryingImage(STILL));
    for (const delay of IMAGE_RETRY_DELAYS_MS) {
      act(() => result.current.onError());
      act(() => {
        vi.advanceTimersByTime(delay);
      });
    }
    expect(result.current.src).toBe(`${STILL}?retry=${IMAGE_RETRY_DELAYS_MS.length}`);
    act(() => result.current.onError());
    act(() => {
      vi.runAllTimers();
    });
    expect(result.current.src).toBeNull();
  });

  it("starts over for a new address and has none without one", () => {
    const { result, rerender } = renderHook(({ url }) => useRetryingImage(url), {
      initialProps: { url: STILL as string | null },
    });
    act(() => result.current.onError());
    rerender({ url: "https://image.tmdb.org/t/p/w400/b.jpg" });
    expect(result.current.src).toBe("https://image.tmdb.org/t/p/w400/b.jpg");
    rerender({ url: null });
    expect(result.current.src).toBeNull();
  });
});
