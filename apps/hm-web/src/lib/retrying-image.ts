import { useEffect, useState } from "react";

/** Waits before each new attempt: a grid loads dozens of frames at once and a few drop. */
export const IMAGE_RETRY_DELAYS_MS = [1_000, 3_000, 9_000];

/**
 * An image's address that tries again when it fails to load, instead of giving up on the first
 * error. Each attempt adds `retry=n` so the browser asks the network rather than reusing the
 * failure. `src` is null once every attempt failed (or without a url): show the placeholder.
 */
export function useRetryingImage(url: string | null | undefined): {
  src: string | null;
  onError: () => void;
} {
  const [state, setState] = useState({ url, attempt: 0, waiting: false });
  // A new url starts over.
  const current = state.url === url ? state : { url, attempt: 0, waiting: false };
  if (current !== state) setState(current);

  useEffect(() => {
    if (!current.waiting) return;
    const timer = setTimeout(
      () => setState((s) => (s.url === url ? { ...s, attempt: s.attempt + 1, waiting: false } : s)),
      IMAGE_RETRY_DELAYS_MS[current.attempt],
    );
    return () => clearTimeout(timer);
  }, [current.waiting, current.attempt, url]);

  const onError = () =>
    setState((s) => {
      if (s.url !== url || s.waiting) return s;
      // Out of attempts: stay on the placeholder.
      if (s.attempt >= IMAGE_RETRY_DELAYS_MS.length) return { ...s, attempt: s.attempt + 1 };
      return { ...s, waiting: true };
    });

  if (!url || current.waiting) return { src: null, onError };
  if (current.attempt === 0) return { src: url, onError };
  if (current.attempt > IMAGE_RETRY_DELAYS_MS.length) return { src: null, onError };
  const retry = new URL(url, window.location.href);
  retry.searchParams.set("retry", String(current.attempt));
  return { src: retry.href, onError };
}
