import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The show behind the whole screen: its backdrop (or, without one, its poster) blurred and washed
 * out, so the glass panels on top frost it. Each image fades in once it has loaded, over the last.
 */
export function ShowBackdrop({ src, poster = false }: { src: string | null; poster?: boolean }) {
  const [loaded, setLoaded] = useState<string | null>(null);
  if (src === null) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <img
        key={src}
        src={src}
        alt=""
        onLoad={() => setLoaded(src)}
        className={cn(
          "absolute inset-0 size-full scale-110 object-cover saturate-150 transition-opacity duration-700 motion-reduce:transition-none",
          // A poster is narrow and busy: more blur, so it reads as colour and not as a picture.
          poster ? "blur-3xl" : "blur-2xl",
          loaded === src ? "opacity-60" : "opacity-0",
        )}
      />
      {/* Back towards the panel's own light background, more so at the bottom where the text runs. */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#eef2f9]/30 via-[#eef2f9]/45 to-[#eef2f9]/80" />
    </div>
  );
}
