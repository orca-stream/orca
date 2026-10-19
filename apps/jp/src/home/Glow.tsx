/**
 * The phone app tints the top of the screen with the featured title's colours. A blurred copy of
 * its art does the same without computing any colour.
 */
export function Glow({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <div
      aria-hidden="true"
      className="absolute inset-x-0 top-0 -z-10 h-[90dvh] overflow-hidden mask-b-from-40% mask-b-to-100%"
    >
      <img
        src={url}
        alt=""
        // Larger than its frame: a blur darkens an image's edges, and those must stay off-screen.
        className="absolute -inset-20 h-[calc(100%+10rem)] w-[calc(100%+10rem)] max-w-none object-cover opacity-60 blur-3xl saturate-150"
      />
    </div>
  );
}
